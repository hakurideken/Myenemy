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

export const COUNTDOWN_MS = 3000;
/** Délky čísel v jednotlivých kolech (7 kol, 4 až 10 číslic). */
export const LENGTHS = [4, 5, 6, 7, 8, 9, 10] as const;
export const ROUNDS = LENGTHS.length;
export const MAX_DIGITS = 10;
export const MAX_POINTS = LENGTHS.reduce((sum, n) => sum + n, 0);
/** Jak dlouho číslo svítí: základ + čas na každou číslici. */
export const showMs = (length: number): number => 700 + 260 * length;
export const ANSWER_MS = 12_000;
export const FEEDBACK_MS = 1300;
/** Rychlejší zápis než 150 ms na číslici není lidský – výsledek je neplatný. */
export const MIN_DIGIT_MS = 150;

export interface DigitAnswer {
  /** Napsané číslice (může být kratší než zadání). */
  readonly digits: string;
  readonly ms: number;
}

export interface DigitMove {
  readonly kind: 'answers';
  readonly answers: readonly DigitAnswer[];
}

export type DigitResult =
  | { readonly kind: 'score'; readonly points: number; readonly ms: number }
  | { readonly kind: 'invalid' };

export interface DigitState {
  readonly numbers: readonly string[];
  readonly answers: Partial<Record<PlayerSlot, readonly DigitAnswer[]>>;
  readonly results: Partial<Record<PlayerSlot, DigitResult>>;
}

export interface DigitView {
  readonly numbers: readonly string[];
  readonly mine: DigitResult | null;
  readonly opponentDone: boolean;
  readonly results: PerPlayer<DigitResult> | null;
}

/** Body za kolo: každá číslice na správném místě. */
export function roundPoints(expected: string, answer: string): number {
  let points = 0;
  for (let i = 0; i < expected.length; i++) {
    if (answer[i] === expected[i]) points += 1;
  }
  return points;
}

export function scoreDigits(
  numbers: readonly string[],
  answers: readonly DigitAnswer[],
): DigitResult {
  if (answers.length !== numbers.length) return { kind: 'invalid' };
  let points = 0;
  let ms = 0;
  for (const [i, answer] of answers.entries()) {
    const expected = numbers[i] ?? '';
    if (answer.digits.length > expected.length) return { kind: 'invalid' };
    const got = roundPoints(expected, answer.digits);
    if (got > 0 && answer.ms < answer.digits.length * MIN_DIGIT_MS) return { kind: 'invalid' };
    points += got;
    ms += answer.ms;
  }
  return { kind: 'score', points, ms };
}

/** Víc bodů vyhrává; při shodě kratší celkový čas zápisu; jinak remíza. */
export function judgeDigits(a: DigitResult, b: DigitResult): Outcome {
  const value = (r: DigitResult): number => (r.kind === 'invalid' ? -1 : r.points);
  if (value(a) !== value(b)) return win(value(a) > value(b) ? 'A' : 'B');
  if (a.kind === 'score' && b.kind === 'score' && a.points > 0 && a.ms !== b.ms) {
    return win(a.ms < b.ms ? 'A' : 'B');
  }
  return DRAW;
}

export const digitLogic: GameLogic<DigitState, DigitMove, DigitView> = {
  setup: ({ rng }) => ({
    numbers: LENGTHS.map((length) =>
      // První číslice není nula (číslo vypadá jako číslo); jinak cokoli.
      Array.from({ length }, (_, i) => String(i === 0 ? 1 + rng.int(9) : rng.int(10))).join(''),
    ),
    answers: {},
    results: {},
  }),
  toMove: (s) => PLAYER_SLOTS.filter((p) => s.results[p] === undefined),
  legal: (s, player) => s.results[player] === undefined,
  apply: (s, player, move) => ({
    ...s,
    answers: { ...s.answers, [player]: move.answers },
    results: { ...s.results, [player]: scoreDigits(s.numbers, move.answers) },
  }),
  outcome: (s) => {
    const { A, B } = s.results;
    return A && B ? judgeDigits(A, B) : null;
  },
  view: (s, viewer) => {
    const { A, B } = s.results;
    return {
      numbers: s.numbers,
      mine: s.results[viewer] ?? null,
      opponentDone: s.results[otherPlayer(viewer)] !== undefined,
      results: A && B ? { A, B } : null,
    };
  },
};

const answerSchema = z.object({
  digits: z.string().regex(/^\d{0,10}$/),
  ms: z
    .number()
    .int()
    .min(0)
    .max(ANSWER_MS + 1000),
});
const resultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('score'),
    points: z.number().int().min(0).max(MAX_POINTS),
    ms: z
      .number()
      .int()
      .min(0)
      .max(ROUNDS * (ANSWER_MS + 1000)),
  }),
  z.object({ kind: z.literal('invalid') }),
]);

export const digitMoveSchema = z.object({
  kind: z.literal('answers'),
  answers: z.array(answerSchema).max(ROUNDS),
});

export const digitViewSchema = z.object({
  numbers: z.array(z.string().regex(/^\d{4,10}$/)).length(ROUNDS),
  mine: resultSchema.nullable(),
  opponentDone: z.boolean(),
  results: z.object({ A: resultSchema, B: resultSchema }).nullable(),
});
