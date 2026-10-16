import { GameRunner } from '../core/GameRunner';
import {
  MatchController,
  type CurrentGame,
  type EndReason,
  type ForfeitReason,
  type ReportResult,
  type RoundRecord,
} from '../core/match/MatchController';
import { planMatch, type MatchFormat, type MatchPlan } from '../core/match/planMatch';
import type {
  AIMemory,
  AnyMiniGameModule,
  GameInfo,
  Prefs,
  RemoteUpdate,
  RoundContext,
  RoundEnd,
  Sfx,
} from '../core/MiniGame';
import { otherPlayer, type Outcome, type PerPlayer, type PlayerSlot } from '../core/types';
import { canonicalJson } from '../core/util/canonicalJson';
import type { Clock, TimerHandle } from '../core/util/clock';
import { createRng, deriveRng, randomSeed } from '../core/util/rng';
import { GAMES } from '../games/registry';
import { DEFAULT_TIMING, type Peer, type PeerStatus } from '../net/Peer';
import type { GameBody, SessionBody, StateBody } from '../net/protocol';
import { Listeners } from '../net/Transport';
import { CheatError, SealedExchange, SeedExchange } from './exchanges';
import { RemoteRunner } from './RemoteRunner';

/** Rezerva navíc k lhůtě na tah, než hostitel zahraje za mlčícího hosta. */
export const REMOTE_GRACE_MS = 10_000;
/** Lhůta pro hry, které si časování řídí samy (reakční). */
export const UNTIMED_GAME_LIMIT_MS = 15_000;
/** Kolikrát po sobě automatický tah, než prohraje kontumací. */
export const AFK_FORFEIT_AFTER = 3;

export type Role = 'host' | 'guest';
export type CloseReason = 'opponent-left' | 'opponent-gone' | 'version' | 'cheat' | 'me-left';

export type OnlinePhase =
  | { readonly name: 'seeding' }
  | { readonly name: 'lobby'; readonly plan: MatchPlan }
  | { readonly name: 'intro'; readonly current: CurrentGame; readonly ready: PerPlayer<boolean> }
  | { readonly name: 'playing'; readonly current: CurrentGame }
  | {
      readonly name: 'round-result';
      readonly current: CurrentGame;
      readonly report: ReportResult;
      readonly result: RoundEnd;
    }
  | {
      readonly name: 'match-result';
      readonly winner: PlayerSlot;
      readonly reason: EndReason;
      readonly detail: string | null;
      readonly rematch: PerPlayer<boolean>;
      readonly canRematch: boolean;
    }
  | { readonly name: 'closed'; readonly reason: CloseReason; readonly detail: string | null };

export interface ConnectionState {
  readonly lost: boolean;
  /** Kdy vyprší čekání na soupeře (pak kontumace). */
  readonly deadline: number | null;
}

export interface RoundMount {
  readonly root: HTMLElement;
  readonly prefs: Prefs;
  readonly sfx: Sfx;
  readonly aiMemory: AIMemory;
  showTurnTimer(deadline: number | null, totalMs: number): void;
}

export interface OnlineSessionOptions {
  readonly role: Role;
  readonly peer: Peer;
  readonly names: PerPlayer<string>;
  readonly format: MatchFormat;
  readonly clock: Clock;
  readonly games?: readonly AnyMiniGameModule[];
  /** Jak dlouho Peer čeká po ztrátě spojení (pro odpočet v UI). */
  readonly goneAfterMs?: number;
}

interface RoundState {
  readonly current: CurrentGame;
  readonly game: AnyMiniGameModule;
  readonly sealed: SealedExchange | null;
  host: GameRunner<unknown, unknown, unknown> | null;
  guest: RemoteRunner<unknown, unknown, unknown> | null;
  /** Host: stav, který přišel dřív, než se kolo vykreslilo. */
  pendingState: StateBody | null;
  latestState: StateBody | null;
  /** Host: ověření odhaleného tahu hostitele (běží asynchronně). */
  revealCheck: Promise<boolean> | null;
  stateSeq: number;
  fallback: TimerHandle | null;
  ended: boolean;
}

