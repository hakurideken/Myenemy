import { z } from 'zod';
import type { GameLogic } from '../../core/MiniGame';
import { DRAW, PLAYER_SLOTS, win, type Outcome, type PlayerSlot } from '../../core/types';

/** Rychlejší „reakce“ je odhad, ne reakce – počítá se jako předčasný výstřel (jako ve sprintu). */
export const MIN_REACTION_MS = 100;
export const REACTION_TIMEOUT_MS = 2000;
export const DELAY_MIN_MS = 1500;
export const DELAY_MAX_MS = 4500;

export type QuickDrawResult =
  | { readonly kind: 'reacted'; readonly ms: number }
  | { readonly kind: 'false-start' }
  | { readonly kind: 'timeout' };

export type QuickDrawMove = QuickDrawResult;

export interface QuickDrawState {
  /** Prodleva od startu do signálu – stejná pro oba hráče, ze seedu kola. */
  readonly delayMs: number;
  readonly results: Partial<Record<PlayerSlot, QuickDrawResult>>;
}

export type QuickDrawView = QuickDrawState;

export const quickDrawMoveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reacted'), ms: z.number().min(0).max(60_000) }),
  z.object({ kind: z.literal('false-start') }),
  z.object({ kind: z.literal('timeout') }),
]);

export const quickDrawViewSchema = z.object({
  delayMs: z.number().int().min(DELAY_MIN_MS).max(DELAY_MAX_MS),
  results: z.object({ A: quickDrawMoveSchema.optional(), B: quickDrawMoveSchema.optional() }),
});

export function normalizeResult(move: QuickDrawMove): QuickDrawResult {
  if (move.kind !== 'reacted') return move;
  const ms = Math.round(move.ms);
  if (ms < MIN_REACTION_MS) return { kind: 'false-start' };
  if (ms > REACTION_TIMEOUT_MS) return { kind: 'timeout' };
  return { kind: 'reacted', ms };
}

const rank = (r: QuickDrawResult): number =>
  r.kind === 'false-start' ? 0 : r.kind === 'timeout' ? 1 : 2;

/**
 * Remíza: oba předčasně, oba nestihli, nebo stejný čas na milisekundu.
 * Předčasný výstřel prohrává vždy (i proti tomu, kdo nestihl).
 */
export function judge(a: QuickDrawResult, b: QuickDrawResult): Outcome {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return win(ra > rb ? 'A' : 'B');
  if (a.kind === 'reacted' && b.kind === 'reacted' && a.ms !== b.ms) {
    return win(a.ms < b.ms ? 'A' : 'B');
  }
  return DRAW;
}

export const quickDrawLogic: GameLogic<QuickDrawState, QuickDrawMove, QuickDrawView> = {
  setup: ({ rng }) => ({ delayMs: Math.round(rng.range(DELAY_MIN_MS, DELAY_MAX_MS)), results: {} }),
  toMove: (state) => PLAYER_SLOTS.filter((p) => state.results[p] === undefined),
  legal: (state, player) => state.results[player] === undefined,
  apply: (state, player, move) => {
    const results = { ...state.results };
    results[player] = normalizeResult(move);
    return { ...state, results };
  },
  outcome: (state) => {
    const { A, B } = state.results;
    return A && B ? judge(A, B) : null;
  },
  view: (state) => ({ delayMs: state.delayMs, results: { ...state.results } }),
};

export function formatResult(result: QuickDrawResult | undefined): string {
  if (!result) return '…';
  if (result.kind === 'reacted') return `${result.ms} ms`;
  return result.kind === 'false-start' ? 'předčasně' : 'nestihl';
}
