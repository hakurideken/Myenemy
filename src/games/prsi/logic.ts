import { z } from 'zod';
import type { CardAt, CardRules, GameLogic, KnownCards } from '../../core/MiniGame';
import {
  DRAW,
  otherPlayer,
  win,
  type Outcome,
  type PerPlayer,
  type PlayerSlot,
} from '../../core/types';
import { MARIAS_SIZE, RANK, rankOf, SUIT_COUNT, suitOf } from '../shared/marias';

export const HAND_SIZE = 4;
/** Po tolika tazích bez vítěze vyhrává, kdo má méně karet (bez remízy jen při shodě). */
export const MOVE_LIMIT = 200;
/** Kolik karet se líže za jednu sedmu. */
export const SEVEN_PENALTY = 2;

export type PrsiEvent =
  | {
      readonly player: PlayerSlot;
      readonly kind: 'play';
      readonly card: number;
      readonly suit: number | null;
    }
  | { readonly player: PlayerSlot; readonly kind: 'draw'; readonly count: number }
  | { readonly player: PlayerSlot; readonly kind: 'stand' };

export interface PrsiState {
  readonly starter: PlayerSlot;
  readonly turn: PlayerSlot;
  /** Pozice karet v rukou (v zamíchaném balíčku). */
  readonly hands: PerPlayer<readonly number[]>;
  /** Lízací balíček – index 0 je navrchu. */
  readonly drawPile: readonly number[];
  /** Odhazovací balíček – poslední je navrchu. */
  readonly discard: readonly number[];
  /** Veřejně známé karty (vyložené a otočený odhazovací balíček). */
  readonly faceUp: readonly CardAt[];
  /** Barva určená svrškem (jinak platí barva vrchní karty). */
  readonly suit: number | null;
  /** Kolik karet musí líznout hráč na tahu (nahromaděné sedmy). */
  readonly penalty: number;
  /** Platí eso: hráč na tahu stojí, pokud nedá eso. */
  readonly ace: boolean;
  /** Úvodní karta ještě nebyla odhalená (její účinek platí pro začínajícího). */
  readonly opening: boolean;
  readonly moves: number;
  readonly last: PrsiEvent | null;
}

export type PrsiView = PrsiState;

export type PrsiMove =
  | {
      readonly kind: 'play';
      readonly pos: number;
      readonly card: number;
      readonly suit: number | null;
    }
  | { readonly kind: 'draw' }
  | { readonly kind: 'stand' };

const slot = z.enum(['A', 'B']);
const pos = z
  .number()
  .int()
  .min(0)
  .max(MARIAS_SIZE - 1);
const suitSchema = z
  .number()
  .int()
  .min(0)
  .max(SUIT_COUNT - 1);
const positions = z.array(pos).max(MARIAS_SIZE);

export const prsiMoveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('play'), pos, card: pos, suit: suitSchema.nullable() }),
  z.object({ kind: z.literal('draw') }),
  z.object({ kind: z.literal('stand') }),
]);

export const prsiViewSchema = z.object({
  starter: slot,
  turn: slot,
  hands: z.object({ A: positions, B: positions }),
  drawPile: positions,
  discard: positions,
  faceUp: z.array(z.object({ pos, card: pos })).max(MARIAS_SIZE),
  suit: suitSchema.nullable(),
  penalty: z.number().int().min(0).max(MARIAS_SIZE),
  ace: z.boolean(),
  opening: z.boolean(),
  moves: z.number().int().min(0).max(MOVE_LIMIT),
  last: z
    .discriminatedUnion('kind', [
      z.object({ player: slot, kind: z.literal('play'), card: pos, suit: suitSchema.nullable() }),
      z.object({
        player: slot,
        kind: z.literal('draw'),
        count: z.number().int().min(0).max(MARIAS_SIZE),
      }),
      z.object({ player: slot, kind: z.literal('stand') }),
    ])
    .nullable(),
});

export const faceUpCard = (s: PrsiState, p: number): number | undefined =>
  s.faceUp.find((c) => c.pos === p)?.card;

/** Vrchní karta odhazovacího balíčku (undefined, dokud není odhalená). */
export function topCard(s: PrsiState): number | undefined {
  const top = s.discard.at(-1);
  return top === undefined ? undefined : faceUpCard(s, top);
}

/** Barva, kterou je teď potřeba ctít. */
export function activeSuit(s: PrsiState): number | null {
  const top = topCard(s);
  return s.suit ?? (top === undefined ? null : suitOf(top));
}

/** Smí se karta zahrát? (bez ohledu na to, čí je) */
export function canPlay(s: PrsiState, card: number): boolean {
  const top = topCard(s);
  if (top === undefined) return false;
  if (s.penalty > 0) return rankOf(card) === RANK.SEVEN;
  if (s.ace) return rankOf(card) === RANK.ESO;
  return (
    rankOf(card) === RANK.SVRSEK || suitOf(card) === activeSuit(s) || rankOf(card) === rankOf(top)
  );
}

const waitingForReveal = (s: PrsiState): boolean =>
  s.discard.some((p) => faceUpCard(s, p) === undefined);

export function prsiOutcome(s: PrsiState): Outcome | null {
  if (s.hands.A.length === 0) return win('A');
  if (s.hands.B.length === 0) return win('B');
  if (s.moves >= MOVE_LIMIT) {
    const diff = s.hands.A.length - s.hands.B.length;
    return diff === 0 ? DRAW : win(diff < 0 ? 'A' : 'B');
  }
  return null;
}

