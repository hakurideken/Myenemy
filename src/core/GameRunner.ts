import type {
  AIContext,
  GameInfo,
  GameView,
  MiniGame,
  MiniGameModule,
  RoundContext,
  RoundEnd,
} from './MiniGame';
import { PLAYER_SLOTS, type Difficulty, type Outcome, type PlayerSlot } from './types';
import type { TimerHandle } from './util/clock';

export const AI_THINK_MIN_MS = 500;
export const AI_THINK_MAX_MS = 1500;

/**
 * Spojuje čistou logiku hry, vykreslení a „sedadla“ hráčů (člověk / AI / síť).
 * Stejný běh pro PvE, lokální i online režim.
 */
export class GameRunner<S, M, V, Sec = unknown> implements MiniGame {
  readonly info: GameInfo;
  private ctx: RoundContext | null = null;
  private current: { state: S } | null = null;
  private view: GameView<V> | null = null;
  private perspective: PlayerSlot = 'A';
  private canAct: PlayerSlot[] = [];
  private finished: Outcome | null = null;
  private destroyed = false;
  /** Hotseat: komu bylo zařízení naposledy předáno. */
  private holder: PlayerSlot | null = null;
  private handoffPending = false;
  private handoffTimer: TimerHandle | null = null;
  private endTimer: TimerHandle | null = null;
  private readonly endListeners: ((result: RoundEnd) => void)[] = [];
  private readonly aiTimers = new Map<PlayerSlot, TimerHandle>();
  private readonly moveTimers = new Map<
    PlayerSlot,
    { handle: TimerHandle; deadline: number; total: number }
  >();
  /** Online: hráči se zapečetěným (zatím neodhaleným) tahem. */
  private readonly committed = new Set<PlayerSlot>();
  /** Tajná data hráčů, která zná toto zařízení (lokální lidé a AI). */
  private readonly secrets = new Map<PlayerSlot, Sec>();
  /** Tajná data čekající na odeslání závazku. */
  private readonly pendingSecrets = new Set<PlayerSlot>();
  /** Čerstvě zadaná tajná data: true = zvolená automaticky (neaktivita). */
  private readonly freshSecrets = new Map<PlayerSlot, boolean>();

  constructor(private readonly game: MiniGameModule<S, M, V, Sec>) {
    this.info = { id: game.id, name: game.name, type: game.type, length: game.length };
  }

  init(ctx: RoundContext): void {
    this.ctx = ctx;
    this.current = { state: this.game.logic.setup({ rng: ctx.rng, starter: ctx.starter }) };
    const localPlayers = PLAYER_SLOTS.filter((p) => ctx.seats[p].kind === 'human');
    this.perspective = localPlayers[0] ?? 'A';
    const hidden = this.game.hidden;
    if (hidden) {
      for (const p of PLAYER_SLOTS) {
        if (ctx.seats[p].kind === 'ai') this.secrets.set(p, hidden.randomSecret(ctx.aiRng));
      }
    }
    this.view = this.game.createView({
      root: ctx.root,
      mode: ctx.mode,
      names: ctx.names,
      localPlayers,
      submit: (player, move) => {
        if (ctx.seats[player].kind === 'human' && this.canAct.includes(player)) {
          this.onInput(player, move);
        }
      },
      submitSecret: (player, secret) => {
        if (ctx.seats[player].kind === 'human' && this.canAct.includes(player)) {
          this.acceptSecret(player, secret, false);
        }
      },
      clock: ctx.clock,
      prefs: ctx.prefs,
      sfx: ctx.sfx,
    });
  }

  start(): void {
    this.step();
  }

  onInput(player: PlayerSlot, input: unknown): void {
    const parsed = this.game.moveSchema.safeParse(input);
    if (!parsed.success) {
      console.warn(`[${this.game.id}] nevalidní tah hráče ${player}`, parsed.error.issues);
      return;
    }
    this.applyMove(player, parsed.data);
  }

  onEnd(cb: (result: RoundEnd) => void): void {
    this.endListeners.push(cb);
  }

  /** Online hostitel: tah vzdáleného hráče (validace schématem i pravidly). */
  submitRemote(player: PlayerSlot, input: unknown): boolean {
    if (this.ctx?.seats[player].kind !== 'remote') return false;
    const parsed = this.game.moveSchema.safeParse(input);
    if (!parsed.success) {
      console.warn(`[${this.game.id}] nevalidní tah soupeře`, parsed.error.issues);
      return false;
    }
    return this.applyMove(player, parsed.data, false);
  }

