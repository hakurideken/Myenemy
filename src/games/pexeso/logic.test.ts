import { describe, expect, it } from 'vitest';
import { AIMemory } from '../../core/MiniGame';
import { DRAW, win, type Difficulty, type PlayerSlot } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { pexesoAIMove } from './ai';
import {
  CARDS,
  FLIP_LIMIT,
  pairOf,
  pexesoCards,
  pexesoLogic as logic,
  type PexesoMove,
  type PexesoState,
} from './logic';

/** Rozložení „na stole“: pozice p má kartu p (dvojice jsou sousedé 0–1, 2–3, …). */
const reveal = (s: PexesoState): PexesoState =>
  pexesoCards.reveal(
    s,
    pexesoCards.pendingPublic(s).map((pos) => ({ pos, card: pos })),
  );

function flip(s: PexesoState, player: PlayerSlot, pos: number): PexesoState {
  const move: PexesoMove = { kind: 'flip', pos };
  expect(logic.legal(s, player, move)).toBe(true);
  return reveal(logic.apply(s, player, move));
}

const start = (): PexesoState => logic.setup({ rng: createRng('pex'), starter: 'A' });

describe('Pexeso – pravidla', () => {
  it('obě kopie dvojice mají jiné číslo karty, ale stejný obrázek', () => {
    expect(pairOf(0)).toBe(pairOf(1));
    expect(pairOf(1)).not.toBe(pairOf(2));
    expect(CARDS).toBe(24);
  });

  it('dvojice: hráč ji bere a hraje znovu', () => {
    let s = flip(start(), 'A', 4);
    expect(s.flipped).toEqual([4]);
    s = flip(s, 'A', 5);
    expect(s.taken[4]).toBe('A');
    expect(s.taken[5]).toBe('A');
    expect(s.score).toEqual({ A: 1, B: 0 });
    expect(s.turn).toBe('A');
    expect(s.last).toEqual({ player: 'A', positions: [4, 5], match: true });
  });

  it('bez dvojice se karty otočí zpět a hraje soupeř; viděné karty zůstanou známé', () => {
    let s = flip(start(), 'A', 0);
    s = flip(s, 'A', 2);
    expect(s.turn).toBe('B');
    expect(s.flipped).toEqual([]);
    expect(s.seen.map((c) => c.pos)).toEqual([0, 2]);
    // Už viděnou kartu není potřeba znovu odhalovat.
    const again = logic.apply(s, 'B', { kind: 'flip', pos: 0 });
    expect(pexesoCards.pendingPublic(again)).toEqual([]);
  });

  it('na odhalení otočené karty se čeká – do té doby nikdo netáhne', () => {
    const s = logic.apply(start(), 'A', { kind: 'flip', pos: 7 });
    expect(pexesoCards.pendingPublic(s)).toEqual([7]);
    expect(logic.toMove(s)).toEqual([]);
    expect(logic.legal(start(), 'A', { kind: 'flip', pos: 7 })).toBe(true);
  });

  it('sebranou nebo právě otočenou kartu otočit nejde', () => {
    let s = flip(flip(start(), 'A', 0), 'A', 1);
    expect(logic.legal(s, 'A', { kind: 'flip', pos: 0 })).toBe(false);
    s = flip(s, 'A', 2);
    expect(logic.legal(s, 'A', { kind: 'flip', pos: 2 })).toBe(false);
  });

  it('vyhrává víc dvojic, 6:6 je remíza', () => {
    const all = (owner: (i: number) => PlayerSlot): PexesoState => ({
      ...start(),
      taken: Array.from({ length: CARDS }, (_, i) => owner(i)),
      score: {
        A: Array.from({ length: 12 }, (_, i) => owner(2 * i)).filter((p) => p === 'A').length,
        B: Array.from({ length: 12 }, (_, i) => owner(2 * i)).filter((p) => p === 'B').length,
      },
    });
    expect(logic.outcome(all((i) => (i < 14 ? 'A' : 'B')))).toEqual(win('A'));
    expect(logic.outcome(all((i) => (i < 12 ? 'A' : 'B')))).toEqual(DRAW);
    expect(logic.outcome(start())).toBeNull();
  });
});

describe('Pexeso – AI', () => {
  it('těžká AI si pamatuje viděné karty a vezme známou dvojici', () => {
    let s = flip(start(), 'A', 0);
    s = flip(s, 'A', 3);
    s = flip(s, 'B', 2);
    // B otočil 2 – jeho dvojice (3) už byla vidět.
    const move = pexesoAIMove(s, {
      difficulty: 'hard',
      rng: createRng('h'),
      me: 'B',
      memory: new AIMemory(),
    });
    expect(move).toEqual({ kind: 'flip', pos: 3 });
  });

  /** Celá hra dvou AI s náhodným rozložením; 1 = vyhrál A. */
  function duel(a: Difficulty, b: Difficulty, seed: string): number {
    const rng = createRng(seed);
    const layout = rng.shuffle(Array.from({ length: CARDS }, (_, i) => i));
    const difficulty = { A: a, B: b };
    const memory = new AIMemory();
    let s = logic.setup({ rng, starter: 'A' });
    for (let i = 0; i < 2000 && !logic.outcome(s); i++) {
      const player = logic.toMove(s)[0] as PlayerSlot;
      const move = pexesoAIMove(s, { difficulty: difficulty[player], rng, me: player, memory });
      s = logic.apply(s, player, move);
      s = pexesoCards.reveal(
        s,
        pexesoCards.pendingPublic(s).map((pos) => ({ pos, card: layout[pos] ?? 0 })),
      );
    }
    const outcome = logic.outcome(s);
    return outcome?.kind === 'win' ? (outcome.winner === 'A' ? 1 : 0) : 0.5;
  }

  it('lepší paměť vyhrává: těžká > střední > lehká', () => {
    const versus = (x: Difficulty, y: Difficulty): number => {
      let score = 0;
      for (let i = 0; i < 100; i++) {
        score += i % 2 === 0 ? duel(x, y, `x${i}`) : 1 - duel(y, x, `x${i}`);
      }
      return score / 100;
    };
    expect(versus('hard', 'easy')).toBeGreaterThan(0.75);
    expect(versus('medium', 'easy')).toBeGreaterThan(0.6);
    expect(versus('hard', 'medium')).toBeGreaterThan(0.55);
  });
});

describe('Pexeso – pojistka', () => {
  it('po limitu otočení rozhodne stav dvojic (ne uprostřed tahu)', () => {
    const base = flip(flip(start(), 'A', 0), 'A', 1);
    expect(logic.outcome({ ...base, moves: FLIP_LIMIT })).toEqual(win('A'));
    expect(logic.outcome({ ...base, moves: FLIP_LIMIT, flipped: [4] })).toBeNull();
    expect(logic.outcome({ ...start(), moves: FLIP_LIMIT })).toEqual(DRAW);
  });
});
