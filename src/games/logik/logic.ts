import { z } from 'zod';
import type { GameLogic, HiddenInfo } from '../../core/MiniGame';
import {
  DRAW,
  otherPlayer,
  win,
  type Outcome,
  type PerPlayer,
  type PlayerSlot,
} from '../../core/types';
import type { Rng } from '../../core/util/rng';

/** 4 pozice, 6 barev (barvy se smějí opakovat), nejvýš 10 pokusů. */
export const PEGS = 4;
export const COLORS = 6;
export const MAX_ROUNDS = 10;

export type Code = readonly number[];

/** Odpověď pro jednu pozici tipu: barva i místo, jen barva (je jinde v kódu), nic. */
export type Mark = 'exact' | 'color' | 'none';
export const MARKS = ['exact', 'color', 'none'] as const;

/** Odpověď po pozicích, ve stejném pořadí jako tip. */
export type Feedback = readonly Mark[];

export interface Guess {
  readonly code: Code;
  /** Odpověď soupeře; null = ještě neodpověděl. */
  readonly feedback: Feedback | null;
}

export interface LogikState {
  readonly starter: PlayerSlot;
  readonly ready: PerPlayer<boolean>;
  /** Pokusy hráče o soupeřův kód. */
  readonly guesses: PerPlayer<readonly Guess[]>;
}

/** Nic z logiky není tajné – kód zná jen klient vlastníka (frame.secret). */
export type LogikView = LogikState;

export type LogikMove =
  | { readonly kind: 'ready' }
  | { readonly kind: 'guess'; readonly code: Code }
  | { readonly kind: 'feedback'; readonly marks: Feedback };

const slot = z.enum(['A', 'B']);
const color = z
  .number()
  .int()
  .min(0)
  .max(COLORS - 1);
export const codeSchema = z.array(color).length(PEGS);
const feedbackSchema = z.array(z.enum(MARKS)).length(PEGS);

export const logikMoveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready') }),
  z.object({ kind: z.literal('guess'), code: codeSchema }),
  z.object({ kind: z.literal('feedback'), marks: feedbackSchema }),
]);

const guessesSchema = z
  .array(z.object({ code: codeSchema, feedback: feedbackSchema.nullable() }))
  .max(MAX_ROUNDS);

export const logikViewSchema = z.object({
  starter: slot,
  ready: z.object({ A: z.boolean(), B: z.boolean() }),
  guesses: z.object({ A: guessesSchema, B: guessesSchema }),
});

/** Všech 6⁴ = 1296 kódů. */
export const ALL_CODES: readonly Code[] = Array.from({ length: COLORS ** PEGS }, (_, n) =>
  Array.from({ length: PEGS }, (_, i) => Math.floor(n / COLORS ** (PEGS - 1 - i)) % COLORS),
);

/**
 * Vyhodnocení po pozicích (jako Wordle). Opakované barvy: „jen barva“ dostane zleva
 * nejvýš tolik kolíků, kolik té barvy v kódu zbývá po přesných zásazích.
 */
export function scoreGuess(guess: Code, secret: Code): Feedback {
  const marks = new Array<Mark>(PEGS).fill('none');
  const rest = new Array<number>(COLORS).fill(0);
  for (let i = 0; i < PEGS; i++) {
    const s = secret[i] ?? -1;
    if (guess[i] === s) marks[i] = 'exact';
    else rest[s] = (rest[s] ?? 0) + 1;
  }
  for (let i = 0; i < PEGS; i++) {
    const g = guess[i] ?? -1;
    if (marks[i] === 'exact' || !rest[g]) continue;
    marks[i] = 'color';
    rest[g]--;
  }
  return marks;
}

export const sameFeedback = (a: Feedback, b: Feedback): boolean =>
  a.length === b.length && a.every((m, i) => m === b[i]);

export const countMarks = (f: Feedback, mark: Mark): number => f.filter((m) => m === mark).length;

/** Odpověď, kterou na tento tip dává aspoň jeden kód (jinak by soupeř zjevně lhal). */
export const possibleFeedback = (guess: Code, f: Feedback): boolean =>
  ALL_CODES.some((code) => sameFeedback(scoreGuess(guess, code), f));

export const cracked = (g: Guess | undefined): boolean =>
  g?.feedback?.every((m) => m === 'exact') === true;

