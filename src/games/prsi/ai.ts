import type { AIContext, CardAt } from '../../core/MiniGame';
import { otherPlayer, type PlayerSlot } from '../../core/types';
import type { Rng } from '../../core/util/rng';
import { MARIAS_SIZE, RANK, rankOf, SUIT_COUNT, suitOf } from '../shared/marias';
import {
  activeSuit,
  canPlay,
  handCards,
  prsiCards,
  prsiLogic,
  type PrsiMove,
  type PrsiState,
  type PrsiView,
} from './logic';

/** Těžká AI: kolik rozdání soupeřovy ruky vyzkouší a jak daleko dohraje. */
const SAMPLES = 60;
const PLAYOUT_MOVES = 80;

/** Co si těžká AI pamatuje o soupeři (během jedné hry). */
interface Notes {
  moves: number;
  /** Barvy, na které soupeř neměl co dát (lízal). */
  readonly voids: Set<number>;
}

/** Počty karet podle barvy (bez svršků – ty hrají na cokoli). */
function suitCounts(hand: readonly CardAt[], without: number | null): number[] {
  const counts = new Array<number>(SUIT_COUNT).fill(0);
  for (const { pos, card } of hand) {
    if (pos === without || rankOf(card) === RANK.SVRSEK) continue;
    counts[suitOf(card)] = (counts[suitOf(card)] ?? 0) + 1;
  }
  return counts;
}

/** Barva pro svršek: co mám nejvíc, u těžké AI navíc barva, kterou soupeř nemá. */
export function bestSuit(
  hand: readonly CardAt[],
  without: number | null = null,
  voids: ReadonlySet<number> = new Set(),
): number {
  const counts = suitCounts(hand, without);
  let best = 0;
  let bestValue = -1;
  counts.forEach((n, suit) => {
    const value = n + (voids.has(suit) && n > 0 ? 1.5 : 0);
    if (value > bestValue) {
      best = suit;
      bestValue = value;
    }
  });
  return best;
}

/** Těžká AI: když soupeř dobrovolně lízl, neměl aktivní barvu – zapamatovat. */
function observe(view: PrsiView, ai: AIContext): Notes {
  const notes = ai.memory.get<Notes>(`prsi:${ai.me}`, () => ({ moves: 0, voids: new Set() }));
  if (view.moves < notes.moves) notes.voids.clear();
  notes.moves = view.moves;
  const last = view.last;
  if (!last || last.player === ai.me) return notes;
  const suit = activeSuit(view);
  if (last.kind === 'draw' && last.count === 1 && suit !== null) notes.voids.add(suit);
  // Barvu, kterou si soupeř sám zvolil nebo právě zahrál, zase má.
  if (last.kind === 'play') notes.voids.delete(last.suit ?? suitOf(last.card));
  return notes;
}

function score(
  card: CardAt,
  hand: readonly CardAt[],
  opponentCards: number,
  voids: ReadonlySet<number> | null,
): number {
  const rank = rankOf(card.card);
  const lastCard = hand.length === 1;
  let value = 0;
  // Svršek je záchrana – šetřit ho, leda by to byla poslední karta.
  if (rank === RANK.SVRSEK) value += lastCard ? 10 : -6;
  if (rank === RANK.SEVEN || rank === RANK.ESO) value += opponentCards <= 2 ? 6 : 0;
  if (voids) {
    // Nechat na stole barvu, kterou soupeř nemá, a zbavovat se barev, kterých mám málo.
    const suit = rank === RANK.SVRSEK ? bestSuit(hand, card.pos, voids) : suitOf(card.card);
    if (voids.has(suit)) value += 3;
    const counts = suitCounts(hand, card.pos);
    value += (counts[suit] ?? 0) * 0.5;
    if (rank !== RANK.SVRSEK && (counts[suitOf(card.card)] ?? 0) === 0) value += 1;
    // Eso = soupeř stojí, takže zahraju znovu; poslední sedmu schovat na obranu.
    if (rank === RANK.ESO) value += 2;
    const sevens = hand.filter((c) => rankOf(c.card) === RANK.SEVEN).length;
    if (rank === RANK.SEVEN && sevens === 1 && opponentCards > 2) value -= 3;
  }
  return value;
}

const playOf = (
  card: CardAt,
  hand: readonly CardAt[],
  voids: ReadonlySet<number> = new Set(),
): PrsiMove => ({
  kind: 'play',
  pos: card.pos,
  card: card.card,
  suit: rankOf(card.card) === RANK.SVRSEK ? bestSuit(hand, card.pos, voids) : null,
});

