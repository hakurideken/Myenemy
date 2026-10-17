import { describe, expect, it } from 'vitest';
import { AIMemory } from '../../core/MiniGame';
import { DRAW, win, type PlayerSlot } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { cardOf, RANK } from '../shared/marias';
import { okoAIMove, winChances } from './ai';
import {
  handScore,
  handTotal,
  isBust,
  isOko,
  okoCards,
  okoLogic as logic,
  type OkoMove,
  type OkoState,
} from './logic';

const ace = (suit: number): number => cardOf(suit, RANK.ESO);
const seven = (suit: number): number => cardOf(suit, RANK.SEVEN);
const ten = (suit: number): number => cardOf(suit, RANK.TEN);
const king = (suit: number): number => cardOf(suit, RANK.KRAL);

function play(s: OkoState, player: PlayerSlot, move: OkoMove): OkoState {
  expect(logic.legal(s, player, move)).toBe(true);
  return logic.apply(s, player, move);
}

const start = (starter: PlayerSlot = 'A'): OkoState =>
  logic.setup({ rng: createRng('oko'), starter });

/** Stav, kde oba stojí a na konci se odhalí dané karty. */
function showdown(a: number[], b: number[]): OkoState {
  const hands = { A: a.map((_, i) => i), B: b.map((_, i) => 10 + i) };
  const s: OkoState = {
    ...start(),
    hands,
    stood: { A: true, B: true },
  };
  return okoCards.reveal(s, [
    ...a.map((card, i) => ({ pos: i, card })),
    ...b.map((card, i) => ({ pos: 10 + i, card })),
  ]);
}

describe('Oko bere – hodnoty', () => {
  it('7–10 podle čísla, spodek a svršek 1, král 2, eso 11', () => {
    expect(handTotal([seven(0), ten(1), king(2), ace(3)])).toBe(7 + 10 + 2 + 11);
    expect(handTotal([cardOf(0, RANK.SPODEK), cardOf(1, RANK.SVRSEK)])).toBe(2);
  });

  it('dvě esa jsou oko, jinak přes 21 = přetažení', () => {
    expect(isOko([ace(0), ace(1)])).toBe(true);
    expect(isBust([ace(0), ace(1)])).toBe(false);
    expect(isOko([ace(0), ace(1), seven(0)])).toBe(false);
    expect(isBust([ten(0), ten(1), king(0)])).toBe(true);
    expect(handScore([ace(0), ace(1)])).toBeGreaterThan(handScore([ace(0), ten(0)]));
  });
});

describe('Oko bere – průběh', () => {
  it('rozhodují se oba současně; soupeř vidí jen „rozhodnuto“', () => {
    let s = start('B');
    expect(logic.toMove(s)).toEqual(['B', 'A']);
    s = play(s, 'A', { kind: 'draw' });
    expect(logic.view(s, 'B').decisions.A).toBe('decided');
    expect(logic.view(s, 'A').decisions.A).toBe('draw');
    expect(logic.toMove(s)).toEqual(['B']);
    s = play(s, 'B', { kind: 'stand' });
    // Kolo skončilo: A dostal další kartu (pozice 2), B stojí.
    expect(s.hands).toEqual({ A: [0, 2], B: [1] });
    expect(s.stood).toEqual({ A: false, B: true });
    expect(s.round).toBe(2);
    expect(logic.toMove(s)).toEqual(['A']);
  });

  it('když stojí oba, čeká se na odhalení všech karet a pak se vyhodnotí', () => {
    let s = play(play(start(), 'A', { kind: 'stand' }), 'B', { kind: 'stand' });
    expect(logic.toMove(s)).toEqual([]);
    expect(okoCards.pendingPublic(s)).toEqual([0, 1]);
    expect(logic.outcome(s)).toBeNull();
    s = okoCards.reveal(s, [
      { pos: 0, card: ten(0) },
      { pos: 1, card: seven(0) },
    ]);
    expect(okoCards.pendingPublic(s)).toEqual([]);
    expect(logic.outcome(s)).toEqual(win('A'));
  });

  it('vyhodnocení: oko > 21, přes 21 prohrává, oba přes nebo stejně = remíza', () => {
    expect(logic.outcome(showdown([ace(0), ace(1)], [ace(2), ten(0)]))).toEqual(win('A'));
    expect(logic.outcome(showdown([ten(0), ten(1), king(0)], [seven(0)]))).toEqual(win('B'));
    expect(logic.outcome(showdown([ten(0), ten(1), king(0)], [ten(2), ten(3), king(1)]))).toEqual(
      DRAW,
    );
    expect(logic.outcome(showdown([ten(0), seven(1)], [ten(2), seven(3)]))).toEqual(DRAW);
  });

  it('automaticky stojí, kdo má 21, oko nebo přetáhl', () => {
    const s = start();
    const known = (cards: number[]): Map<number, number> =>
      new Map(cards.map((c, i) => [i === 0 ? 0 : 1 + i, c]));
    const two = { ...s, hands: { A: [0, 2], B: [1] } };
    expect(okoCards.autoMove?.(two, 'A', known([ace(0), ten(0)]))).toEqual({ kind: 'stand' });
    expect(okoCards.autoMove?.(two, 'A', known([ace(0), ace(1)]))).toEqual({ kind: 'stand' });
    expect(okoCards.autoMove?.(two, 'A', known([seven(0), ten(0)]))).toBeNull();
    // Neznámou kartu (online ještě nedorazil klíč) nehádá.
    expect(okoCards.autoMove?.(two, 'A', new Map([[0, ace(0)]]))).toBeNull();
  });
});

