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
export const PADS = 4;
/** První kolo má 3 položky, každé další o jednu víc. */
export const START_LENGTH = 3;
/** Kdo zvládne všech 15 kol (17 položek), má hotovo. */
export const MAX_LEVEL = 15;
export const MAX_LENGTH = START_LENGTH + MAX_LEVEL - 1;
/** Rychlejší mačkání než 60 ms na položku člověk nezvládne – výsledek je neplatný. */
export const MIN_PRESS_MS = 60;
/** Bez stisku tak dlouho = konec (zapomněl). */
export const IDLE_MS = 6000;
/** Všechny stisky ve všech kolech (+ chybný na konci). */
export const MAX_PRESSES = (MAX_LEVEL * (2 * START_LENGTH + MAX_LEVEL - 1)) / 2 + MAX_LENGTH;

/** Délka řady v kole (1 = první kolo). */
export const levelLength = (level: number): number => START_LENGTH + level - 1;

/** Jak dlouho svítí jedna položka při ukázce – pozdější kola rychleji. */
export const showOnMs = (level: number): number => Math.max(300, 560 - level * 18);
export const SHOW_GAP_MS = 170;
export const LEVEL_PAUSE_MS = 700;

export type SequenceResult =
  | {
      readonly kind: 'run';
      /** Kolik kol zvládl bez chyby. */
      readonly level: number;
      /** Součet času zadávání ve zvládnutých kolech (ms). */
      readonly ms: number;
    }
  | { readonly kind: 'invalid' };

export interface SequenceMove {
  readonly kind: 'run';
  /** Všechny stisky po sobě (pole 0–3) – logika z nich spočítá, kam se hráč dostal. */
  readonly presses: readonly number[];
  readonly ms: number;
}

export interface SequenceState {
  /** Celá řada (stejná pro oba – ze seedu); kolo n používá prvních levelLength(n) položek. */
  readonly sequence: readonly number[];
  readonly results: Partial<Record<PlayerSlot, SequenceResult>>;
}

export interface SequenceView {
  readonly sequence: readonly number[];
  readonly mine: SequenceResult | null;
  readonly opponentDone: boolean;
  readonly results: PerPlayer<SequenceResult> | null;
}

/** Kolik kol stisky zvládly a kolik stisků k tomu patřilo. */
export function replay(
  sequence: readonly number[],
  presses: readonly number[],
): { level: number; used: number } {
  let level = 0;
  let used = 0;
  for (let next = 1; next <= MAX_LEVEL; next++) {
    const length = levelLength(next);
    for (let i = 0; i < length; i++) {
      if (presses[used + i] !== sequence[i]) return { level, used };
    }
    used += length;
    level = next;
  }
  return { level, used };
}

export function normalizeRun(sequence: readonly number[], move: SequenceMove): SequenceResult {
  if (move.presses.length > MAX_PRESSES) return { kind: 'invalid' };
  const { level, used } = replay(sequence, move.presses);
  if (level > 0 && move.ms < used * MIN_PRESS_MS) return { kind: 'invalid' };
  return { kind: 'run', level, ms: level > 0 ? move.ms : 0 };
}

/** Delší zvládnutá řada vyhrává; při shodě rychlejší zadávání; jinak remíza. */
export function judgeRuns(a: SequenceResult, b: SequenceResult): Outcome {
  const level = (r: SequenceResult): number => (r.kind === 'invalid' ? -1 : r.level);
  const la = level(a);
  const lb = level(b);
  if (la !== lb) return win(la > lb ? 'A' : 'B');
  if (a.kind === 'run' && b.kind === 'run' && la > 0 && a.ms !== b.ms) {
    return win(a.ms < b.ms ? 'A' : 'B');
  }
  return DRAW;
}

export const sequenceLogic: GameLogic<SequenceState, SequenceMove, SequenceView> = {
  setup: ({ rng }) => {
    const sequence: number[] = [];
    for (let i = 0; i < MAX_LENGTH; i++) {
      // Nejvýš dvakrát stejné pole za sebou – trojice by byla nečitelná.
      let pad = rng.int(PADS);
      if (sequence.length >= 2 && sequence.at(-1) === pad && sequence.at(-2) === pad) {
        pad = (pad + 1 + rng.int(PADS - 1)) % PADS;
      }
      sequence.push(pad);
    }
    return { sequence, results: {} };
  },
  toMove: (s) => PLAYER_SLOTS.filter((p) => s.results[p] === undefined),
  legal: (s, player) => s.results[player] === undefined,
  apply: (s, player, move) => ({
    ...s,
    results: { ...s.results, [player]: normalizeRun(s.sequence, move) },
  }),
  outcome: (s) => {
    const { A, B } = s.results;
    return A && B ? judgeRuns(A, B) : null;
  },
  view: (s, viewer) => {
    const { A, B } = s.results;
    return {
      sequence: s.sequence,
      mine: s.results[viewer] ?? null,
      opponentDone: s.results[otherPlayer(viewer)] !== undefined,
      results: A && B ? { A, B } : null,
    };
  },
};

const padSchema = z
  .number()
  .int()
  .min(0)
  .max(PADS - 1);
const resultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('run'),
    level: z.number().int().min(0).max(MAX_LEVEL),
    ms: z.number().int().min(0).max(3_600_000),
  }),
  z.object({ kind: z.literal('invalid') }),
]);

export const sequenceMoveSchema = z.object({
  kind: z.literal('run'),
  presses: z.array(padSchema).max(MAX_PRESSES),
  ms: z.number().int().min(0).max(3_600_000),
});

export const sequenceViewSchema = z.object({
  sequence: z.array(padSchema).length(MAX_LENGTH),
  mine: resultSchema.nullable(),
  opponentDone: z.boolean(),
  results: z.object({ A: resultSchema, B: resultSchema }).nullable(),
});
