import { describe, expect, it } from 'vitest';
import { AIMemory } from '../../core/MiniGame';
import { DRAW, win, type Difficulty, type PlayerSlot } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { cardOf, RANK, rankOf } from '../shared/marias';
import { prsiAIMove } from './ai';
import {
  canPlay,
  MOVE_LIMIT,
  prsiCards,
  prsiLogic as logic,
  type PrsiMove,
  type PrsiState,
} from './logic';

const SRDCE = 0;
const LISTY = 1;
const KULE = 2;
const c = cardOf;

function play(s: PrsiState, player: PlayerSlot, move: PrsiMove): PrsiState {
  expect(logic.legal(s, player, move)).toBe(true);
  return logic.apply(s, player, move);
}

/** Úvodní stav s odhalenou první kartou. */
function opened(top: number, starter: PlayerSlot = 'A'): PrsiState {
  const s = logic.setup({ rng: createRng('prsi'), starter });
  expect(prsiCards.pendingPublic(s)).toEqual([8]);
  expect(logic.toMove(s)).toEqual([]);
  return prsiCards.reveal(s, [{ pos: 8, card: top }]);
}

describe('Prší – co jde zahrát', () => {
  it('stejná barva nebo hodnota, svršek na cokoli', () => {
    const s = opened(c(SRDCE, RANK.NINE));
    expect(canPlay(s, c(SRDCE, RANK.KRAL))).toBe(true);
    expect(canPlay(s, c(LISTY, RANK.NINE))).toBe(true);
    expect(canPlay(s, c(LISTY, RANK.SVRSEK))).toBe(true);
    expect(canPlay(s, c(LISTY, RANK.KRAL))).toBe(false);
  });

  it('svršek určí barvu – pak platí jen ta (nebo další svršek)', () => {
    let s = opened(c(SRDCE, RANK.NINE));
    s = play(s, 'A', { kind: 'play', pos: 0, card: c(SRDCE, RANK.SVRSEK), suit: KULE });
    expect(canPlay(s, c(KULE, RANK.SEVEN))).toBe(true);
    expect(canPlay(s, c(SRDCE, RANK.TEN))).toBe(false);
    expect(canPlay(s, c(LISTY, RANK.SVRSEK))).toBe(true);
  });

  it('svršek musí určit barvu, jiná karta ne', () => {
    const s = opened(c(SRDCE, RANK.NINE));
    const svrsek = c(LISTY, RANK.SVRSEK);
    expect(logic.legal(s, 'A', { kind: 'play', pos: 0, card: svrsek, suit: null })).toBe(false);
    expect(logic.legal(s, 'A', { kind: 'play', pos: 0, card: c(SRDCE, 3), suit: KULE })).toBe(
      false,
    );
    // Karta, kterou hráč nemá v ruce (pozice soupeře), nejde.
    expect(logic.legal(s, 'A', { kind: 'play', pos: 5, card: c(SRDCE, 3), suit: null })).toBe(
      false,
    );
  });
});

describe('Prší – sedmy a esa', () => {
  it('sedma: soupeř přebije sedmou (sčítá se), nebo líže', () => {
    let s = opened(c(SRDCE, RANK.NINE));
    s = play(s, 'A', { kind: 'play', pos: 0, card: c(SRDCE, RANK.SEVEN), suit: null });
    expect(s.penalty).toBe(2);
    expect(canPlay(s, c(SRDCE, RANK.EIGHT))).toBe(false);
    s = play(s, 'B', { kind: 'play', pos: 4, card: c(LISTY, RANK.SEVEN), suit: null });
    expect(s.penalty).toBe(4);
    s = play(s, 'A', { kind: 'draw' });
    expect(s.hands.A).toHaveLength(3 + 4);
    expect(s.penalty).toBe(0);
    expect(s.turn).toBe('B');
    // Po líznutí se na sedmu hraje normálně.
    expect(canPlay(s, c(LISTY, RANK.KRAL))).toBe(true);
  });

  it('eso: soupeř dá eso, nebo stojí (líznout nesmí)', () => {
    let s = opened(c(KULE, RANK.NINE));
    s = play(s, 'A', { kind: 'play', pos: 0, card: c(KULE, RANK.ESO), suit: null });
    expect(logic.legal(s, 'B', { kind: 'draw' })).toBe(false);
    expect(canPlay(s, c(KULE, RANK.TEN))).toBe(false);
    s = play(s, 'B', { kind: 'stand' });
    expect(s.ace).toBe(false);
    expect(s.turn).toBe('A');
    expect(s.last).toEqual({ player: 'B', kind: 'stand' });
  });

  it('úvodní sedma platí pro začínajícího, úvodní eso ho zastaví', () => {
    expect(opened(c(SRDCE, RANK.SEVEN), 'B')).toMatchObject({ penalty: 2, turn: 'B' });
    expect(opened(c(SRDCE, RANK.ESO))).toMatchObject({ ace: true, opening: false });
    expect(opened(c(SRDCE, RANK.SVRSEK))).toMatchObject({ suit: null, penalty: 0, ace: false });
  });

  it('vynucené tahy: na eso bez esa se stojí, na sedmu bez sedmy líže', () => {
    const ace = opened(c(SRDCE, RANK.ESO));
    const hand = new Map(ace.hands.A.map((p) => [p, c(LISTY, RANK.EIGHT)]));
    expect(prsiCards.autoMove?.(ace, 'A', hand)).toEqual({ kind: 'stand' });
    const seven = opened(c(SRDCE, RANK.SEVEN));
    expect(prsiCards.autoMove?.(seven, 'A', hand)).toEqual({ kind: 'draw' });
    const withSeven = new Map(hand).set(0, c(KULE, RANK.SEVEN));
    expect(prsiCards.autoMove?.(seven, 'A', withSeven)).toBeNull();
  });
});

