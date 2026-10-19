import { z } from 'zod';
import type { GameLogic } from '../../core/MiniGame';
import {
  DRAW,
  otherPlayer,
  PLAYER_SLOTS,
  win,
  type Outcome,
  type PerPlayer,
  type PlayerSlot,
} from '../../core/types';
import { translations } from '../../i18n';

/** Česky má barva tvar podle rodu tvaru: [mužský, ženský]. */
const COLOR_WORD_CS: Record<TargetColor, readonly [string, string]> = {
  red: ['červený', 'červená'],
  blue: ['modrý', 'modrá'],
  green: ['zelený', 'zelená'],
  yellow: ['žlutý', 'žlutá'],
};

const SHAPE_WORD_CS: Record<TargetShape, { readonly word: string; readonly feminine: boolean }> = {
  circle: { word: 'kruh', feminine: false },
  triangle: { word: 'trojúhelník', feminine: false },
  square: { word: 'čtverec', feminine: false },
  star: { word: 'hvězda', feminine: true },
};

const COLOR_WORD_EN: Record<TargetColor, string> = {
  red: 'red',
  blue: 'blue',
  green: 'green',
  yellow: 'yellow',
};

const SHAPE_WORD_EN: Record<TargetShape, string> = {
  circle: 'circle',
  triangle: 'triangle',
  square: 'square',
  star: 'star',
};

const t = translations(
  {
    targetLabel: (target: Target): string => {
      const shape = SHAPE_WORD_CS[target.shape];
      return `${COLOR_WORD_CS[target.color][shape.feminine ? 1 : 0]} ${shape.word}`;
    },
    miss: 'vedle',
    falseStart: 'předčasně',
    timeout: 'nestihl',
  },
  {
    targetLabel: (target: Target): string =>
      `${COLOR_WORD_EN[target.color]} ${SHAPE_WORD_EN[target.shape]}`,
    miss: 'miss',
    falseStart: 'too early',
    timeout: 'too late',
  },
);

export const COLORS = ['red', 'blue', 'green', 'yellow'] as const;
export const SHAPES = ['circle', 'triangle', 'square', 'star'] as const;
export type TargetColor = (typeof COLORS)[number];
export type TargetShape = (typeof SHAPES)[number];
export const TARGET_COUNT = 4;

export const DELAY_MIN_MS = 1200;
export const DELAY_MAX_MS = 3500;
export const TIMEOUT_MS = 3000;
export const MIN_REACTION_MS = 100;

export interface Target {
  readonly color: TargetColor;
  readonly shape: TargetShape;
}

export type ReflexResult =
  | { readonly kind: 'hit'; readonly ms: number }
  | { readonly kind: 'miss' }
  | { readonly kind: 'false-start' }
  | { readonly kind: 'timeout' };

export type ReflexMove =
  | { readonly kind: 'tap'; readonly index: number; readonly ms: number }
  | { readonly kind: 'false-start' }
  | { readonly kind: 'timeout' };

export interface ReflexState {
  readonly delayMs: number;
  readonly targets: readonly Target[];
  /** Index cíle, na který se má klepnout. */
  readonly target: number;
  readonly results: Partial<Record<PlayerSlot, ReflexResult>>;
}

export interface ReflexView {
  readonly delayMs: number;
  readonly targets: readonly Target[];
  readonly target: number;
  readonly mine: ReflexResult | null;
  readonly opponentDone: boolean;
  readonly results: PerPlayer<ReflexResult> | null;
}

const index = z
  .number()
  .int()
  .min(0)
  .max(TARGET_COUNT - 1);
const targetSchema = z.object({ color: z.enum(COLORS), shape: z.enum(SHAPES) });
const resultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hit'), ms: z.number().int().min(MIN_REACTION_MS).max(TIMEOUT_MS) }),
  z.object({ kind: z.literal('miss') }),
  z.object({ kind: z.literal('false-start') }),
  z.object({ kind: z.literal('timeout') }),
]);

export const reflexMoveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tap'), index, ms: z.number().min(0).max(60_000) }),
  z.object({ kind: z.literal('false-start') }),
  z.object({ kind: z.literal('timeout') }),
]);
export const reflexViewSchema = z.object({
  delayMs: z.number().int().min(DELAY_MIN_MS).max(DELAY_MAX_MS),
  targets: z.array(targetSchema).length(TARGET_COUNT),
  target: index,
  mine: resultSchema.nullable(),
  opponentDone: z.boolean(),
  results: z.object({ A: resultSchema, B: resultSchema }).nullable(),
});

/** Správnost klepnutí určuje logika (ne klient): jiný cíl = vedle, pod 100 ms = předčasně. */
export function normalizeReflex(move: ReflexMove, target: number): ReflexResult {
  if (move.kind !== 'tap') return move;
  const ms = Math.round(move.ms);
  if (ms < MIN_REACTION_MS) return { kind: 'false-start' };
  if (ms > TIMEOUT_MS) return { kind: 'timeout' };
  return move.index === target ? { kind: 'hit', ms } : { kind: 'miss' };
}

const rank = (r: ReflexResult): number => (r.kind === 'hit' ? 2 : r.kind === 'timeout' ? 1 : 0);

/**
 * Rychlejší správné klepnutí vyhrává. Chyba (vedle / předčasně) prohrává i proti tomu,
 * kdo nestihl. Remíza: oba chybují, oba nestihnou, nebo stejný čas.
 */
export function judgeReflex(a: ReflexResult, b: ReflexResult): Outcome {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return win(ra > rb ? 'A' : 'B');
  if (a.kind === 'hit' && b.kind === 'hit' && a.ms !== b.ms) return win(a.ms < b.ms ? 'A' : 'B');
  return DRAW;
}

export const reflexLogic: GameLogic<ReflexState, ReflexMove, ReflexView> = {
  setup: ({ rng }) => {
    // Každá barva i každý tvar je na desce jen jednou – cíl jde poznat i jen podle tvaru.
    const colors = rng.shuffle(COLORS);
    const shapes = rng.shuffle(SHAPES);
    return {
      delayMs: Math.round(rng.range(DELAY_MIN_MS, DELAY_MAX_MS)),
      targets: colors.map((color, i) => ({ color, shape: shapes[i] ?? 'circle' })),
      target: rng.int(TARGET_COUNT),
      results: {},
    };
  },
  toMove: (s) => PLAYER_SLOTS.filter((p) => s.results[p] === undefined),
  legal: (s, player) => s.results[player] === undefined,
  apply: (s, player, move) => {
    const results = { ...s.results };
    results[player] = normalizeReflex(move, s.target);
    return { ...s, results };
  },
  outcome: (s) => {
    const { A, B } = s.results;
    return A && B ? judgeReflex(A, B) : null;
  },
  view: (s, viewer) => {
    const { A, B } = s.results;
    return {
      delayMs: s.delayMs,
      targets: s.targets,
      target: s.target,
      mine: s.results[viewer] ?? null,
      opponentDone: s.results[otherPlayer(viewer)] !== undefined,
      results: A && B ? { A, B } : null,
    };
  },
};

/** „zelený trojúhelník“, „žlutá hvězda“ – se správným rodem. */
export function targetLabel(target: Target): string {
  return t.targetLabel(target);
}

export function formatReflex(result: ReflexResult | undefined): string {
  if (!result) return '…';
  switch (result.kind) {
    case 'hit':
      return `${result.ms} ms`;
    case 'miss':
      return t.miss;
    case 'false-start':
      return t.falseStart;
    case 'timeout':
      return t.timeout;
  }
}
