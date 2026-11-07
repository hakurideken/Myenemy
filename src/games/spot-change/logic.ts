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
import type { Rng } from '../../core/util/rng';

export const COUNTDOWN_MS = 3000;
export const COLS = 4;
export const ROWS = 4;
export const CELLS = COLS * ROWS;
/** Počet obrázků (stejné jako v Pexesu). */
export const PICTURES = 15;
export const ROUNDS = 7;
/** Obrázků na desce v jednotlivých kolech – přitvrzuje se. */
export const ITEMS = [5, 6, 6, 7, 8, 9, 10] as const;
/** Jak dlouho jde desku prohlížet (ms). */
export const MEMORIZE_MS = [3600, 3400, 3200, 3000, 2800, 2600, 2400] as const;
export const BLANK_MS = 700;
export const ANSWER_MS = 8000;
export const FEEDBACK_MS = 1000;
/** Rychlejší správná odpověď než 200 ms není lidská – výsledek je neplatný. */
export const MIN_ANSWER_MS = 200;

export type ChangeKind = 'gone' | 'new' | 'swap';

/** Deska: obrázek na políčku, nebo null. */
export type Board = readonly (number | null)[];

export interface SpotRound {
  readonly before: Board;
  readonly after: Board;
  readonly kind: ChangeKind;
  /** Políčko, kde se to změnilo – na něj se kliká. */
  readonly cell: number;
}

export interface SpotAnswer {
  /** -1 = bez odpovědi. */
  readonly cell: number;
  readonly ms: number;
}

export interface SpotMove {
  readonly kind: 'answers';
  readonly answers: readonly SpotAnswer[];
}

export type SpotResult =
  | { readonly kind: 'score'; readonly correct: number; readonly ms: number }
  | { readonly kind: 'invalid' };

export interface SpotState {
  readonly rounds: readonly SpotRound[];
  readonly answers: Partial<Record<PlayerSlot, readonly SpotAnswer[]>>;
  readonly results: Partial<Record<PlayerSlot, SpotResult>>;
}

export interface SpotView {
  readonly rounds: readonly SpotRound[];
  readonly mine: SpotResult | null;
  readonly opponentDone: boolean;
  readonly results: PerPlayer<SpotResult> | null;
  /** Odpovědi obou – až na konci (ať je vidět, kdo co trefil). */
  readonly answers: PerPlayer<readonly SpotAnswer[]> | null;
}

function makeRound(rng: Rng, items: number): SpotRound {
  const cells = rng.shuffle(Array.from({ length: CELLS }, (_, i) => i));
  const pictures = rng.shuffle(Array.from({ length: PICTURES }, (_, i) => i));
  const before: (number | null)[] = Array.from({ length: CELLS }, () => null);
  for (let i = 0; i < items; i++) {
    const cell = cells[i];
    const picture = pictures[i];
    if (cell !== undefined && picture !== undefined) before[cell] = picture;
  }
  const after = [...before];
  const kind = rng.pick(['gone', 'new', 'swap'] as const);
  let cell: number;
  if (kind === 'new') {
    // Nový obrázek na prázdné políčko (obrázek, který na desce není).
    cell = cells[items] ?? 0;
    after[cell] = pictures[items] ?? 0;
  } else {
    cell = cells[rng.int(items)] ?? 0;
    after[cell] = kind === 'gone' ? null : (pictures[items] ?? 0);
  }
  return { before, after, kind, cell };
}

export function scoreAnswers(
  rounds: readonly SpotRound[],
  answers: readonly SpotAnswer[],
): SpotResult {
  if (answers.length !== rounds.length) return { kind: 'invalid' };
  let correct = 0;
  let ms = 0;
  for (const [i, answer] of answers.entries()) {
    if (answer.cell !== rounds[i]?.cell) continue;
    if (answer.ms < MIN_ANSWER_MS) return { kind: 'invalid' };
    correct += 1;
    ms += answer.ms;
  }
  return { kind: 'score', correct, ms };
}

/** Víc správných vyhrává; při shodě kratší součet časů správných odpovědí. */
export function judgeSpots(a: SpotResult, b: SpotResult): Outcome {
  const value = (r: SpotResult): number => (r.kind === 'invalid' ? -1 : r.correct);
  if (value(a) !== value(b)) return win(value(a) > value(b) ? 'A' : 'B');
  if (a.kind === 'score' && b.kind === 'score' && a.correct > 0 && a.ms !== b.ms) {
    return win(a.ms < b.ms ? 'A' : 'B');
  }
  return DRAW;
}

export const spotLogic: GameLogic<SpotState, SpotMove, SpotView> = {
  setup: ({ rng }) => ({
    rounds: ITEMS.map((items) => makeRound(rng, items)),
    answers: {},
    results: {},
  }),
  toMove: (s) => PLAYER_SLOTS.filter((p) => s.results[p] === undefined),
  legal: (s, player) => s.results[player] === undefined,
  apply: (s, player, move) => ({
    ...s,
    answers: { ...s.answers, [player]: move.answers },
    results: { ...s.results, [player]: scoreAnswers(s.rounds, move.answers) },
  }),
  outcome: (s) => {
    const { A, B } = s.results;
    return A && B ? judgeSpots(A, B) : null;
  },
  view: (s, viewer) => {
    const { A, B } = s.results;
    const done = A !== undefined && B !== undefined;
    return {
      rounds: s.rounds,
      mine: s.results[viewer] ?? null,
      opponentDone: s.results[otherPlayer(viewer)] !== undefined,
      results: A && B ? { A, B } : null,
      answers: done ? { A: s.answers.A ?? [], B: s.answers.B ?? [] } : null,
    };
  },
};

const cellSchema = z
  .number()
  .int()
  .min(0)
  .max(CELLS - 1);
const boardSchema = z
  .array(
    z
      .number()
      .int()
      .min(0)
      .max(PICTURES - 1)
      .nullable(),
  )
  .length(CELLS);
const answerSchema = z.object({
  cell: z
    .number()
    .int()
    .min(-1)
    .max(CELLS - 1),
  ms: z
    .number()
    .int()
    .min(0)
    .max(ANSWER_MS + 1000),
});
const resultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('score'),
    correct: z.number().int().min(0).max(ROUNDS),
    ms: z
      .number()
      .int()
      .min(0)
      .max(ROUNDS * (ANSWER_MS + 1000)),
  }),
  z.object({ kind: z.literal('invalid') }),
]);

export const spotMoveSchema = z.object({
  kind: z.literal('answers'),
  answers: z.array(answerSchema).max(ROUNDS),
});

export const spotViewSchema = z.object({
  rounds: z
    .array(
      z.object({
        before: boardSchema,
        after: boardSchema,
        kind: z.enum(['gone', 'new', 'swap']),
        cell: cellSchema,
      }),
    )
    .length(ROUNDS),
  mine: resultSchema.nullable(),
  opponentDone: z.boolean(),
  results: z.object({ A: resultSchema, B: resultSchema }).nullable(),
  answers: z
    .object({ A: z.array(answerSchema).max(ROUNDS), B: z.array(answerSchema).max(ROUNDS) })
    .nullable(),
});