const roundKey = (c: { gameNo: number; replay: number }): string => `${c.gameNo}:${c.replay}`;

/**
 * Online zápas jednoho hráče (hostitel = A, host = B). Hostitel řídí průběh (pořadí her,
 * skóre, časovače), host posílá jen vstupy – a ověřuje, co může: pořadí her ze společného
 * seedu, skóre zrcadlovým MatchControllerem a u zapečetěných tahů i výsledek kola.
 */
export class OnlineSession {
  readonly me: PlayerSlot;
  readonly opponent: PlayerSlot;
  private phaseValue: OnlinePhase = { name: 'seeding' };
  private matchNo = 0;
  private seed: string | null = null;
  private controller: MatchController | null = null;
  private ownPlan: MatchPlan | null = null;
  private hostSlots: unknown = null;
  private hostFormat: unknown = null;
  private seeds: SeedExchange | null = null;
  private readonly ready = new Map<string, PerPlayer<boolean>>();
  private rematch: PerPlayer<boolean> = { A: false, B: false };
  private round: RoundState | null = null;
  private afk: PerPlayer<number> = { A: 0, B: 0 };
  private detail: string | null = null;
  private opponentAway = false;
  private closed = false;
  private readonly phases = new Listeners<OnlinePhase>();
  private readonly connection = new Listeners<ConnectionState>();
  private readonly games: readonly AnyMiniGameModule[];
  private readonly infos: readonly GameInfo[];

  constructor(private readonly o: OnlineSessionOptions) {
    this.me = o.role === 'host' ? 'A' : 'B';
    this.opponent = otherPlayer(this.me);
    this.games = o.games ?? GAMES;
    this.infos = this.games.map(({ id, name, type, length }) => ({ id, name, type, length }));
    o.peer.onStatus((status) => this.onPeerStatus(status));
    o.peer.onBye(() => this.onOpponentGone('left'));
    o.peer.onVersionMismatch(() => this.close('version', null));
    o.peer.onMessage((body) => this.handle(body));
    this.beginMatch();
  }

  get phase(): OnlinePhase {
    return this.phaseValue;
  }

  get names(): PerPlayer<string> {
    return this.o.names;
  }

  get format(): MatchFormat {
    return this.o.format;
  }

  get score(): PerPlayer<number> {
    return { ...(this.controller?.score ?? { A: 0, B: 0 }) };
  }

  get history(): readonly RoundRecord[] {
    return this.controller ? this.controller.history : [];
  }

  onPhase(handler: (phase: OnlinePhase) => void): () => void {
    const off = this.phases.add(handler);
    handler(this.phaseValue);
    return off;
  }

  onConnection(handler: (state: ConnectionState) => void): () => void {
    return this.connection.add(handler);
  }

  // ---------- Akce z UI ----------

  /** Hostitel v lobby spustí zápas. */
  startMatch(): void {
    if (this.o.role !== 'host' || this.phaseValue.name !== 'lobby') return;
    this.send({ type: 'match-start', match: this.matchNo });
    this.goIntro();
  }

  setReady(): void {
    const phase = this.phaseValue;
    if (phase.name !== 'intro') return;
    const flags = this.readyFor(phase.current);
    if (flags[this.me]) return;
    flags[this.me] = true;
    // Posílají oba (kvůli zobrazení „soupeř je připravený“), kolo ale spouští hostitel.
    this.send({
      type: 'ready',
      match: this.matchNo,
      gameNo: phase.current.gameNo,
      replay: phase.current.replay,
    });
    this.setPhase({ ...phase, ready: { ...flags } });
    this.maybeStartRound();
  }

