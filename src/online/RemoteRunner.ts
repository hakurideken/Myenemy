import type {
  GameInfo,
  GameView,
  MiniGame,
  MiniGameModule,
  RoundContext,
  RoundEnd,
} from '../core/MiniGame';
import type { Outcome, PlayerSlot } from '../core/types';
import type { TimerHandle } from '../core/util/clock';

export interface GuestLink {
  readonly me: PlayerSlot;
  send(move: unknown, auto: boolean): void;
  seal(move: unknown, auto: boolean): void;
}

export interface RemoteState {
  readonly view: unknown;
  readonly canAct: boolean;
  readonly committed: readonly PlayerSlot[];
  readonly finished: Outcome | null;
}

/**
 * Online host: herní logiku nespouští, jen vykresluje pohled, který mu posílá hostitel,
 * a odesílá své vstupy. Lhůtu na tah si hlídá sám (hostitel má navíc rezervu).
 */
export class RemoteRunner<S, M, V> implements MiniGame {
  readonly info: GameInfo;
  private ctx: RoundContext | null = null;
  private view: GameView<V> | null = null;
  private latest: (Omit<RemoteState, 'view'> & { readonly view: V }) | null = null;
  /** Po odeslání tahu, než přijde nový stav. */
  private locked = false;
  private sealedSent = false;
  private moveTimer: TimerHandle | null = null;
  private destroyed = false;
  private readonly endListeners: ((result: RoundEnd) => void)[] = [];

  constructor(
    private readonly game: MiniGameModule<S, M, V>,
    private readonly link: GuestLink,
  ) {
    this.info = { id: game.id, name: game.name, type: game.type, length: game.length };
  }

  init(ctx: RoundContext): void {
    this.ctx = ctx;
    this.view = this.game.createView({
      root: ctx.root,
      mode: ctx.mode,
      names: ctx.names,
      localPlayers: [this.link.me],
      submit: (player, move) => this.submit(player, move, false),
      clock: ctx.clock,
      prefs: ctx.prefs,
      sfx: ctx.sfx,
    });
  }

  start(): void {
    // Čeká na první stav od hostitele.
  }

  onInput(player: PlayerSlot, input: unknown): void {
    this.submit(player, input, false);
  }

  onEnd(cb: (result: RoundEnd) => void): void {
    this.endListeners.push(cb);
  }

  receiveState(state: RemoteState): void {
    if (this.destroyed) return;
    const parsed = this.game.viewSchema.safeParse(state.view);
    if (!parsed.success) {
      console.warn(`[${this.game.id}] nevalidní stav od hostitele zahozen`, parsed.error.issues);
      return;
    }
    this.latest = { ...state, view: parsed.data };
    this.locked = false;
    this.render();
    this.updateTimer();
  }

  receiveEnd(result: RoundEnd): void {
    if (this.destroyed) return;
    this.clearTimer();
    for (const cb of this.endListeners) cb(result);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearTimer();
    this.view?.destroy();
  }

  private get canAct(): boolean {
    const latest = this.latest;
    return (
      latest !== null &&
      latest.canAct &&
      latest.finished === null &&
      !this.locked &&
      !(this.game.sealed && this.sealedSent)
    );
  }

  private render(): void {
    if (!this.latest) return;
    this.view?.render(this.latest.view, {
      perspective: this.link.me,
      canAct: this.canAct ? [this.link.me] : [],
      finished: this.latest.finished,
      committed: this.latest.committed,
    });
  }

  private submit(player: PlayerSlot, input: unknown, auto: boolean): void {
    if (this.destroyed || player !== this.link.me || !this.canAct) return;
    const parsed = this.game.moveSchema.safeParse(input);
    if (!parsed.success) {
      console.warn(`[${this.game.id}] nevalidní vlastní tah`, parsed.error.issues);
      return;
    }
    this.clearTimer();
    if (this.game.sealed) {
      this.sealedSent = true;
      this.link.seal(parsed.data, auto);
    } else {
      this.locked = true;
      this.link.send(parsed.data, auto);
    }
    this.render();
  }

  private updateTimer(): void {
    const timeout = this.game.moveTimeoutMs;
    const ctx = this.ctx;
    if (timeout === null || !ctx || !this.canAct) {
      this.clearTimer();
      return;
    }
    if (this.moveTimer !== null) return;
    this.moveTimer = ctx.clock.setTimeout(() => this.onTimeout(), timeout);
    ctx.showTurnTimer(ctx.clock.now() + timeout, timeout);
  }

  private onTimeout(): void {
    this.moveTimer = null;
    const ctx = this.ctx;
    if (!ctx || !this.latest || !this.canAct) return;
    const view = this.latest.view;
    const move =
      this.game.inactiveMove?.(view) ??
      this.game.getAIMove(view, {
        difficulty: 'easy',
        rng: ctx.aiRng,
        me: this.link.me,
        memory: ctx.aiMemory,
      });
    this.submit(this.link.me, move, true);
  }

  private clearTimer(): void {
    if (this.moveTimer !== null) this.ctx?.clock.clearTimeout(this.moveTimer);
    this.moveTimer = null;
    this.ctx?.showTurnTimer(null, 0);
  }
}
