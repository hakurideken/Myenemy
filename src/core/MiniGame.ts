import type { ZodType } from 'zod';
import type {
  Difficulty,
  GameId,
  GameLength,
  GameMode,
  GameType,
  Outcome,
  PerPlayer,
  PlayerSlot,
} from './types';
import type { Clock } from './util/clock';
import type { Rng } from './util/rng';

export interface GameInfo {
  readonly id: GameId;
  readonly name: string;
  readonly type: GameType;
  readonly length: GameLength;
}

export interface SetupEnv {
  readonly rng: Rng;
  readonly starter: PlayerSlot;
}

/** Čistá herní pravidla – žádný DOM, síť ani časovače. Stav je neměnný. */
export interface GameLogic<S, M, V> {
  setup(env: SetupEnv): S;
  /** Kdo smí právě táhnout; oba hráči = současný tah. */
  toMove(state: S): readonly PlayerSlot[];
  legal(state: S, player: PlayerSlot, move: M): boolean;
  apply(state: S, player: PlayerSlot, move: M): S;
  /** null = hraje se dál. Tady každá hra definuje, co je remíza. */
  outcome(state: S): Outcome | null;
  /** Jen to, co daný hráč smí vidět. */
  view(state: S, viewer: PlayerSlot): V;
}

/** Paměť AI napříč koly (např. historie tahů soupeře v KNP). */
export class AIMemory {
  private readonly store = new Map<string, unknown>();

  get<T>(key: string, init: () => T): T {
    if (!this.store.has(key)) this.store.set(key, init());
    return this.store.get(key) as T;
  }
}

export interface AIContext {
  readonly difficulty: Difficulty;
  readonly rng: Rng;
  readonly me: PlayerSlot;
  readonly memory: AIMemory;
}

export interface Prefs {
  readonly reducedMotion: boolean;
}

export type SfxName = 'signal' | 'click' | 'win' | 'lose' | 'draw' | 'tick';

export interface Sfx {
  play(name: SfxName): void;
  vibrate(pattern: number | readonly number[]): void;
}

export interface ViewContext<M> {
  readonly root: HTMLElement;
  readonly mode: GameMode;
  readonly names: PerPlayer<string>;
  /** Hráči, kteří hrají na tomto zařízení (PvE: ['A'], lokálně: ['A','B']). */
  readonly localPlayers: readonly PlayerSlot[];
  submit(player: PlayerSlot, move: M): void;
  readonly clock: Clock;
  readonly prefs: Prefs;
  readonly sfx: Sfx;
}

export interface RenderFrame {
  /** Čí pohled se vykresluje (v lokální hře se mění po předání zařízení). */
  readonly perspective: PlayerSlot;
  /** Lokální hráči, kteří právě smí zadat tah. */
  readonly canAct: readonly PlayerSlot[];
  readonly finished: Outcome | null;
}

export interface GameView<V> {
  render(view: V, frame: RenderFrame): void;
  destroy(): void;
}

/**
 * Jak se hra hraje lokálně na jednom zařízení:
 * split   – každý hráč má svou polovinu obrazovky / své klávesy (reakční hry),
 * shared  – společná deska bez tajných informací,
 * hotseat – tajná volba, mezi tahy obrazovka „Předej zařízení“.
 */
export type LocalLayout = 'split' | 'shared' | 'hotseat';

export interface MiniGameModule<S, M, V> extends GameInfo {
  readonly rules: readonly string[];
  controls(mode: GameMode): readonly string[];
  readonly localLayout: LocalLayout;
  /** Limit na tah (neaktivita → automatický tah). null = hra si časování řídí sama. */
  readonly moveTimeoutMs: number | null;
  /** Jak dlouho nechat vidět konec hry, než přijde výsledek kola. */
  readonly revealMs: number;
  readonly logic: GameLogic<S, M, V>;
  /** Validace vstupu (hlavně ze sítě). */
  readonly moveSchema: ZodType<M>;
  /** Lehká obtížnost musí vždy vrátit platný tah – používá se i jako automatický tah. */
  getAIMove(view: V, ai: AIContext): M;
  /** Za jak dlouho AI tah odehraje; výchozí je „přemýšlení“ 0,5–1,5 s. */
  aiDelayMs?(view: V, move: M, ai: AIContext): number;
  aiObserve?(finalView: V, ai: AIContext): void;
  summarize(finalView: V, names: PerPlayer<string>): string;
  createView(ctx: ViewContext<M>): GameView<V>;
}

export type AnyMiniGameModule = MiniGameModule<unknown, unknown, unknown>;

export function defineGame<S, M, V>(game: MiniGameModule<S, M, V>): AnyMiniGameModule {
  return game;
}

export type SeatConfig =
  | { readonly kind: 'human' }
  | { readonly kind: 'ai'; readonly difficulty: Difficulty }
  | { readonly kind: 'remote' };

export interface RoundContext {
  readonly root: HTMLElement;
  readonly mode: GameMode;
  readonly names: PerPlayer<string>;
  readonly seats: PerPlayer<SeatConfig>;
  readonly starter: PlayerSlot;
  /** Herní náhoda (deterministická ze seedu zápasu). */
  readonly rng: Rng;
  readonly aiRng: Rng;
  readonly aiMemory: AIMemory;
  readonly clock: Clock;
  readonly prefs: Prefs;
  readonly sfx: Sfx;
  handoff(to: PlayerSlot): Promise<void>;
  showTurnTimer(deadline: number | null, totalMs: number): void;
}

export interface RoundEnd {
  readonly outcome: Outcome;
  readonly summary: string;
}

/** Instance minihry pro jedno kolo – rozhraní ze zadání, implementuje ho GameRunner. */
export interface MiniGame {
  readonly info: GameInfo;
  init(ctx: RoundContext): void;
  start(): void;
  onInput(player: PlayerSlot, input: unknown): void;
  onEnd(cb: (result: RoundEnd) => void): void;
  destroy(): void;
}