/** Tah „střední“ strategie s plnou znalostí ruky (pro simulace). */
function greedyMove(
  state: PrsiState,
  player: PlayerSlot,
  deal: ReadonlyMap<number, number>,
  rng: Rng,
): PrsiMove {
  const hand = state.hands[player].map((pos) => ({ pos, card: deal.get(pos) ?? 0 }));
  const forced = prsiCards.autoMove?.(state, player, deal);
  if (forced) return forced;
  const playable = hand.filter((c) => canPlay(state, c.card));
  if (playable.length === 0) return state.ace ? { kind: 'stand' } : { kind: 'draw' };
  const opponentCards = state.hands[otherPlayer(player)].length;
  let best = playable[0] as CardAt;
  let bestScore = -Infinity;
  for (const c of rng.shuffle(playable)) {
    const value = score(c, hand, opponentCards, null);
    if (value > bestScore) {
      best = c;
      bestScore = value;
    }
  }
  return playOf(best, hand);
}

/** Dohraje partii oběma hráči „středně“; vrátí výsledek z pohledu `me` (0–1). */
function playout(
  start: PrsiState,
  me: PlayerSlot,
  deal: ReadonlyMap<number, number>,
  rng: Rng,
): number {
  let state = start;
  for (let i = 0; i < PLAYOUT_MOVES; i++) {
    const outcome = prsiLogic.outcome(state);
    if (outcome) return outcome.kind === 'draw' ? 0.5 : outcome.winner === me ? 1 : 0;
    const player = prsiLogic.toMove(state)[0];
    if (!player) break;
    state = prsiLogic.apply(state, player, greedyMove(state, player, deal, rng));
  }
  // Nedohráno: lepší je mít méně karet.
  const mine = state.hands[me].length;
  const theirs = state.hands[otherPlayer(me)].length;
  return mine < theirs ? 0.75 : mine === theirs ? 0.5 : 0.25;
}

/**
 * Těžká AI: rozdá soupeři a do balíčku náhodně karty, které nezná (s ohledem na barvy,
 * které soupeři chybí), každý svůj možný tah dohraje a vybere ten nejúspěšnější.
 */
function searchMove(
  view: PrsiView,
  ai: AIContext,
  hand: readonly CardAt[],
  voids: ReadonlySet<number>,
): PrsiMove {
  const me = ai.me;
  const opp = otherPlayer(me);
  const known = new Map<number, number>(view.faceUp.map((c) => [c.pos, c.card]));
  for (const c of hand) known.set(c.pos, c.card);
  const used = new Set(known.values());
  const unknownCards = Array.from({ length: MARIAS_SIZE }, (_, c) => c).filter((c) => !used.has(c));
  const unknownPositions = [...view.hands[opp], ...view.drawPile].filter((p) => !known.has(p));
  const playable = hand.filter((c) => canPlay(view, c.card));
  const candidates: PrsiMove[] = playable.map((c) => playOf(c, hand, voids));
  candidates.push(view.ace ? { kind: 'stand' } : { kind: 'draw' });
  const totals = candidates.map(() => 0);
  for (let i = 0; i < SAMPLES; i++) {
    let cards = ai.rng.shuffle(unknownCards);
    // Soupeř nejspíš nemá barvy, na které lízal – takové rozdání zkusit pár krát odmítnout.
    for (let tries = 0; tries < 5; tries++) {
      const theirs = cards.slice(0, view.hands[opp].filter((p) => !known.has(p)).length);
      if (!theirs.some((c) => voids.has(suitOf(c)) && rankOf(c) !== RANK.SVRSEK)) break;
      cards = ai.rng.shuffle(unknownCards);
    }
    const deal = new Map(known);
    unknownPositions.forEach((p, j) => deal.set(p, cards[j] ?? 0));
    candidates.forEach((move, j) => {
      totals[j] = (totals[j] ?? 0) + playout(prsiLogic.apply(view, me, move), me, deal, ai.rng);
    });
  }
  let best = 0;
  totals.forEach((t, j) => {
    if (t > (totals[best] ?? 0)) best = j;
  });
  return candidates[best] ?? candidates[0] ?? { kind: 'draw' };
}

export function prsiAIMove(view: PrsiView, ai: AIContext): PrsiMove {
  const notes = ai.difficulty === 'hard' ? observe(view, ai) : null;
  const hand = handCards(view, ai.me, ai.cards ?? new Map<number, number>());
  const playable = hand.filter((c) => canPlay(view, c.card));
  const pass: PrsiMove = view.ace ? { kind: 'stand' } : { kind: 'draw' };
  if (playable.length === 0) return pass;
  const { rng } = ai;
  const opponentCards = view.hands[otherPlayer(ai.me)].length;
  if (ai.difficulty === 'easy') {
    // Občas zbytečně lízne, jinak hraje cokoli.
    if (!view.ace && view.penalty === 0 && rng.chance(0.15)) return pass;
    return playOf(rng.pick(playable), hand);
  }
  const voids = notes?.voids ?? null;
  if (voids && hand.length === view.hands[ai.me].length) return searchMove(view, ai, hand, voids);
  const ranked = rng
    .shuffle(playable)
    .map((c) => ({ c, s: score(c, hand, opponentCards, voids) }))
    .sort((a, b) => b.s - a.s);
  const top = ranked[0];
  return top ? playOf(top.c, hand, voids ?? undefined) : pass;
}
