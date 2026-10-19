import { z } from 'zod';
import type { CardAt, CardRules, GameLogic } from '../../core/MiniGame';
import {
  DRAW,
  otherPlayer,
  win,
  type Outcome,
  type PerPlayer,
  type PlayerSlot,
} from '../../core/types';

/** Lichý počet dvojic – remíza nastat nemůže (jen po limitu otočení). */
export const PAIRS = 15;
export const CARDS = PAIRS * 2;
export const COLS = 6;
/** Pojistka: po tolika otočeních rozhodne stav dvojic (jinak by šlo otáčet donekonečna). */
export const FLIP_LIMIT = 300;
export const ROWS = CARDS / COLS;

/** Karta = dvojice · 2 + kopie (obě kopie mají jiné číslo, aby šifrování neprozradilo páry). */
export const pairOf = (card: number): number => Math.floor(card / 2);

export interface PexesoTurn {
  readonly player: PlayerSlot;
  readonly positions: readonly [number, number];
  readonly match: boolean;
}

export interface PexesoState {
  readonly starter: PlayerSlot;
  readonly turn: PlayerSlot;
  /** Kdo sebral dvojici na pozici (null = karta ještě leží). */
  readonly taken: readonly (PlayerSlot | null)[];
  /** Karty, které už někdo otočil (veřejné – pamatovat si je je součást hry). */
  readonly seen: readonly CardAt[];
  /** Karty otočené v tomto tahu (0–2). */
  readonly flipped: readonly number[];
  readonly score: PerPlayer<number>;
  /** Poslední dokončený tah (karty zůstanou chvíli vidět). */
  readonly last: PexesoTurn | null;
  readonly moves: number;
}

export type PexesoView = PexesoState;

export type PexesoMove = { readonly kind: 'flip'; readonly pos: number };

const slot = z.enum(['A', 'B']);
const pos = z
  .number()
  .int()
  .min(0)
  .max(CARDS - 1);

export const pexesoMoveSchema = z.object({ kind: z.literal('flip'), pos });
export const pexesoViewSchema = z.object({
  starter: slot,
  turn: slot,
  taken: z.array(slot.nullable()).length(CARDS),
  seen: z.array(z.object({ pos, card: pos })).max(CARDS),
  flipped: z.array(pos).max(2),
  score: z.object({ A: z.number().int().min(0).max(PAIRS), B: z.number().int().min(0).max(PAIRS) }),
  last: z.object({ player: slot, positions: z.tuple([pos, pos]), match: z.boolean() }).nullable(),
  moves: z
    .number()
    .int()
    .min(0)
    .max(FLIP_LIMIT + 1),
});

export const seenCard = (s: PexesoState, p: number): number | undefined =>
  s.seen.find((c) => c.pos === p)?.card;

const waitingForReveal = (s: PexesoState): boolean =>
  s.flipped.some((p) => seenCard(s, p) === undefined);

export function pexesoOutcome(s: PexesoState): Outcome | null {
  const cleared = s.taken.every((t) => t !== null);
  if (!cleared && (s.moves < FLIP_LIMIT || s.flipped.length > 0)) return null;
  const diff = s.score.A - s.score.B;
  return diff === 0 ? DRAW : win(diff > 0 ? 'A' : 'B');
}

function toMove(s: PexesoState): PlayerSlot[] {
  if (waitingForReveal(s) || pexesoOutcome(s)) return [];
  return [s.turn];
}

/** Druhá karta je odhalená: dvojice = bere a hraje znovu, jinak se karty otočí zpět. */
function resolve(s: PexesoState): PexesoState {
  const [a, b] = s.flipped;
  if (a === undefined || b === undefined) return s;
  const ca = seenCard(s, a);
  const cb = seenCard(s, b);
  if (ca === undefined || cb === undefined) return s;
  const match = pairOf(ca) === pairOf(cb);
  const last: PexesoTurn = { player: s.turn, positions: [a, b], match };
  if (!match) return { ...s, flipped: [], turn: otherPlayer(s.turn), last };
  return {
    ...s,
    flipped: [],
    taken: s.taken.map((t, i) => (i === a || i === b ? s.turn : t)),
    score: { ...s.score, [s.turn]: s.score[s.turn] + 1 },
    last,
  };
}

export const pexesoLogic: GameLogic<PexesoState, PexesoMove, PexesoView> = {
  setup: ({ starter }) => ({
    starter,
    turn: starter,
    taken: new Array<PlayerSlot | null>(CARDS).fill(null),
    seen: [],
    flipped: [],
    score: { A: 0, B: 0 },
    last: null,
    moves: 0,
  }),

  toMove,

  legal: (s, player, move) =>
    toMove(s).includes(player) &&
    s.taken[move.pos] === null &&
    !s.flipped.includes(move.pos) &&
    s.flipped.length < 2,

  apply: (s, _player, move) =>
    resolve({ ...s, flipped: [...s.flipped, move.pos], moves: s.moves + 1 }),

  outcome: pexesoOutcome,
  view: (s) => s,
};

export const pexesoCards: CardRules<PexesoState, PexesoMove, PexesoView> = {
  deckSize: CARDS,
  privateFor: () => [],
  publicCards: (view) => view.seen,
  pendingPublic: (view) => view.flipped.filter((p) => seenCard(view, p) === undefined),
  reveal: (state, cards) =>
    resolve({
      ...state,
      seen: [...state.seen, ...cards.filter((c) => seenCard(state, c.pos) === undefined)],
    }),
  claims: () => [],
};
