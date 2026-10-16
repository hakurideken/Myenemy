import { describe, expect, it } from 'vitest';
import { AIMemory } from '../../core/MiniGame';
import { win, type Difficulty, type PlayerSlot } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { nimAIMove, optimalTake } from './ai';
import { MAX_START, MIN_START, nimLogic as logic, nimMoveSchema, type NimState } from './logic';

const state = (remaining: number, turn: PlayerSlot = 'A'): NimState => ({
  initial: 20,
  remaining,
  turn,
  loser: null,
  lastTake: null,
});

describe('Sirky – pravidla', () => {
  it('počet sirek je 15–25 a daný seedem', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const s = logic.setup({ rng: createRng(seed), starter: 'A' });
      expect(s.remaining).toBeGreaterThanOrEqual(MIN_START);
      expect(s.remaining).toBeLessThanOrEqual(MAX_START);
      expect(s.initial).toBe(s.remaining);
    }
  });

  it('kdo vezme poslední sirku, prohrál', () => {
    let s = state(3, 'A');
    s = logic.apply(s, 'A', { take: 2 });
    expect(logic.outcome(s)).toBeNull();
    s = logic.apply(s, 'B', { take: 1 });
    expect(s.loser).toBe('B');
    expect(logic.outcome(s)).toEqual(win('A'));
    expect(logic.toMove(s)).toEqual([]);
  });

  it('nejde vzít víc, než zbývá, ani 0 nebo 4', () => {
    expect(logic.legal(state(2), 'A', { take: 3 })).toBe(false);
    expect(logic.legal(state(2), 'B', { take: 1 })).toBe(false);
    expect(nimMoveSchema.safeParse({ take: 0 }).success).toBe(false);
    expect(nimMoveSchema.safeParse({ take: 4 }).success).toBe(false);
  });
});

describe('Sirky – AI', () => {
  it('optimální tah nechá soupeři počet ≡ 1 (mod 4)', () => {
    expect(optimalTake(2)).toBe(1);
    expect(optimalTake(4)).toBe(3);
    expect(optimalTake(7)).toBe(2);
    expect(optimalTake(5)).toBeNull();
    expect(optimalTake(1)).toBeNull();
  });

  const run = (a: Difficulty, b: Difficulty, start: number, seed: string): PlayerSlot | null => {
    const rng = createRng(seed);
    let s: NimState = state(start, 'A');
    while (logic.outcome(s) === null) {
      const me = s.turn;
      const move = nimAIMove(logic.view(s, me), {
        difficulty: me === 'A' ? a : b,
        rng,
        me,
        memory: new AIMemory(),
      });
      expect(logic.legal(s, me, move)).toBe(true);
      s = logic.apply(s, me, move);
    }
    const o = logic.outcome(s);
    return o?.kind === 'win' ? o.winner : null;
  };

  it('těžká z vyhrané pozice vždy vyhraje', () => {
    for (const start of [16, 18, 19, 20, 22, 23, 24]) {
      for (const seed of ['1', '2', '3'])
        expect(run('hard', 'easy', start, `${seed}-${start}`)).toBe('A');
    }
  });

  it('těžká porazí lehkou i z prohrané pozice většinou (čeká na chybu)', () => {
    let wins = 0;
    for (let i = 0; i < 40; i++) if (run('hard', 'easy', 21, `lost-${i}`) === 'A') wins++;
    expect(wins).toBeGreaterThan(25);
  });
});
