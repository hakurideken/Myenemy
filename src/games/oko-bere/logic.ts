import { z } from 'zod';
import type { CardAt, CardRules, GameLogic, KnownCards } from '../../core/MiniGame';
import {
  DRAW,
  otherPlayer,
  PLAYER_SLOTS,
  win,
  type Outcome,
  type PerPlayer,
  type PlayerSlot,
} from '../../core/types';
import { MARIAS_SIZE, RANK, rankOf } from '../shared/marias';

/** Hodnoty: 7–10 podle čísla, spodek a svršek 1, král 2, eso 11. */
const VALUES: readonly number[] = [7, 8, 9, 10, 1, 1, 2, 11];
export const cardValue = (card: number): number => VALUES[rankOf(card)] ?? 0;
export const handTotal = (cards: readonly number[]): number =>
  cards.reduce((sum, c) => sum + cardValue(c), 0);
/** Dvě esa = „oko“, vyhrává nad čímkoli. */
export const isOko = (cards: readonly number[]): boolean =>
  cards.length === 2 && cards.every((c) => rankOf(c) === RANK.ESO);
export const isBust = (cards: readonly number[]): boolean => !isOko(cards) && handTotal(cards) > 21;

/** Síla ruky pro porovnání: oko > 21 > … > 1, přetažení = −1. */
export function handScore(cards: readonly number[]): number {
  if (isOko(cards)) return 100;
  return isBust(cards) ? -1 : handTotal(cards);
}

export type OkoDecision = 'draw' | 'stand';

export interface OkoState {
  readonly starter: PlayerSlot;
  /** Pozice karet v ruce (v zamíchaném balíčku). */
  readonly hands: PerPlayer<readonly number[]>;
  /** Další pozice v balíčku. */
  readonly next: number;
  readonly stood: PerPlayer<boolean>;
  /** Rozhodnutí v aktuálním kole (oba se rozhodují současně). */
  readonly decisions: PerPlayer<OkoDecision | 'decided' | null>;
  /** Co kdo udělal v minulém kole (pro zobrazení). */
  readonly last: PerPlayer<OkoDecision | null>;
  readonly round: number;
  /** Karty odhalené na konci. */
  readonly shown: readonly CardAt[];
}

/** Pohled: soupeřovo rozhodnutí v běžícím kole je jen „rozhodnuto“. */
export type OkoView = OkoState;

export type OkoMove = { readonly kind: OkoDecision };

const slot = z.enum(['A', 'B']);
const pos = z
  .number()
  .int()
  .min(0)
  .max(MARIAS_SIZE - 1);
const decision = z.enum(['draw', 'stand']);

export const okoMoveSchema = z.object({ kind: decision });
export const okoViewSchema = z.object({
  starter: slot,
  hands: z.object({ A: z.array(pos).max(MARIAS_SIZE), B: z.array(pos).max(MARIAS_SIZE) }),
  next: z.number().int().min(0).max(MARIAS_SIZE),
  stood: z.object({ A: z.boolean(), B: z.boolean() }),
  decisions: z.object({
    A: z.enum(['draw', 'stand', 'decided']).nullable(),
    B: z.enum(['draw', 'stand', 'decided']).nullable(),
  }),
  last: z.object({ A: decision.nullable(), B: decision.nullable() }),
  round: z.number().int().min(1).max(MARIAS_SIZE),
  shown: z.array(z.object({ pos, card: pos })).max(MARIAS_SIZE),
});

const bothStood = (s: OkoState): boolean => s.stood.A && s.stood.B;
const allPositions = (s: OkoState): number[] => [...s.hands.A, ...s.hands.B];

/** Karty hráče z odhalení na konci (null, dokud nejsou odhalené všechny). */
export function shownHand(s: OkoState, player: PlayerSlot): number[] | null {
  const out: number[] = [];
  for (const p of s.hands[player]) {
    const card = s.shown.find((c) => c.pos === p)?.card;
    if (card === undefined) return null;
    out.push(card);
  }
  return out;
}