function toMove(s: PrsiState): PlayerSlot[] {
  if (waitingForReveal(s) || prsiOutcome(s)) return [];
  return [s.turn];
}

/** Lízne n karet; když dojde balíček, otočí se odhazovací (kromě vrchní karty). */
function drawCards(s: PrsiState, player: PlayerSlot, n: number): PrsiState {
  let pile = [...s.drawPile];
  let discard = [...s.discard];
  if (pile.length < n && discard.length > 1) {
    pile = [...pile, ...discard.slice(0, -1)];
    discard = discard.slice(-1);
  }
  const taken = pile.slice(0, n);
  return {
    ...s,
    drawPile: pile.slice(taken.length),
    discard,
    hands: { ...s.hands, [player]: [...s.hands[player], ...taken] },
    last: { player, kind: 'draw', count: taken.length },
  };
}

export const prsiLogic: GameLogic<PrsiState, PrsiMove, PrsiView> = {
  setup: ({ starter }) => ({
    starter,
    turn: starter,
    hands: {
      A: Array.from({ length: HAND_SIZE }, (_, i) => i),
      B: Array.from({ length: HAND_SIZE }, (_, i) => HAND_SIZE + i),
    },
    discard: [2 * HAND_SIZE],
    drawPile: Array.from(
      { length: MARIAS_SIZE - 2 * HAND_SIZE - 1 },
      (_, i) => 2 * HAND_SIZE + 1 + i,
    ),
    faceUp: [],
    suit: null,
    penalty: 0,
    ace: false,
    opening: true,
    moves: 0,
    last: null,
  }),

  toMove,

  legal(s, player, move) {
    if (!toMove(s).includes(player)) return false;
    switch (move.kind) {
      case 'play': {
        if (!s.hands[player].includes(move.pos) || !canPlay(s, move.card)) return false;
        // Svršek musí určit barvu, ostatní karty ne.
        return rankOf(move.card) === RANK.SVRSEK ? move.suit !== null : move.suit === null;
      }
      case 'draw':
        return !s.ace;
      case 'stand':
        return s.ace;
    }
  },

  apply(s, player, move) {
    const next = otherPlayer(player);
    const moves = s.moves + 1;
    switch (move.kind) {
      case 'play': {
        const rank = rankOf(move.card);
        return {
          ...s,
          hands: { ...s.hands, [player]: s.hands[player].filter((p) => p !== move.pos) },
          discard: [...s.discard, move.pos],
          // Karta z otočeného balíčku už veřejná je.
          faceUp:
            faceUpCard(s, move.pos) === undefined
              ? [...s.faceUp, { pos: move.pos, card: move.card }]
              : s.faceUp,
          suit: rank === RANK.SVRSEK ? move.suit : null,
          penalty: rank === RANK.SEVEN ? s.penalty + SEVEN_PENALTY : 0,
          ace: rank === RANK.ESO,
          turn: next,
          moves,
          last: { player, kind: 'play', card: move.card, suit: move.suit },
        };
      }
      case 'draw':
        return {
          ...drawCards(s, player, s.penalty > 0 ? s.penalty : 1),
          penalty: 0,
          turn: next,
          moves,
        };
      case 'stand':
        return { ...s, ace: false, turn: next, moves, last: { player, kind: 'stand' } };
    }
  },

  outcome: prsiOutcome,
  view: (s) => s,
};

/** Vlastní ruka jako karty (jen ty, které hráč zná). */
export function handCards(view: PrsiView, player: PlayerSlot, known: KnownCards): CardAt[] {
  return view.hands[player].flatMap((p) => {
    const card = known.get(p) ?? faceUpCard(view, p);
    return card === undefined ? [] : [{ pos: p, card }];
  });
}

export const prsiCards: CardRules<PrsiState, PrsiMove, PrsiView> = {
  deckSize: MARIAS_SIZE,
  privateFor: (view, player) => view.hands[player],
  publicCards: (view) => view.faceUp,
  pendingPublic: (view) => view.discard.filter((p) => faceUpCard(view, p) === undefined),
  reveal(state, cards) {
    const faceUp = [
      ...state.faceUp,
      ...cards.filter((c) => faceUpCard(state, c.pos) === undefined),
    ];
    const revealed = { ...state, faceUp };
    if (!state.opening) return revealed;
    // Úvodní karta platí pro začínajícího: sedma = líže, eso = stojí, svršek = jeho barva.
    const top = topCard(revealed);
    if (top === undefined) return revealed;
    const rank = rankOf(top);
    return {
      ...revealed,
      opening: false,
      penalty: rank === RANK.SEVEN ? SEVEN_PENALTY : 0,
      ace: rank === RANK.ESO,
    };
  },
  claims: (move) => (move.kind === 'play' ? [{ pos: move.pos, card: move.card }] : []),
  /** Vynucený tah: na eso bez esa se stojí, na sedmu bez sedmy se líže. */
  autoMove(view, player, known) {
    if (!toMove(view).includes(player)) return null;
    const hand = handCards(view, player, known);
    if (hand.length !== view.hands[player].length) return null;
    if (view.ace && !hand.some((c) => rankOf(c.card) === RANK.ESO)) return { kind: 'stand' };
    if (view.penalty > 0 && !hand.some((c) => rankOf(c.card) === RANK.SEVEN))
      return { kind: 'draw' };
    return null;
  },
};
