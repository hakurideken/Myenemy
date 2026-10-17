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
import { CheatError, SealedExchange, SecretExchange, SeedExchange } from './exchanges';
import { MentalPokerDealer } from './MentalPokerDealer';
import { RemoteRunner } from './RemoteRunner';

/** Rezerva navíc k lhůtě na tah, než hostitel zahraje za mlčícího hosta. */
export const REMOTE_GRACE_MS = 10_000;
/** Lhůta pro hry, které si časování řídí samy (reakční). */
export const UNTIMED_GAME_LIMIT_MS = 15_000;
/** Kolikrát po sobě automatický tah, než prohraje kontumací. */
export const AFK_FORFEIT_AFTER = 3;
/** Jak dlouho po konci hry čekat na odhalení tajných dat soupeře. */
export const REVEAL_WAIT_MS = 10_000;

type AnyRunner = GameRunner<unknown, unknown, unknown, unknown>;
type CardPlay = Extract<GameBody, { kind: 'move' | 'commit' | 'reveal' }>;

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
  /** Hry se skrytou informací: závazky a odhalení tajných dat. */
  readonly secrets: SecretExchange | null;
  host: AnyRunner | null;
  guest: RemoteRunner<unknown, unknown, unknown, unknown> | null;
  /**
   * Karetní hry: logiku spouštějí oba hráči (stav je veřejný, karty drží mental poker).
   * Hostitel má svůj runner v `host`, host v `peer`.
   */
  readonly dealer: MentalPokerDealer | null;
  peer: AnyRunner | null;
  /** Karty: tahy soupeře se zpracovávají přísně po sobě (odhalení je asynchronní). */
  cardChain: Promise<void>;
  /** Karty: runner je vytvořený (tahy soupeře na něj čekají). */
  readonly cardMounted: Promise<void>;
  markCardMounted: () => void;
  /** Karty: zapečetěné současné tahy podle pořadí. */
  readonly cardSteps: Map<number, SealedExchange>;
  ownSteps: number;
  /** Karty: výsledek podle vlastní logiky (host ho porovná s hostitelovým). */
  cardOutcome: Outcome | null;
  readonly cardOutcomeWaiters: ((outcome: Outcome | null) => void)[];
  /** Hostitel: poslední pohled odeslaný hostovi. */
  lastView: unknown;
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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

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
    if (
      !round ||
      !seed ||
      this.phaseValue.name !== 'playing' ||
      round.host ||
      round.guest ||
      round.peer
    ) {
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

    if (round.dealer) {
      this.mountCardRound(round, round.dealer, base);
    } else if (this.o.role === 'host') {
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
          commitSecret: (_player, secret) => this.commitSecret(round, secret),
        },
      });
      runner.onEnd((result) => this.hostRoundEnd(round, result));
      runner.start();
    } else {
      const runner = new RemoteRunner(game, {
        me: this.me,
        send: (move, auto) => this.sendGame(current, { kind: 'move', move, auto }),
        seal: (move, auto) => void round.sealed?.seal(move, auto),
        commitSecret: (secret) => this.commitSecret(round, secret),
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
      round.peer?.destroy();
    };
  }

  /** Karetní hra: vlastní runner u obou hráčů, tahy se posílají oběma směry. */
  private mountCardRound(
    round: RoundState,
    dealer: MentalPokerDealer,
    base: Omit<RoundContext, 'seats' | 'bridge'>,
  ): void {
    const runner = new GameRunner(round.game);
    if (this.o.role === 'host') round.host = runner;
    else round.peer = runner;
    runner.init({
      ...base,
      seats:
        this.me === 'A'
          ? { A: { kind: 'human' }, B: { kind: 'remote' } }
          : { A: { kind: 'remote' }, B: { kind: 'human' } },
      dealer,
      bridge: {
        publish: (update) => this.cardPublish(round, update),
        localMove: (_player, move, auto, simultaneous) =>
          this.cardLocalMove(round, move, auto, simultaneous),
      },
    });
    if (this.o.role === 'host') runner.onEnd((result) => this.hostRoundEnd(round, result));
    runner.start();
    round.markCardMounted();
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
    const mounted = deferred();
    this.round = {
      current,
      game,
      sealed: game.sealed ? new SealedExchange(this.me, (m) => this.sendGame(current, m)) : null,
      secrets: game.hidden ? new SecretExchange(this.me, (m) => this.sendGame(current, m)) : null,
      host: null,
      guest: null,
      dealer: game.cards
        ? new MentalPokerDealer(
            this.me,
            game.cards.deckSize,
            (m) => this.sendGame(current, m),
            (detail) => this.detectCheat(detail),
          )
        : null,
      peer: null,
      cardChain: Promise.resolve(),
      cardMounted: mounted.promise,
      markCardMounted: mounted.resolve,
      cardSteps: new Map(),
      ownSteps: 0,
      cardOutcome: null,
      cardOutcomeWaiters: [],
      lastView: null,
      pendingState: null,
      latestState: null,
      revealCheck: null,
      stateSeq: 0,
      fallback: null,
      ended: false,
    };
    this.setPhase({ name: 'playing', current });
    // Míchání začne hned, ještě než se kolo vykreslí.
    this.round.dealer?.start();
  }

  private commitSecret(round: RoundState, secret: unknown): Promise<void> {
    if (!round.secrets) return Promise.reject(new Error('Hra nemá tajná data.'));
    return round.secrets.commit(secret);
  }

  private publish(round: RoundState, update: RemoteUpdate): void {
    if (this.round !== round || round.ended) return;
    round.stateSeq += 1;
    round.lastView = update.view;
    this.sendGame(round.current, {
      kind: 'state',
      seq: round.stateSeq,
      view: update.view,
      canAct: update.canAct,
      committed: [...update.committed],
      finished: update.finished,
    });
    // Konec hry: teprve teď smí soupeř vidět tajná data (k ověření odpovědí).
    if (update.finished !== null) round.secrets?.reveal();
    if (update.canAct && update.finished === null) {
      if (round.fallback === null) {
        const { game } = round;
        const timeout = game.moveTimeout ? game.moveTimeout(update.view) : game.moveTimeoutMs;
        const limit = (timeout ?? UNTIMED_GAME_LIMIT_MS) + REMOTE_GRACE_MS;
        round.fallback = this.o.clock.setTimeout(() => this.onRemoteSilent(round), limit);
      }
    } else {
      this.clearFallback(round);
    }
  }

  // ---------- Karetní hry ----------

  /** Runner karetní hry na tomto zařízení. */
  private cardRunner(round: RoundState): AnyRunner | null {
    return this.o.role === 'host' ? round.host : round.peer;
  }

  private cardPublish(round: RoundState, update: RemoteUpdate): void {
    if (this.round !== round || round.ended) return;
    if (update.finished !== null && round.cardOutcome === null) {
      round.cardOutcome = update.finished;
      for (const resolve of round.cardOutcomeWaiters.splice(0)) resolve(update.finished);
      // Po konci hry už klíče nic neprozradí – soupeř si ověří celý balíček.
      round.dealer?.sendAudit();
    }
    if (this.o.role !== 'host') return;
    if (update.canAct && update.finished === null) {
      if (round.fallback === null) {
        const limit = (round.game.moveTimeoutMs ?? UNTIMED_GAME_LIMIT_MS) + REMOTE_GRACE_MS;
        round.fallback = this.o.clock.setTimeout(() => this.onRemoteSilent(round), limit);
      }
    } else {
      this.clearFallback(round);
    }
  }

  private cardLocalMove(
    round: RoundState,
    move: unknown,
    auto: boolean,
    simultaneous: boolean,
  ): void {
    if (this.round !== round || round.ended) return;
    this.countAfk(this.me, auto);
    // Klíče k vyloženým kartám jdou napřed, ať soupeř tah hned ověří.
    const claims = round.game.cards?.claims(move) ?? [];
    round.dealer?.reveal(claims.map((c) => c.pos));
    if (simultaneous) {
      // Současný tah (oba se rozhodují naráz): nejdřív závazek, odhalení až po soupeřově.
      void this.cardStep(round, round.ownSteps++).seal(move, auto);
    } else {
      this.sendGame(round.current, { kind: 'move', move, auto });
    }
  }

  private cardStep(round: RoundState, step: number): SealedExchange {
    let exchange = round.cardSteps.get(step);
    if (!exchange) {
      exchange = new SealedExchange(this.me, (m) => this.sendGame(round.current, { ...m, step }));
      round.cardSteps.set(step, exchange);
    }
    return exchange;
  }

  /** Tahy soupeře v karetní hře – po sobě, až když je balíček připravený. */
  private cardMessage(round: RoundState, msg: CardPlay): void {
    const dealer = round.dealer;
    if (!dealer) return;
    round.cardChain = round.cardChain
      .then(() => Promise.all([dealer.ready(), round.cardMounted]))
      .then(() => this.applyCardMessage(round, msg))
      .catch((err: unknown) => console.error('[online] karetní tah', err));
  }

  private async applyCardMessage(round: RoundState, msg: CardPlay): Promise<void> {
    const runner = this.cardRunner(round);
    if (
      this.round !== round ||
      round.ended ||
      !runner ||
      ('player' in msg && msg.player !== this.opponent)
    ) {
      return;
    }
    switch (msg.kind) {
      case 'move':
        this.countAfk(this.opponent, msg.auto);
        this.applyCardMove(round, runner, msg.move);
        break;
      case 'commit':
        if (this.cardStep(round, msg.step ?? 0).receiveCommit(msg.hash)) {
          this.countAfk(this.opponent, msg.auto);
          runner.markCommitted(this.opponent);
        }
        break;
      case 'reveal': {
        const ok = await this.cardStep(round, msg.step ?? 0).receiveReveal(msg.move, msg.salt);
        if (this.round !== round || round.ended) return;
        if (!ok) this.detectCheat('Soupeř odhalil jiný tah, než ke kterému se zavázal.');
        else this.applyCardMove(round, runner, msg.move);
        break;
      }
    }
  }

  private applyCardMove(round: RoundState, runner: AnyRunner, input: unknown): void {
    const { game, dealer } = round;
    const parsed = game.moveSchema.safeParse(input);
    if (!parsed.success) {
      this.detectCheat('Soupeř poslal nevalidní tah.');
      return;
    }
    const claims = game.cards?.claims(parsed.data) ?? [];
    if (claims.length > 0 && !dealer?.check(claims)) {
      this.detectCheat('Soupeř vyložil kartu, kterou nemá.');
      return;
    }
    this.clearFallback(round);
    // Oba hráči mají stejný stav – neplatný tah znamená upravený klient.
    if (!runner.submitRemote(this.opponent, parsed.data)) {
      this.detectCheat('Soupeř zahrál tah, který pravidla nedovolují.');
    }
  }

  /** Host: výsledek z vlastní logiky (čeká, až hra doběhne i u něj). */
  private waitCardOutcome(round: RoundState): Promise<Outcome | null> {
    if (round.cardOutcome) return Promise.resolve(round.cardOutcome);
    return new Promise((resolve) => {
      round.cardOutcomeWaiters.push(resolve);
      this.o.clock.setTimeout(() => resolve(null), REVEAL_WAIT_MS);
    });
  }

  private async verifyCardRound(
    round: RoundState,
    outcome: Outcome | null,
  ): Promise<string | null> {
    const dealer = round.dealer;
    if (!dealer) return null;
    if (outcome !== null) {
      const mine = await this.waitCardOutcome(round);
      if (!mine) return 'Hra u tebe neskončila, ale hostitel tvrdí, že ano.';
      if (canonicalJson(mine) !== canonicalJson(outcome)) {
        return 'Výsledek kola od hostitele nesouhlasí s odehranou hrou.';
      }
    }
    return dealer.waitAudit((cb) => {
      this.o.clock.setTimeout(cb, REVEAL_WAIT_MS);
    });
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
    // Karty: stav drží i host, takže za něj hostitel táhnout nemůže.
    if (round.dealer) {
      this.forfeitAfk(this.opponent);
      return;
    }
    if (runner.autoMove(this.opponent)) this.countAfk(this.opponent, true);
    // Tah z tajných dat (rozmístění, odpověď) za soupeře zahrát nejde.
    else this.forfeitAfk(this.opponent);
  }

  private clearFallback(round: RoundState): void {
    if (round.fallback !== null) this.o.clock.clearTimeout(round.fallback);
    round.fallback = null;
  }

  private countAfk(player: PlayerSlot, auto: boolean): void {
    if (this.o.role !== 'host') return;
    this.afk[player] = auto ? this.afk[player] + 1 : 0;
    if (this.afk[player] >= AFK_FORFEIT_AFTER) this.forfeitAfk(player);
  }

  private forfeitAfk(player: PlayerSlot): void {
    if (this.o.role !== 'host' || !this.controller || this.controller.isOver) return;
    this.send({
      type: 'match-end',
      match: this.matchNo,
      winner: otherPlayer(player),
      reason: 'afk',
    });
    this.endByForfeit(player, 'afk');
  }

  private hostRoundEnd(round: RoundState, result: RoundEnd): void {
    if (this.round !== round || round.ended || !this.controller) return;
    round.ended = true;
    this.clearFallback(round);
    if (round.dealer) {
      // Karty: výsledek až po ověření celého balíčku (audit klíčů).
      void this.verifyCardRound(round, null).then((problem) => {
        if (this.round !== round || this.closed) return;
        if (problem) this.detectCheat(problem);
        else this.finishHostRound(round, result);
      });
      return;
    }
    if (round.secrets) {
      // Výsledek se pošle až po ověření, že soupeř odpovídal podle svých tajných dat.
      void this.verifyOpponentSecret(round, round.lastView).then((problem) => {
        if (this.round !== round || this.closed) return;
        if (problem) this.detectCheat(problem);
        else this.finishHostRound(round, result);
      });
      return;
    }
    this.finishHostRound(round, result);
  }

  private finishHostRound(round: RoundState, result: RoundEnd): void {
    if (!this.controller) return;
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
    const problem = round.dealer
      ? await this.verifyCardRound(round, body.outcome)
      : round.sealed
        ? await this.verifySealedRound(round, body.outcome)
        : round.secrets
          ? await this.verifyHiddenRound(round, body.outcome)
          : null;
    if (problem) {
      this.detectCheat(problem);
      return;
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

  /**
   * Host: výsledek musí plynout ze závěrečného stavu, hostitel nesměl změnit odpovědi
   * hosta a jeho vlastní odpovědi musí sedět s odhalenými tajnými daty.
   */
  private async verifyHiddenRound(round: RoundState, outcome: Outcome): Promise<string | null> {
    const { game, secrets } = round;
    const hidden = game.hidden;
    if (!hidden || !secrets) return null;
    const parsed = round.latestState ? game.viewSchema.safeParse(round.latestState.view) : null;
    if (!parsed?.success) return 'Chybí závěrečný stav kola.';
    const expected = hidden.outcome(parsed.data);
    if (!expected || canonicalJson(expected) !== canonicalJson(outcome)) {
      return 'Výsledek kola od hostitele nesouhlasí se stavem hry.';
    }
    if (secrets.hasCommitted && !hidden.consistent(parsed.data, this.me, secrets.ownSecret)) {
      return 'Hostitel pozměnil tvoje odpovědi.';
    }
    return this.verifyOpponentSecret(round, parsed.data);
  }

  /** Počká na odhalení tajných dat soupeře a ověří je proti závazku i jeho odpovědím. */
  private async verifyOpponentSecret(
    round: RoundState,
    finalView: unknown,
  ): Promise<string | null> {
    const { game, secrets } = round;
    const hidden = game.hidden;
    if (!hidden || !secrets) return null;
    const reveal = await secrets.waitReveal((cb) => {
      this.o.clock.setTimeout(cb, REVEAL_WAIT_MS);
    });
    if (reveal.kind === 'missing') return 'Soupeř neodhalil svá tajná data.';
    if (reveal.kind === 'mismatch') return 'Tajná data soupeře neodpovídají jeho závazku.';
    const parsed = hidden.secretSchema.safeParse(reveal.secret);
    if (!parsed.success || !hidden.isValidSecret(parsed.data)) {
      return 'Soupeř měl neplatná tajná data.';
    }
    if (!hidden.consistent(finalView, this.opponent, parsed.data)) {
      return 'Soupeř během hry odpovídal v rozporu se svými tajnými daty.';
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
    if (!round || roundKey(round.current) !== roundKey(body)) return;
    const msg = body.body;
    // Odhalení tajných dat chodí i po konci hry (čeká se na ně při ověřování).
    if (msg.kind === 'secret-reveal') {
      if (msg.player === this.opponent) void round.secrets?.receiveReveal(msg.secret, msg.salt);
      return;
    }
    // Mental poker: míchání, klíče a audit (audit chodí i po konci hry).
    if (msg.kind === 'deck' || msg.kind === 'card-keys' || msg.kind === 'deck-audit') {
      round.dealer?.receive(msg);
      return;
    }
    if (round.ended) return;
    if (round.dealer) {
      if (msg.kind === 'move' || msg.kind === 'commit' || msg.kind === 'reveal') {
        this.cardMessage(round, msg);
      }
      return;
    }
    if (this.o.role === 'host') this.hostGameMessage(round, msg);
    else this.guestGameMessage(round, msg);
  }

  private hostGameMessage(round: RoundState, msg: GameBody): void {
    const runner = round.host;
    if (!runner) return;
    switch (msg.kind) {
      case 'move': {
        if (round.sealed) {
          console.warn('[online] nezapečetěný tah v zapečetěné hře zahozen');
          return;
        }
        if (round.secrets && !round.secrets.opponentCommitted) {
          console.warn('[online] tah před závazkem k tajným datům zahozen');
          runner.republish();
          return;
        }
        // Odpovědi z tajných dat nejsou rozhodnutí hráče – neaktivitu nepočítají.
        if (!runner.awaitsSecret(this.opponent)) this.countAfk(this.opponent, msg.auto);
        // Nový tah = nová lhůta (jinak by se hostovi sčítal čas několika tahů za sebou).
        this.clearFallback(round);
        if (!runner.submitRemote(this.opponent, msg.move)) runner.republish();
        break;
      }
      case 'secret-commit':
        if (msg.player === this.opponent) round.secrets?.receiveCommit(msg.hash);
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

  /** Host: hostitel se musí zavázat dřív, než hra začne, a odhalí se až po konci. */
  private guestHiddenState(round: RoundState, msg: StateBody): boolean {
    const hidden = round.game.hidden;
    const secrets = round.secrets;
    if (!hidden || !secrets) return true;
    const parsed = round.game.viewSchema.safeParse(msg.view);
    if (!parsed.success) return true;
    if (hidden.locked(parsed.data) && !secrets.opponentCommitted) {
      this.detectCheat('Hostitel se nezavázal ke svým tajným datům před začátkem hry.');
      return false;
    }
    if (msg.finished !== null && hidden.outcome(parsed.data) !== null) secrets.reveal();
    return true;
  }

  private guestGameMessage(round: RoundState, msg: GameBody): void {
    switch (msg.kind) {
      case 'state':
        if (!this.guestHiddenState(round, msg)) return;
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
      case 'secret-commit':
        if (msg.player === this.opponent) round.secrets?.receiveCommit(msg.hash);
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
    round.peer?.destroy();
    for (const resolve of round.cardOutcomeWaiters.splice(0)) resolve(null);
    this.round = null;
  }

  private setPhase(phase: OnlinePhase): void {
    this.phaseValue = phase;
    this.phases.emit(phase);
  }
}