  continueAfterRound(): void {
    if (this.phaseValue.name !== 'round-result') return;
    if (this.controller?.isOver) this.showMatchResult();
    else this.goIntro();
  }

  requestRematch(): void {
    const phase = this.phaseValue;
    if (phase.name !== 'match-result' || !phase.canRematch || this.rematch[this.me]) return;
    this.rematch[this.me] = true;
    this.send({ type: 'rematch', match: this.matchNo });
    this.showMatchResult();
    this.maybeRematch();
  }

  /** Odchod ze zápasu – soupeř vyhraje kontumací. Vyřeší se po odeslání „bye“. */
  leave(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.destroyRound();
    const sent = this.o.peer.bye();
    this.setPhase({ name: 'closed', reason: 'me-left', detail: null });
    return sent;
  }

  /** UI vykreslilo herní obrazovku – spustí kolo. Vrací úklid. */
  mountRound(mount: RoundMount): () => void {
    const round = this.round;
    const seed = this.seed;
    if (!round || !seed || this.phaseValue.name !== 'playing' || round.host || round.guest) {
      return () => undefined;
    }
    const { current, game } = round;
    const base: Omit<RoundContext, 'seats' | 'bridge'> = {
      root: mount.root,
      mode: 'online',
      names: this.o.names,
      starter: current.starter,
      rng: deriveRng(seed, 'game', current.gameNo, current.replay),
      aiRng: createRng(randomSeed()),
      aiMemory: mount.aiMemory,
      clock: this.o.clock,
      prefs: mount.prefs,
      sfx: mount.sfx,
      handoff: () => Promise.resolve(),
      showTurnTimer: (deadline, total) => mount.showTurnTimer(deadline, total),
    };

    if (this.o.role === 'host') {
      const runner = new GameRunner(game);
      round.host = runner;
      runner.init({
        ...base,
        seats: { A: { kind: 'human' }, B: { kind: 'remote' } },
        bridge: {
          publish: (update) => this.publish(round, update),
          localMove: (player, move, auto) => {
            this.countAfk(player, auto);
            if (round.sealed) void round.sealed.seal(move, auto);
          },
        },
      });
      runner.onEnd((result) => this.hostRoundEnd(round, result));
      runner.start();
    } else {
      const runner = new RemoteRunner(game, {
        me: this.me,
        send: (move, auto) => this.sendGame(current, { kind: 'move', move, auto }),
        seal: (move, auto) => void round.sealed?.seal(move, auto),
      });
      round.guest = runner;
      runner.init({ ...base, seats: { A: { kind: 'remote' }, B: { kind: 'human' } } });
      runner.start();
      if (round.pendingState) {
        runner.receiveState(round.pendingState);
        round.pendingState = null;
      }
    }
    return () => {
      round.host?.destroy();
      round.guest?.destroy();
    };
  }

  // ---------- Průběh zápasu ----------

  private beginMatch(): void {
    this.matchNo += 1;
    this.destroyRound();
    this.seed = null;
    this.controller = null;
    this.ownPlan = null;
    this.hostSlots = null;
    this.hostFormat = null;
    this.ready.clear();
    this.rematch = { A: false, B: false };
    this.afk = { A: 0, B: 0 };
    this.detail = null;
    this.setPhase({ name: 'seeding' });

    const match = this.matchNo;
    const seeds = new SeedExchange(this.me, (m) =>
      this.send(
        m.kind === 'commit'
          ? { type: 'seed-commit', match, hash: m.hash }
          : { type: 'seed-reveal', match, seed: m.seed, salt: m.salt },
      ),
    );
    this.seeds = seeds;
    seeds.result.then(
      (seed) => {
        if (this.matchNo === match && !this.closed) this.onSeed(seed);
      },
      (err: unknown) =>
        this.detectCheat(err instanceof CheatError ? err.message : 'Chyba výměny seedu.'),
    );
    void seeds.start();
  }