  /** Online: soupeř poslal zapečetěný tah – zatím víme jen, že „má vybráno“. */
  markCommitted(player: PlayerSlot): void {
    if (this.destroyed || this.finished || !this.isToMove(player)) return;
    this.committed.add(player);
    this.render();
  }

  /**
   * Tah za hráče, který nereaguje. Vzdálenému hráči nejde zahrát tah z jeho tajných dat
   * (rozmístění, odpověď) – pak vrací false.
   */
  autoMove(player: PlayerSlot): boolean {
    if (this.destroyed || this.finished || !this.isToMove(player)) return false;
    const hidden = this.game.hidden;
    if (hidden && this.awaitsSecret(player)) {
      if (this.context.seats[player].kind === 'remote') return false;
      const secret = this.secrets.get(player);
      if (secret !== undefined) {
        const move = hidden.respond(this.game.logic.view(this.state, player), player, secret);
        return move !== null && this.applyMove(player, move, true);
      }
      if (this.pendingSecrets.has(player)) return false;
      return this.acceptSecret(player, hidden.randomSecret(this.context.aiRng), true);
    }
    return this.applyMove(player, this.inactiveMove(player), true);
  }

  isToMove(player: PlayerSlot): boolean {
    return this.current !== null && this.game.logic.toMove(this.state).includes(player);
  }

  /** Je hráč na tahu s tahem, který plyne z jeho tajných dat (rozmístění, odpověď)? */
  awaitsSecret(player: PlayerSlot): boolean {
    const hidden = this.game.hidden;
    if (!hidden || !this.current) return false;
    return hidden.awaitsSecret(this.game.logic.view(this.state, player), player);
  }

  /** Znovu pošle soupeři aktuální stav (např. po odmítnutém tahu). */
  republish(): void {
    this.publish();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearAllTimers();
    if (this.endTimer !== null) this.ctx?.clock.clearTimeout(this.endTimer);
    if (this.handoffTimer !== null) this.ctx?.clock.clearTimeout(this.handoffTimer);
    this.ctx?.showTurnTimer(null, 0);
    this.view?.destroy();
  }

  private get state(): S {
    if (!this.current) throw new Error('GameRunner: chybí init()');
    return this.current.state;
  }

  private get context(): RoundContext {
    if (!this.ctx) throw new Error('GameRunner: chybí init()');
    return this.ctx;
  }

  /**
   * Lokální hráč zadal tajná data. Online se nejdřív odešle závazek (hash) a teprve pak
   * hra pokračuje – soupeř tak ví, že data už nejde změnit.
   */
  private acceptSecret(player: PlayerSlot, input: unknown, auto: boolean): boolean {
    const hidden = this.game.hidden;
    if (!hidden || this.destroyed || this.finished) return false;
    if (this.secrets.has(player) || this.pendingSecrets.has(player)) return false;
    const parsed = hidden.secretSchema.safeParse(input);
    if (!parsed.success || !hidden.isValidSecret(parsed.data)) {
      console.warn(`[${this.game.id}] neplatná tajná data hráče ${player}`);
      return false;
    }
    const secret = parsed.data;
    const store = (): void => {
      this.pendingSecrets.delete(player);
      if (this.destroyed || this.finished) return;
      this.secrets.set(player, secret);
      this.freshSecrets.set(player, auto);
      this.clearMoveTimer(player);
      this.step();
    };
    const bridge = this.context.bridge;
    if (!bridge?.commitSecret) {
      store();
      return true;
    }
    this.pendingSecrets.add(player);
    this.render();
    bridge.commitSecret(player, secret).then(store, (err: unknown) => {
      this.pendingSecrets.delete(player);
      console.error(`[${this.game.id}] závazek tajných dat selhal`, err);
    });
    return true;
  }