export function okoOutcome(s: OkoState): Outcome | null {
  if (!bothStood(s)) return null;
  const a = shownHand(s, 'A');
  const b = shownHand(s, 'B');
  if (!a || !b) return null;
  const diff = handScore(a) - handScore(b);
  if (diff === 0) return DRAW;
  return win(diff > 0 ? 'A' : 'B');
}

function toMove(s: OkoState): PlayerSlot[] {
  if (bothStood(s)) return [];
  return [s.starter, otherPlayer(s.starter)].filter((p) => !s.stood[p] && s.decisions[p] === null);
}

/** Kolo skončí, až se rozhodnou všichni, kdo ještě hrají. Karty se rozdají v pořadí A, B. */
function resolveRound(s: OkoState): OkoState {
  const active = PLAYER_SLOTS.filter((p) => !s.stood[p]);
  if (active.some((p) => s.decisions[p] === null || s.decisions[p] === 'decided')) return s;
  let next = s.next;
  const hands = { ...s.hands };
  const stood = { ...s.stood };
  const last: PerPlayer<OkoDecision | null> = { A: null, B: null };
  for (const p of active) {
    const d = s.decisions[p];
    if (d === 'draw') {
      hands[p] = [...hands[p], next];
      next += 1;
      last[p] = 'draw';
    } else if (d === 'stand') {
      stood[p] = true;
      last[p] = 'stand';
    }
  }
  return {
    ...s,
    hands,
    next,
    stood,
    last,
    decisions: { A: null, B: null },
    round: s.round + 1,
  };
}

export const okoLogic: GameLogic<OkoState, OkoMove, OkoView> = {
  setup: ({ starter }) => ({
    starter,
    hands: { A: [0], B: [1] },
    next: 2,
    stood: { A: false, B: false },
    decisions: { A: null, B: null },
    last: { A: null, B: null },
    round: 1,
    shown: [],
  }),

  toMove,

  legal(s, player, move) {
    if (!toMove(s).includes(player)) return false;
    // Musí zbýt karta pro oba, kdyby líznuli najednou.
    return move.kind === 'stand' || MARIAS_SIZE - s.next >= 2;
  },

  apply(s, player, move) {
    return resolveRound({ ...s, decisions: { ...s.decisions, [player]: move.kind } });
  },

  outcome: okoOutcome,

  view(s, viewer) {
    const opp = otherPlayer(viewer);
    const theirs = s.decisions[opp];
    return {
      ...s,
      decisions: { ...s.decisions, [opp]: theirs === null ? null : 'decided' },
    };
  },
};

/** Vlastní karty hráče, pokud je zná všechny. */
export function knownHand(view: OkoView, player: PlayerSlot, known: KnownCards): number[] | null {
  const out: number[] = [];
  for (const p of view.hands[player]) {
    const card = known.get(p);
    if (card === undefined) return null;
    out.push(card);
  }
  return out;
}

export const okoCards: CardRules<OkoState, OkoMove, OkoView> = {
  deckSize: MARIAS_SIZE,
  privateFor: (view, player) => view.hands[player],
  publicCards: (view) => view.shown,
  pendingPublic: (view) =>
    bothStood(view) ? allPositions(view).filter((p) => !view.shown.some((c) => c.pos === p)) : [],
  reveal: (state, cards) => ({
    ...state,
    shown: [...state.shown, ...cards.filter((c) => !state.shown.some((s) => s.pos === c.pos))],
  }),
  claims: () => [],
  /** Přetažení, 21 nebo oko: už není co řešit – hráč automaticky stojí. */
  autoMove(view, player, known) {
    if (!toMove(view).includes(player)) return null;
    const hand = knownHand(view, player, known);
    if (!hand) return null;
    return isOko(hand) || handTotal(hand) >= 21 ? { kind: 'stand' } : null;
  },
};