/** Hráč, který dluží odpověď na soupeřův poslední pokus. */
function owesFeedback(s: LogikState, player: PlayerSlot): boolean {
  const last = s.guesses[otherPlayer(player)].at(-1);
  return last !== undefined && last.feedback === null;
}

const order = (s: LogikState): PlayerSlot[] => [s.starter, otherPlayer(s.starter)];

/** Oba už v kole tipli a čeká se na odpovědi (odpovídá se až po pokusech obou). */
function feedbackPhase(s: LogikState): boolean {
  return (
    s.guesses.A.length === s.guesses.B.length && (owesFeedback(s, 'A') || owesFeedback(s, 'B'))
  );
}

const owesNow = (s: LogikState, player: PlayerSlot): boolean =>
  feedbackPhase(s) && owesFeedback(s, player);

export function logikOutcome(s: LogikState): Outcome | null {
  const { A, B } = s.guesses;
  if (!s.ready.A || !s.ready.B || A.length !== B.length || A.length === 0) return null;
  if (owesFeedback(s, 'A') || owesFeedback(s, 'B')) return null;
  const crackedA = cracked(A.at(-1));
  const crackedB = cracked(B.at(-1));
  if (crackedA && crackedB) return DRAW;
  if (crackedA) return win('A');
  if (crackedB) return win('B');
  return A.length >= MAX_ROUNDS ? DRAW : null;
}

function toMove(s: LogikState): PlayerSlot[] {
  if (logikOutcome(s)) return [];
  if (!s.ready.A || !s.ready.B) return order(s).filter((p) => !s.ready[p]);
  if (feedbackPhase(s)) return order(s).filter((p) => owesFeedback(s, p));
  const fewest = Math.min(s.guesses.A.length, s.guesses.B.length);
  return order(s).filter((p) => s.guesses[p].length === fewest);
}

export const logikLogic: GameLogic<LogikState, LogikMove, LogikView> = {
  setup: ({ starter }) => ({ starter, ready: { A: false, B: false }, guesses: { A: [], B: [] } }),

  toMove,

  legal(s, player, move) {
    if (!toMove(s).includes(player)) return false;
    const started = s.ready.A && s.ready.B;
    switch (move.kind) {
      case 'ready':
        return !s.ready[player];
      case 'guess':
        return started && !feedbackPhase(s) && s.guesses[player].length < MAX_ROUNDS;
      case 'feedback': {
        const last = s.guesses[otherPlayer(player)].at(-1);
        return started && owesNow(s, player) && !!last && possibleFeedback(last.code, move.marks);
      }
    }
  },

  apply(s, player, move) {
    switch (move.kind) {
      case 'ready':
        return { ...s, ready: { ...s.ready, [player]: true } };
      case 'guess': {
        const guesses = [...s.guesses[player], { code: [...move.code], feedback: null }];
        return { ...s, guesses: { ...s.guesses, [player]: guesses } };
      }
      case 'feedback': {
        const opp = otherPlayer(player);
        const list = s.guesses[opp];
        const last = list.at(-1);
        if (!last) return s;
        const answered = { ...last, feedback: [...move.marks] };
        return { ...s, guesses: { ...s.guesses, [opp]: [...list.slice(0, -1), answered] } };
      }
    }
  },

  outcome: logikOutcome,
  view: (s) => s,
};

export function randomCode(rng: Rng): Code {
  return Array.from({ length: PEGS }, () => rng.int(COLORS));
}

export const logikHidden: HiddenInfo<Code, LogikMove, LogikView> = {
  secretSchema: codeSchema,
  isValidSecret: (code) => code.length === PEGS && code.every((c) => c >= 0 && c < COLORS),
  randomSecret: randomCode,

  respond(view, player, code) {
    if (!view.ready[player]) return { kind: 'ready' };
    if (!owesNow(view, player)) return null;
    const last = view.guesses[otherPlayer(player)].at(-1);
    return last ? { kind: 'feedback', marks: scoreGuess(last.code, code) } : null;
  },

  awaitsSecret: (view, player) =>
    toMove(view).includes(player) && (!view.ready[player] || owesNow(view, player)),

  locked: (view) => view.ready.A && view.ready.B,

  consistent: (view, player, code) =>
    view.guesses[otherPlayer(player)].every(
      (g) => !g.feedback || sameFeedback(scoreGuess(g.code, code), g.feedback),
    ),

  outcome: logikOutcome,
};