describe('Oko bere – AI', () => {
  const view = (cards: number[]): { s: OkoState; known: Map<number, number> } => {
    const positions = cards.map((_, i) => 2 + i);
    return {
      s: { ...start(), hands: { A: [0], B: positions } },
      known: new Map(positions.map((p, i) => [p, cards[i] ?? 0])),
    };
  };

  it('střední lízne pod 17 a od 17 stojí', () => {
    const rng = createRng('m');
    const ctx = (known: Map<number, number>) => ({
      difficulty: 'medium' as const,
      rng,
      me: 'B' as const,
      memory: new AIMemory(),
      cards: known,
    });
    const low = view([ten(0), cardOf(1, RANK.SPODEK)]);
    expect(okoAIMove(low.s, ctx(low.known))).toEqual({ kind: 'draw' });
    const high = view([ten(0), seven(1)]);
    expect(okoAIMove(high.s, ctx(high.known))).toEqual({ kind: 'stand' });
  });

  it('těžká počítá šance: na 20 stojí, na 4 líže', () => {
    const rng = createRng('h');
    expect(winChances([ten(0), ten(1)], 1, true, rng).stand).toBeGreaterThan(
      winChances([ten(0), ten(1)], 1, true, rng).draw,
    );
    const low = view([king(0), king(1)]);
    const move = okoAIMove(low.s, {
      difficulty: 'hard',
      rng,
      me: 'B',
      memory: new AIMemory(),
      cards: low.known,
    });
    expect(move).toEqual({ kind: 'draw' });
  });
});

describe('Oko bere – síla AI', () => {
  /** Celá hra dvou AI s lokálním balíčkem. */
  function duel(a: 'easy' | 'hard', b: 'easy' | 'hard', seed: string): number {
    const rng = createRng(seed);
    const deck = rng.shuffle(Array.from({ length: 32 }, (_, c) => c));
    const difficulty = { A: a, B: b };
    let s = logic.setup({ rng, starter: 'A' });
    while (logic.toMove(s).length > 0) {
      const player = logic.toMove(s)[0] as PlayerSlot;
      const known = new Map(s.hands[player].map((p) => [p, deck[p] ?? 0]));
      const auto = okoCards.autoMove?.(s, player, known);
      const move =
        auto ??
        okoAIMove(logic.view(s, player), {
          difficulty: difficulty[player],
          rng,
          me: player,
          memory: new AIMemory(),
          cards: known,
        });
      s = logic.apply(s, player, move);
    }
    s = okoCards.reveal(
      s,
      okoCards.pendingPublic(s).map((pos) => ({ pos, card: deck[pos] ?? 0 })),
    );
    const outcome = logic.outcome(s);
    return outcome?.kind === 'win' ? (outcome.winner === 'A' ? 1 : 0) : 0.5;
  }

  it('těžká AI porazí lehkou ve většině her', () => {
    let score = 0;
    const games = 400;
    for (let i = 0; i < games; i++) {
      // Střídat strany, ať nerozhoduje začínající hráč.
      score += i % 2 === 0 ? duel('hard', 'easy', `d${i}`) : 1 - duel('easy', 'hard', `d${i}`);
    }
    // Oko bere je hlavně o štěstí – i tak musí být rozdíl znát (seedy jsou pevné).
    expect(score / games).toBeGreaterThan(0.53);
  });
});