  /**
   * @param notify false = tah plynoucí z tajných dat (odpověď); síť ho nepočítá jako
   *   rozhodnutí hráče, takže nenuluje ani nezvyšuje počítadlo neaktivity.
   */
  private applyMove(player: PlayerSlot, move: M, auto = false, notify = true): boolean {
    if (this.destroyed || this.finished || !this.current) return false;
    const { logic } = this.game;
    if (!logic.toMove(this.state).includes(player) || !logic.legal(this.state, player, move)) {
      console.warn(`[${this.game.id}] neplatný tah hráče ${player}`, move);
      return false;
    }
    this.current = { state: logic.apply(this.state, player, move) };
    this.committed.delete(player);
    this.clearMoveTimer(player);
    if (notify && this.context.seats[player].kind === 'human') {
      this.context.bridge?.localMove(player, move, auto);
    }
    this.step();
    return true;
  }

  private inactiveMove(player: PlayerSlot): M {
    const view = this.game.logic.view(this.state, player);
    return (
      this.game.inactiveMove?.(view) ?? this.game.getAIMove(view, this.aiContext(player, 'easy'))
    );
  }

  /** Tahy, které plynou ze známých tajných dat, se zahrají hned (bez čekání a předávání). */
  private autoRespond(toMove: readonly PlayerSlot[]): boolean {
    const hidden = this.game.hidden;
    if (!hidden) return false;
    for (const p of toMove) {
      const secret = this.secrets.get(p);
      if (secret === undefined) continue;
      const move = hidden.respond(this.game.logic.view(this.state, p), p, secret);
      if (move === null) continue;
      const fresh = this.freshSecrets.get(p);
      this.freshSecrets.delete(p);
      // První tah po zadání dat („připraven“) je rozhodnutí hráče, odpovědi ne.
      if (this.applyMove(p, move, fresh ?? false, fresh !== undefined)) return true;
    }
    return false;
  }

  private step(): void {
    if (this.destroyed || this.finished) return;
    const ctx = this.context;
    const outcome = this.game.logic.outcome(this.state);
    if (outcome) {
      this.finish(outcome);
      return;
    }

    const toMove = this.game.logic.toMove(this.state);
    if (this.autoRespond(toMove)) return;
    for (const p of toMove) {
      if (ctx.seats[p].kind === 'ai' && !this.aiTimers.has(p)) this.scheduleAI(p);
    }
    for (const p of [...this.moveTimers.keys()]) {
      if (!toMove.includes(p)) this.clearMoveTimer(p);
    }

    const humans = toMove.filter((p) => ctx.seats[p].kind === 'human');
    if (ctx.mode === 'local' && this.game.localLayout === 'hotseat') {
      this.stepHotseat(humans);
      return;
    }
    if (ctx.mode === 'local' && this.game.localLayout === 'shared' && humans[0]) {
      this.perspective = humans[0];
    }
    this.canAct = humans;
    this.render();
    this.armMoveTimers(humans);
  }

  private stepHotseat(humans: readonly PlayerSlot[]): void {
    // Současný tah: kdo zařízení právě drží, hraje první (o jedno předání míň).
    const next = this.holder !== null && humans.includes(this.holder) ? this.holder : humans[0];
    if (next === undefined) {
      this.canAct = [];
      this.render();
      return;
    }
    if (this.holder === next) {
      this.perspective = next;
      this.canAct = [next];
      this.render();
      this.armMoveTimers([next]);
      return;
    }
    if (this.handoffPending) return;
    this.handoffPending = true;
    this.canAct = [];
    const ctx = this.context;
    const handoff = (): void => {
      this.handoffTimer = null;
      if (this.destroyed || this.finished) return;
      void ctx.handoff(next).then(() => {
        this.handoffPending = false;
        if (this.destroyed || this.finished) return;
        this.holder = next;
        this.step();
      });
    };
    // Dosavadní držitel ještě chvíli vidí výsledek svého tahu (např. zásah / pudl).
    const delay = this.holder !== null ? (this.game.handoffDelayMs ?? 0) : 0;
    if (delay > 0) {
      this.render();
      this.handoffTimer = ctx.clock.setTimeout(handoff, delay);
    } else {
      handoff();
    }
  }

  private finish(outcome: Outcome): void {
    const ctx = this.context;
    this.finished = outcome;
    this.canAct = [];
    this.clearAllTimers();
    ctx.showTurnTimer(null, 0);
    this.render();

    for (const p of PLAYER_SLOTS) {
      const seat = ctx.seats[p];
      if (seat.kind === 'ai') {
        this.game.aiObserve?.(
          this.game.logic.view(this.state, p),
          this.aiContext(p, seat.difficulty),
        );
      }
    }
    const summary = this.game.summarize(
      this.game.logic.view(this.state, this.perspective),
      ctx.names,
    );
    this.endTimer = ctx.clock.setTimeout(() => {
      this.endTimer = null;
      if (this.destroyed) return;
      for (const cb of this.endListeners) cb({ outcome, summary });
    }, this.game.revealMs);
  }