  private onSeed(seed: string): void {
    this.seed = seed;
    let plan: MatchPlan;
    try {
      plan = planMatch(this.o.format, this.infos, deriveRng(seed, 'plan'));
    } catch {
      this.detectCheat('Formát zápasu nejde sestavit.');
      return;
    }
    this.ownPlan = plan;
    this.controller = new MatchController(plan, deriveRng(seed, 'match'));
    if (this.o.role === 'host') {
      this.send({
        type: 'match-setup',
        match: this.matchNo,
        format: this.o.format,
        slots: [...plan.slots],
      });
      this.setPhase({ name: 'lobby', plan });
    } else {
      this.tryGuestLobby();
    }
  }

  /** Host ověří, že hostitel poslal stejné pořadí her, jaké vychází ze společného seedu. */
  private tryGuestLobby(): void {
    if (!this.ownPlan || this.hostSlots === null) return;
    if (
      canonicalJson(this.ownPlan.slots) !== canonicalJson(this.hostSlots) ||
      canonicalJson(this.o.format) !== canonicalJson(this.hostFormat)
    ) {
      this.detectCheat('Pořadí her od hostitele nesouhlasí se společným seedem.');
      return;
    }
    this.setPhase({ name: 'lobby', plan: this.ownPlan });
  }

  private goIntro(): void {
    if (!this.controller || this.controller.isOver) return;
    const current = this.controller.current();
    this.setPhase({ name: 'intro', current, ready: { ...this.readyFor(current) } });
    this.maybeStartRound();
  }

  private readyFor(current: CurrentGame | { gameNo: number; replay: number }): PerPlayer<boolean> {
    const key = roundKey(current);
    let flags = this.ready.get(key);
    if (!flags) {
      flags = { A: false, B: false };
      this.ready.set(key, flags);
    }
    return flags;
  }

  private maybeStartRound(): void {
    const phase = this.phaseValue;
    if (this.o.role !== 'host' || phase.name !== 'intro') return;
    const flags = this.readyFor(phase.current);
    if (!flags.A || !flags.B) return;
    this.send({
      type: 'round-start',
      match: this.matchNo,
      gameNo: phase.current.gameNo,
      replay: phase.current.replay,
    });
    this.beginRound(phase.current);
  }

  private beginRound(current: CurrentGame): void {
    const game = this.games.find((g) => g.id === current.gameId);
    if (!game) {
      this.detectCheat(`Neznámá hra ${current.gameId}.`);
      return;
    }
    this.round = {
      current,
      game,
      sealed: game.sealed ? new SealedExchange(this.me, (m) => this.sendGame(current, m)) : null,
      host: null,
      guest: null,
      pendingState: null,
      latestState: null,
      revealCheck: null,
      stateSeq: 0,
      fallback: null,
      ended: false,
    };
    this.setPhase({ name: 'playing', current });
  }

  private publish(round: RoundState, update: RemoteUpdate): void {
    if (this.round !== round || round.ended) return;
    round.stateSeq += 1;
    this.sendGame(round.current, {
      kind: 'state',
      seq: round.stateSeq,
      view: update.view,
      canAct: update.canAct,
      committed: [...update.committed],
      finished: update.finished,
    });
    if (update.canAct && update.finished === null) {
      if (round.fallback === null) {
        const limit = (round.game.moveTimeoutMs ?? UNTIMED_GAME_LIMIT_MS) + REMOTE_GRACE_MS;
        round.fallback = this.o.clock.setTimeout(() => this.onRemoteSilent(round), limit);
      }
    } else {
      this.clearFallback(round);
    }
  }

  /** Hostitel: host v limitu nereagoval – zahraje se za něj (nebo prohra, pokud neodhalil). */
  private onRemoteSilent(round: RoundState): void {
    round.fallback = null;
    const runner = round.host;
    if (this.round !== round || round.ended || !runner || !runner.isToMove(this.opponent)) return;
    if (round.sealed?.opponentCommitted) {
      this.detectCheat('Soupeř neodhalil svůj zapečetěný tah.');
      return;
    }
    if (runner.autoMove(this.opponent)) this.countAfk(this.opponent, true);
  }

