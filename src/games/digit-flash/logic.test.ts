import { describe, expect, it } from 'vitest';
import { AIMemory } from '../../core/MiniGame';
import { DRAW, win, type Difficulty } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { digitAIDelay, digitAIMove } from './ai';
import {
  digitLogic,
  judgeDigits,
  LENGTHS,
  MAX_POINTS,
  roundPoints,
  scoreDigits,
  type DigitState,
} from './logic';

const fresh = (seed = 'cisla'): DigitState =>
  digitLogic.setup({ rng: createRng(seed), starter: 'A' });

describe('Čísla na mžik – logika', () => {
  it('7 čísel o délce 4 až 10, nezačínají nulou, stejný seed = stejná čísla', () => {
    const s = fresh();
    expect(s.numbers.map((n) => n.length)).toEqual([...LENGTHS]);
    expect(s.numbers.every((n) => /^[1-9]\d+$/.test(n))).toBe(true);
    expect(fresh('x').numbers).toEqual(fresh('x').numbers);
    expect(MAX_POINTS).toBe(49);
  });

  it('bod za každou číslici na správném místě (i u kratší odpovědi)', () => {
    expect(roundPoints('4821', '4821')).toBe(4);
    expect(roundPoints('4821', '4812')).toBe(2);
    expect(roundPoints('4821', '48')).toBe(2);
    expect(roundPoints('4821', '')).toBe(0);
  });

  it('delší odpověď než zadání nebo nelidsky rychlý zápis je neplatný', () => {
    const { numbers } = fresh();
    const good = numbers.map((n) => ({ digits: n, ms: 3000 }));
    expect(scoreDigits(numbers, good)).toEqual({ kind: 'score', points: 49, ms: 21_000 });
    const long = good.map((a, i) => (i === 0 ? { ...a, digits: `${a.digits}1` } : a));
    expect(scoreDigits(numbers, long)).toEqual({ kind: 'invalid' });
    const fast = good.map((a) => ({ ...a, ms: 20 }));
    expect(scoreDigits(numbers, fast)).toEqual({ kind: 'invalid' });
  });

  it('víc bodů vyhrává, při shodě kratší čas', () => {
    const r = (points: number, ms: number) => ({ kind: 'score', points, ms }) as const;
    expect(judgeDigits(r(30, 9000), r(29, 100))).toEqual(win('A'));
    expect(judgeDigits(r(30, 9000), r(30, 8000))).toEqual(win('B'));
    expect(judgeDigits(r(30, 9000), r(30, 9000))).toEqual(DRAW);
  });
});

describe('Čísla na mžik – AI', () => {
  const points = (d: Difficulty, seed: string): number => {
    const s = fresh(seed);
    const view = digitLogic.view(s, 'B');
    const ai = { difficulty: d, rng: createRng(seed), me: 'B' as const, memory: new AIMemory() };
    const move = digitAIMove(view, ai);
    expect(digitAIDelay(view, move)).toBeGreaterThan(10_000);
    const result = scoreDigits(s.numbers, move.answers);
    if (result.kind !== 'score') throw new Error('neplatné');
    return result.points;
  };

  it('těžká AI získá víc bodů než lehká', () => {
    let easy = 0;
    let hard = 0;
    for (let i = 0; i < 40; i++) {
      easy += points('easy', `e${i}`);
      hard += points('hard', `h${i}`);
    }
    expect(hard).toBeGreaterThan(easy * 1.2);
  });
});