  private render(): void {
    this.view?.render(this.game.logic.view(this.state, this.perspective), {
      perspective: this.perspective,
      canAct: this.canAct.filter((p) => !this.pendingSecrets.has(p)),
      finished: this.finished,
      committed: [...this.committed],
      secret: this.secrets.get(this.perspective) ?? null,
    });
    this.publish();
  }

  private publish(): void {
    const ctx = this.ctx;
    if (!ctx?.bridge || !this.current || this.destroyed) return;
    const toMove = this.game.logic.toMove(this.state);
    for (const p of PLAYER_SLOTS) {
      if (ctx.seats[p].kind !== 'remote') continue;
      ctx.bridge.publish({
        view: this.game.logic.view(this.state, p),
        canAct: this.finished === null && toMove.includes(p),
        committed: [...this.committed],
        finished: this.finished,
      });
    }
  }

  private aiContext(player: PlayerSlot, difficulty: Difficulty): AIContext {
    const ctx = this.context;
    return { difficulty, rng: ctx.aiRng, me: player, memory: ctx.aiMemory };
  }

  private scheduleAI(player: PlayerSlot): void {
    const ctx = this.context;
    const seat = ctx.seats[player];
    if (seat.kind !== 'ai') return;
    const ai = this.aiContext(player, seat.difficulty);
    const view = this.game.logic.view(this.state, player);
    const move = this.game.getAIMove(view, ai);
    const delay =
      this.game.aiDelayMs?.(view, move, ai) ?? ai.rng.range(AI_THINK_MIN_MS, AI_THINK_MAX_MS);

    const handle = ctx.clock.setTimeout(
      () => {
        this.aiTimers.delete(player);
        if (this.destroyed || this.finished) return;
        if (!this.game.logic.toMove(this.state).includes(player)) return;
        if (this.game.logic.legal(this.state, player, move)) {
          this.applyMove(player, move);
          return;
        }
        // Stav se během „přemýšlení“ změnil – spočítat tah znovu.
        this.applyMove(player, this.game.getAIMove(this.game.logic.view(this.state, player), ai));
      },
      Math.max(0, delay),
    );
    this.aiTimers.set(player, handle);
  }

  /** Limit na tah podle aktuální fáze hry (null = bez limitu). */
  private timeoutFor(player: PlayerSlot): number | null {
    const { game } = this;
    return game.moveTimeout
      ? game.moveTimeout(game.logic.view(this.state, player))
      : game.moveTimeoutMs;
  }

  private armMoveTimers(players: readonly PlayerSlot[]): void {
    const ctx = this.context;
    for (const p of players) {
      if (this.moveTimers.has(p) || this.pendingSecrets.has(p)) continue;
      const timeout = this.timeoutFor(p);
      if (timeout === null) continue;
      const handle = ctx.clock.setTimeout(() => this.onMoveTimeout(p), timeout);
      this.moveTimers.set(p, { handle, deadline: ctx.clock.now() + timeout, total: timeout });
    }
    this.updateTimerDisplay();
  }

  private onMoveTimeout(player: PlayerSlot): void {
    this.moveTimers.delete(player);
    if (this.destroyed || this.finished) return;
    this.autoMove(player);
  }

  private clearMoveTimer(player: PlayerSlot): void {
    const timer = this.moveTimers.get(player);
    if (!timer) return;
    this.context.clock.clearTimeout(timer.handle);
    this.moveTimers.delete(player);
    this.updateTimerDisplay();
  }

  private updateTimerDisplay(): void {
    const timer = this.moveTimers.get(this.perspective) ?? [...this.moveTimers.values()][0];
    this.context.showTurnTimer(
      timer ? timer.deadline : null,
      timer ? timer.total : (this.game.moveTimeoutMs ?? 0),
    );
  }

  private clearAllTimers(): void {
    const clock = this.ctx?.clock;
    if (!clock) return;
    for (const handle of this.aiTimers.values()) clock.clearTimeout(handle);
    for (const { handle } of this.moveTimers.values()) clock.clearTimeout(handle);
    this.aiTimers.clear();
    this.moveTimers.clear();
  }
}