  private clearFallback(round: RoundState): void {
    if (round.fallback !== null) this.o.clock.clearTimeout(round.fallback);
    round.fallback = null;
  }

  private countAfk(player: PlayerSlot, auto: boolean): void {
    if (this.o.role !== 'host') return;
    this.afk[player] = auto ? this.afk[player] + 1 : 0;
    if (this.afk[player] >= AFK_FORFEIT_AFTER && this.controller && !this.controller.isOver) {
      this.send({
        type: 'match-end',
        match: this.matchNo,
        winner: otherPlayer(player),
        reason: 'afk',
      });
      this.endByForfeit(player, 'afk');
    }
  }

  private hostRoundEnd(round: RoundState, result: RoundEnd): void {
    if (this.round !== round || round.ended || !this.controller) return;
    round.ended = true;
    this.clearFallback(round);
    const report = this.controller.report(result.outcome);
    const { gameNo, replay } = round.current;
    this.send({
      type: 'round-end',
      match: this.matchNo,
      gameNo,
      replay,
      outcome: result.outcome,
      summary: result.summary,
    });
    this.setPhase({ name: 'round-result', current: round.current, report, result });
  }

  private async guestRoundEnd(body: Extract<SessionBody, { type: 'round-end' }>): Promise<void> {
    const round = this.round;
    if (!round || round.ended || roundKey(round.current) !== roundKey(body)) return;
    round.ended = true;
    if (round.sealed) {
      const problem = await this.verifySealedRound(round, body.outcome);
      if (problem) {
        this.detectCheat(problem);
        return;
      }
    }
    if (this.round !== round || this.closed || !this.controller) return;
    const report = this.controller.report(body.outcome);
    const result: RoundEnd = { outcome: body.outcome, summary: body.summary };
    round.guest?.receiveEnd(result);
    this.setPhase({ name: 'round-result', current: round.current, report, result });
  }

  /**
   * Host: přehraje kolo ze společného seedu a obou odhalených tahů. Výsledek musí sedět
   * s tím, co tvrdí hostitel, a tahy s jeho závěrečným pohledem.
   */
  private async verifySealedRound(round: RoundState, outcome: Outcome): Promise<string | null> {
    const { game, sealed, current } = round;
    if (!sealed || !game.sealed || !this.seed) return null;
    if (round.revealCheck && !(await round.revealCheck))
      return 'Hostitel odhalil jiný tah, než ke kterému se zavázal.';
    const hostMove = sealed.opponentMove;
    if (!hostMove) return 'Hostitel neodhalil svůj zapečetěný tah.';
    const finalView = round.latestState ? game.viewSchema.safeParse(round.latestState.view) : null;
    if (!finalView?.success) return 'Chybí závěrečný stav kola.';

    const moves: Partial<Record<PlayerSlot, unknown>> = {
      [this.opponent]: hostMove.move,
      [this.me]: sealed.hasSealed ? sealed.ownMove : game.sealed.moveOf(finalView.data, this.me),
    };
    for (const p of [this.me, this.opponent]) {
      const shown = game.sealed.moveOf(finalView.data, p);
      if (shown === null || canonicalJson(shown) !== canonicalJson(moves[p])) {
        return 'Tahy v závěrečném stavu nesouhlasí s odhalenými tahy.';
      }
    }

    const { logic } = game;
    let state = logic.setup({
      rng: deriveRng(this.seed, 'game', current.gameNo, current.replay),
      starter: current.starter,
    });
    for (const p of [current.starter, otherPlayer(current.starter)]) {
      const parsed = game.moveSchema.safeParse(moves[p]);
      if (!parsed.success || !logic.legal(state, p, parsed.data))
        return 'Odhalený tah není platný.';
      state = logic.apply(state, p, parsed.data);
    }
    const expected = logic.outcome(state);
    if (!expected || canonicalJson(expected) !== canonicalJson(outcome)) {
      return 'Výsledek kola od hostitele nesouhlasí s odhalenými tahy.';
    }
    return null;
  }

