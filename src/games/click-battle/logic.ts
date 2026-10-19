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

const t = translations({ invalid: 'neplatné' }, { invalid: 'invalid' });

export const COUNTDOWN_MS = 3000;
export const DURATION_MS = 5000;
/** Víc než 25 kliknutí za sekundu člověk nezvládne – takový výsledek je neplatný. */
export const MAX_CLICKS = 125;

export type ClickResult =
  { readonly kind: 'clicks'; readonly count: number } | { readonly kind: 'invalid' };
export type ClickMove = { readonly kind: 'clicks'; readonly count: number };

export interface ClickState {
  readonly results: Partial<Record<PlayerSlot, ClickResult>>;
}

export interface ClickView {
  readonly mine: ClickResult | null;
  /** Soupeř už odeslal výsledek – samotné číslo se ukáže až na konci. */
  readonly opponentDone: boolean;
  readonly results: PerPlayer<ClickResult> | null;
}

const resultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('clicks'), count: z.number().int().min(0).max(MAX_CLICKS) }),
  z.object({ kind: z.literal('invalid') }),
]);

export const clickMoveSchema = z.object({
  kind: z.literal('clicks'),
  count: z.number().int().min(0).max(100_000),
});
export const clickViewSchema = z.object({
  mine: resultSchema.nullable(),
  opponentDone: z.boolean(),
  results: z.object({ A: resultSchema, B: resultSchema }).nullable(),
});

export function normalizeClicks(move: ClickMove): ClickResult {
  return move.count > MAX_CLICKS ? { kind: 'invalid' } : { kind: 'clicks', count: move.count };
}

/** Víc kliknutí vyhrává; neplatný výsledek prohrává; stejný počet je remíza. */
export function judgeClicks(a: ClickResult, b: ClickResult): Outcome {
  const value = (r: ClickResult): number => (r.kind === 'invalid' ? -1 : r.count);
  const va = value(a);
  const vb = value(b);
  if (va === vb) return DRAW;
  return win(va > vb ? 'A' : 'B');
}

export const clickLogic: GameLogic<ClickState, ClickMove, ClickView> = {
  setup: () => ({ results: {} }),
  toMove: (s) => PLAYER_SLOTS.filter((p) => s.results[p] === undefined),
  legal: (s, player) => s.results[player] === undefined,
  apply: (s, player, move) => {
    const results = { ...s.results };
    results[player] = normalizeClicks(move);
    return { results };
  },
  outcome: (s) => {
    const { A, B } = s.results;
    return A && B ? judgeClicks(A, B) : null;
  },
  view: (s, viewer) => {
    const { A, B } = s.results;
    return {
      mine: s.results[viewer] ?? null,
      opponentDone: s.results[otherPlayer(viewer)] !== undefined,
      results: A && B ? { A, B } : null,
    };
  },
};

export function formatClicks(result: ClickResult | undefined): string {
  if (!result) return '…';
  return result.kind === 'invalid' ? t.invalid : `${result.count}×`;
}