describe('Prší – balíček a konec hry', () => {
  it('když dojde balíček, otočí se odhazovací (vrchní karta zůstane)', () => {
    const base = opened(c(SRDCE, RANK.NINE));
    const s: PrsiState = {
      ...base,
      drawPile: [],
      discard: [20, 21, 8],
      faceUp: [...base.faceUp, { pos: 20, card: 1 }, { pos: 21, card: 2 }],
    };
    const after = play(s, 'A', { kind: 'draw' });
    expect(after.discard).toEqual([8]);
    expect(after.hands.A.at(-1)).toBe(20);
    expect(after.drawPile).toEqual([21]);
  });

  it('kdo se zbaví karet, vyhrává; po limitu tahů rozhodne méně karet', () => {
    const base = opened(c(SRDCE, RANK.NINE));
    const last: PrsiState = { ...base, hands: { A: [0], B: [4, 5] } };
    expect(
      logic.outcome(play(last, 'A', { kind: 'play', pos: 0, card: c(SRDCE, 3), suit: null })),
    ).toEqual(win('A'));
    expect(logic.outcome({ ...base, moves: MOVE_LIMIT, hands: { A: [0], B: [4, 5] } })).toEqual(
      win('A'),
    );
    expect(logic.outcome({ ...base, moves: MOVE_LIMIT })).toEqual(DRAW);
  });

  it('vyložená karta se tvrdí v tahu (ověří ji rozdávající)', () => {
    expect(prsiCards.claims({ kind: 'play', pos: 3, card: 17, suit: null })).toEqual([
      { pos: 3, card: 17 },
    ]);
    expect(prsiCards.claims({ kind: 'draw' })).toEqual([]);
  });
});

describe('Prší – AI', () => {
  const ai = (difficulty: Difficulty, cards: Map<number, number>) => ({
    difficulty,
    rng: createRng(`ai-${difficulty}`),
    me: 'A' as const,
    memory: new AIMemory(),
    cards,
  });

  it('na sedmu odpoví sedmou, jinak hraje platnou kartu a svršek šetří', () => {
    let s = opened(c(SRDCE, RANK.NINE));
    const hand = new Map([
      [0, c(SRDCE, RANK.SVRSEK)],
      [1, c(SRDCE, RANK.KRAL)],
      [2, c(LISTY, RANK.EIGHT)],
      [3, c(KULE, RANK.SEVEN)],
    ]);
    for (const d of ['medium', 'hard'] as const) {
      expect(prsiAIMove(s, ai(d, hand))).toMatchObject({ kind: 'play', pos: 1 });
    }
    s = { ...s, penalty: 2 };
    expect(prsiAIMove(s, ai('medium', hand))).toMatchObject({ kind: 'play', pos: 3 });
  });

  it('svrškem volí barvu, které má nejvíc', () => {
    const s = opened(c(SRDCE, RANK.NINE));
    const hand = new Map([
      [0, c(LISTY, RANK.SVRSEK)],
      [1, c(KULE, RANK.EIGHT)],
      [2, c(KULE, RANK.KRAL)],
      [3, c(LISTY, RANK.TEN)],
    ]);
    const move = prsiAIMove(s, ai('hard', hand));
    expect(move).toEqual({ kind: 'play', pos: 0, card: c(LISTY, RANK.SVRSEK), suit: KULE });
  });

  it('bez hratelné karty líže (na eso stojí)', () => {
    const s = opened(c(SRDCE, RANK.NINE));
    const hand = new Map([[0, c(LISTY, RANK.KRAL)]]);
    expect(prsiAIMove(s, ai('easy', hand))).toEqual({ kind: 'draw' });
    expect(prsiAIMove({ ...s, ace: true }, ai('easy', hand))).toEqual({ kind: 'stand' });
    expect(rankOf(c(LISTY, RANK.KRAL))).toBe(RANK.KRAL);
  });
});

describe('Prší – síla AI', () => {
  /** Celá hra dvou AI s lokálním balíčkem; 1 = vyhrál A. */
  function duel(a: Difficulty, b: Difficulty, seed: string): number {
    const rng = createRng(seed);
    const deck = rng.shuffle(Array.from({ length: 32 }, (_, i) => i));
    const difficulty = { A: a, B: b };
    const memory = new AIMemory();
    let s = logic.setup({ rng, starter: 'A' });
    s = prsiCards.reveal(
      s,
      prsiCards.pendingPublic(s).map((pos) => ({ pos, card: deck[pos] ?? 0 })),
    );
    while (logic.toMove(s).length > 0) {
      const player = logic.toMove(s)[0] as PlayerSlot;
      const known = new Map(s.hands[player].map((p) => [p, deck[p] ?? 0]));
      const move =
        prsiCards.autoMove?.(s, player, known) ??
        prsiAIMove(logic.view(s, player), {
          difficulty: difficulty[player],
          rng,
          me: player,
          memory,
          cards: known,
        });
      s = play(s, player, move);
    }
    const outcome = logic.outcome(s);
    return outcome?.kind === 'win' ? (outcome.winner === 'A' ? 1 : 0) : 0.5;
  }

  it('střední i těžká AI porazí lehkou ve většině her', () => {
    for (const strong of ['medium', 'hard'] as const) {
      let score = 0;
      const games = 100;
      for (let i = 0; i < games; i++) {
        score += i % 2 === 0 ? duel(strong, 'easy', `p${i}`) : 1 - duel('easy', strong, `p${i}`);
      }
      expect(score / games, strong).toBeGreaterThan(0.6);
    }
  });
});