  private showMatchResult(): void {
    const c = this.controller;
    if (!c?.winner) return;
    this.setPhase({
      name: 'match-result',
      winner: c.winner,
      reason: c.endReason ?? 'score',
      detail: this.detail,
      rematch: { ...this.rematch },
      canRematch: !this.closed && !this.opponentAway && c.endReason !== 'cheat',
    });
  }

  private maybeRematch(): void {
    if (this.rematch.A && this.rematch.B && !this.closed && !this.opponentAway) this.beginMatch();
  }

  private endByForfeit(loser: PlayerSlot, reason: ForfeitReason): void {
    this.destroyRound();
    if (!this.controller) {
      this.close(reason === 'cheat' ? 'cheat' : 'opponent-gone', this.detail);
      return;
    }
    this.controller.forfeit(loser, reason);
    this.showMatchResult();
  }

  // ---------- Zprávy ----------

  private handle(body: SessionBody): void {
    if (this.closed) return;
    if (body.match !== this.matchNo) {
      console.warn('[online] zpráva z jiného zápasu zahozena', body.type);
      return;
    }
    const host = this.o.role === 'host';
    switch (body.type) {
      case 'seed-commit':
        this.seeds?.receiveCommit(body.hash);
        break;
      case 'seed-reveal':
        void this.seeds?.receiveReveal(body.seed, body.salt);
        break;
      case 'match-setup':
        if (host) break;
        this.hostSlots = body.slots;
        this.hostFormat = body.format;
        this.tryGuestLobby();
        break;
      case 'match-start':
        if (!host && this.phaseValue.name === 'lobby') this.goIntro();
        break;
      case 'ready':
        this.readyFor(body)[this.opponent] = true;
        if (
          this.phaseValue.name === 'intro' &&
          roundKey(this.phaseValue.current) === roundKey(body)
        ) {
          this.setPhase({ ...this.phaseValue, ready: { ...this.readyFor(body) } });
          this.maybeStartRound();
        }
        break;
      case 'round-start': {
        if (host || !this.controller || this.controller.isOver) break;
        const current = this.controller.current();
        if (roundKey(current) !== roundKey(body)) {
          this.detectCheat('Hostitel spustil jiné kolo, než vychází ze zápasu.');
          break;
        }
        this.beginRound(current);
        break;
      }
      case 'game':
        this.handleGame(body);
        break;
      case 'round-end':
        if (!host) void this.guestRoundEnd(body);
        break;
      case 'match-end':
        if (!host && this.controller && !this.controller.isOver) {
          this.endByForfeit(otherPlayer(body.winner), body.reason);
        }
        break;
      case 'rematch':
        this.rematch[this.opponent] = true;
        if (this.phaseValue.name === 'match-result') this.showMatchResult();
        this.maybeRematch();
        break;
      case 'cheat':
        if (this.detail !== null) break;
        this.detail = 'Soupeř nahlásil nesoulad v datech zápasu.';
        this.endByForfeit(this.me, 'cheat');
        break;
    }
  }

  private handleGame(body: Extract<SessionBody, { type: 'game' }>): void {
    const round = this.round;
    if (!round || round.ended || roundKey(round.current) !== roundKey(body)) return;
    const msg = body.body;
    if (this.o.role === 'host') this.hostGameMessage(round, msg);
    else this.guestGameMessage(round, msg);
  }

