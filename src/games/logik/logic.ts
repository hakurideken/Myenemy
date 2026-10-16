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

export interface Feedback {
  /** Správná barva na správném místě. */
  readonly black: number;
  /** Správná barva na špatném místě. */
  readonly white: number;
}

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
  | { readonly kind: 'feedback'; readonly black: number; readonly white: number };

const slot = z.enum(['A', 'B']);
const color = z
  .number()
  .int()
  .min(0)
  .max(COLORS - 1);
export const codeSchema = z.array(color).length(PEGS);
const pegCount = z.number().int().min(0).max(PEGS);
const feedbackSchema = z.object({ black: pegCount, white: pegCount });

export const logikMoveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready') }),
  z.object({ kind: z.literal('guess'), code: codeSchema }),
  z.object({ kind: z.literal('feedback'), black: pegCount, white: pegCount }),
]);

const guessesSchema = z
  .array(z.object({ code: codeSchema, feedback: feedbackSchema.nullable() }))
  .max(MAX_ROUNDS);

export const logikViewSchema = z.object({
  starter: slot,
  ready: z.object({ A: z.boolean(), B: z.boolean() }),
  guesses: z.object({ A: guessesSchema, B: guessesSchema }),
});

/** Klasické vyhodnocení Mastermindu. */
export function scoreGuess(guess: Code, secret: Code): Feedback {
  let black = 0;
  const restGuess = new Array<number>(COLORS).fill(0);
  const restSecret = new Array<number>(COLORS).fill(0);
  for (let i = 0; i < PEGS; i++) {
    const g = guess[i] ?? -1;
    const s = secret[i] ?? -1;
    if (g === s) black++;
    else {
      restGuess[g] = (restGuess[g] ?? 0) + 1;
      restSecret[s] = (restSecret[s] ?? 0) + 1;
    }
  }
  let white = 0;
  for (let c = 0; c < COLORS; c++) white += Math.min(restGuess[c] ?? 0, restSecret[c] ?? 0);
  return { black, white };
}

/** Odpověď, která u kódu 4 kolíků nemůže nastat (3 přesně + 1 barva) nebo přesáhne 4. */
export const possibleFeedback = (f: Feedback): boolean =>
  f.black + f.white <= PEGS && !(f.black === PEGS - 1 && f.white === 1);

export const cracked = (g: Guess | undefined): boolean => g?.feedback?.black === PEGS;

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
      case 'feedback':
        return started && owesNow(s, player) && possibleFeedback(move);
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
        const answered = { ...last, feedback: { black: move.black, white: move.white } };
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
    return last ? { kind: 'feedback', ...scoreGuess(last.code, code) } : null;
  },

  awaitsSecret: (view, player) =>
    toMove(view).includes(player) && (!view.ready[player] || owesNow(view, player)),

  locked: (view) => view.ready.A && view.ready.B,

  consistent: (view, player, code) =>
    view.guesses[otherPlayer(player)].every((g) => {
      if (!g.feedback) return true;
      const expected = scoreGuess(g.code, code);
      return expected.black === g.feedback.black && expected.white === g.feedback.white;
    }),

  outcome: logikOutcome,
};