  private hostGameMessage(round: RoundState, msg: GameBody): void {
    const runner = round.host;
    if (!runner) return;
    switch (msg.kind) {
      case 'move':
        if (round.sealed) {
          console.warn('[online] nezapečetěný tah v zapečetěné hře zahozen');
          return;
        }
        this.countAfk(this.opponent, msg.auto);
        if (!runner.submitRemote(this.opponent, msg.move)) runner.republish();
        break;
      case 'commit':
        if (!round.sealed || msg.player !== this.opponent) return;
        if (round.sealed.receiveCommit(msg.hash)) {
          this.countAfk(this.opponent, msg.auto);
          runner.markCommitted(this.opponent);
        }
        break;
      case 'reveal': {
        const sealed = round.sealed;
        if (!sealed || msg.player !== this.opponent) return;
        void sealed.receiveReveal(msg.move, msg.salt).then((ok) => {
          if (this.round !== round || round.ended) return;
          if (!ok) this.detectCheat('Soupeř odhalil jiný tah, než ke kterému se zavázal.');
          else if (!runner.submitRemote(this.opponent, msg.move))
            this.detectCheat('Soupeř odhalil neplatný tah.');
        });
        break;
      }
      case 'state':
        break;
    }
  }

  private guestGameMessage(round: RoundState, msg: GameBody): void {
    switch (msg.kind) {
      case 'state':
        round.latestState = msg;
        if (round.guest) round.guest.receiveState(msg);
        else round.pendingState = msg;
        break;
      case 'commit':
        if (msg.player === this.opponent) round.sealed?.receiveCommit(msg.hash);
        break;
      case 'reveal':
        if (msg.player === this.opponent && round.sealed) {
          round.revealCheck = round.sealed.receiveReveal(msg.move, msg.salt);
        }
        break;
      case 'move':
        break;
    }
  }

  private send(body: SessionBody): void {
    if (!this.closed) this.o.peer.send(body);
  }

  private sendGame(current: CurrentGame, body: GameBody): void {
    this.send({
      type: 'game',
      match: this.matchNo,
      gameNo: current.gameNo,
      replay: current.replay,
      body,
    });
  }

  // ---------- Spojení a chyby ----------

  private onPeerStatus(status: PeerStatus): void {
    if (status === 'lost') {
      const wait = this.o.goneAfterMs ?? DEFAULT_TIMING.goneAfterMs;
      this.connection.emit({ lost: true, deadline: this.o.clock.now() + wait });
    } else {
      this.connection.emit({ lost: false, deadline: null });
      if (status === 'gone') this.onOpponentGone('gone');
    }
  }

  private onOpponentGone(kind: 'left' | 'gone'): void {
    if (this.closed) return;
    this.opponentAway = true;
    const name = this.phaseValue.name;
    if (
      this.controller &&
      !this.controller.isOver &&
      (name === 'intro' || name === 'playing' || name === 'round-result')
    ) {
      this.endByForfeit(this.opponent, kind === 'left' ? 'left' : 'disconnect');
    } else if (name === 'match-result') {
      this.showMatchResult();
    } else {
      this.close(kind === 'left' ? 'opponent-left' : 'opponent-gone', null);
    }
  }

  private detectCheat(detail: string): void {
    if (this.closed || this.detail !== null) return;
    console.warn('[online] nesoulad dat:', detail);
    this.detail = detail;
    this.send({ type: 'cheat', match: this.matchNo, detail: detail.slice(0, 200) });
    this.endByForfeit(this.opponent, 'cheat');
  }

  private close(reason: CloseReason, detail: string | null): void {
    if (this.closed) return;
    this.closed = true;
    this.destroyRound();
    this.o.peer.close();
    this.setPhase({ name: 'closed', reason, detail });
  }

  private destroyRound(): void {
    const round = this.round;
    if (!round) return;
    round.ended = true;
    this.clearFallback(round);
    round.host?.destroy();
    round.guest?.destroy();
    this.round = null;
  }

  private setPhase(phase: OnlinePhase): void {
    this.phaseValue = phase;
    this.phases.emit(phase);
  }
}
