import { describe, expect, it } from 'vitest';
import { AIMemory } from '../../core/MiniGame';
import { DIFFICULTIES, DRAW, win } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { clickAIDelay, clickAIMove } from './ai';
import {
  clickLogic as logic,
  clickMoveSchema,
  COUNTDOWN_MS,
  DURATION_MS,
  judgeClicks,
  MAX_CLICKS,
  normalizeClicks,
} from './logic';

const clicks = (count: number) => ({ kind: 'clicks', count }) as const;

describe('Klikací souboj – pravidla', () => {
  it('víc kliknutí vyhrává, stejně je remíza', () => {
    expect(judgeClicks(clicks(40), clicks(35))).toEqual(win('A'));
    expect(judgeClicks(clicks(20), clicks(35))).toEqual(win('B'));
    expect(judgeClicks(clicks(30), clicks(30))).toEqual(DRAW);
  });

  it('nesmyslně vysoký počet je neplatný a prohrává', () => {
    expect(normalizeClicks(clicks(MAX_CLICKS))).toEqual(clicks(MAX_CLICKS));
    expect(normalizeClicks(clicks(MAX_CLICKS + 1))).toEqual({ kind: 'invalid' });
    expect(judgeClicks({ kind: 'invalid' }, clicks(0))).toEqual(win('B'));
    expect(judgeClicks({ kind: 'invalid' }, { kind: 'invalid' })).toEqual(DRAW);
  });

  it('soupeřův počet je skrytý, dokud nedokliká i druhý', () => {
    let s = logic.setup({ rng: createRng('x'), starter: 'A' });
    s = logic.apply(s, 'A', clicks(33));
    expect(logic.view(s, 'B')).toEqual({ mine: null, opponentDone: true, results: null });
    expect(logic.outcome(s)).toBeNull();
    s = logic.apply(s, 'B', clicks(31));
    expect(logic.view(s, 'B').results).toEqual({ A: clicks(33), B: clicks(31) });
    expect(logic.outcome(s)).toEqual(win('A'));
    expect(logic.legal(s, 'A', clicks(1))).toBe(false);
  });

  it('schéma odmítne záporné a necelé počty', () => {
    expect(clickMoveSchema.safeParse(clicks(10)).success).toBe(true);
    expect(clickMoveSchema.safeParse(clicks(-1)).success).toBe(false);
    expect(clickMoveSchema.safeParse(clicks(2.5)).success).toBe(false);
  });
});

describe('Klikací souboj – AI', () => {
  it.each(DIFFICULTIES)('%s: lidské tempo a odeslání po odpočtu a 5 s', (difficulty) => {
    const rng = createRng(`cb-${difficulty}`);
    const ai = { difficulty, rng, me: 'B' as const, memory: new AIMemory() };
    const view = logic.view(logic.setup({ rng, starter: 'A' }), 'B');
    const counts = Array.from({ length: 300 }, () => clickAIMove(view, ai).count);
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    expect(Math.max(...counts)).toBeLessThanOrEqual(MAX_CLICKS);
    expect(mean).toBeGreaterThan(20);
    expect(mean).toBeLessThan(55);
    expect(clickAIDelay(view, clicks(1), ai)).toBeGreaterThanOrEqual(COUNTDOWN_MS + DURATION_MS);
  });

  it('těžší obtížnost kliká rychleji', () => {
    const mean = (difficulty: (typeof DIFFICULTIES)[number]) => {
      const rng = createRng(`speed-${difficulty}`);
      const ai = { difficulty, rng, me: 'B' as const, memory: new AIMemory() };
      const view = { mine: null, opponentDone: false, results: null };
      return (
        Array.from({ length: 300 }, () => clickAIMove(view, ai).count).reduce((a, b) => a + b, 0) /
        300
      );
    };
    expect(mean('easy')).toBeLessThan(mean('medium'));
    expect(mean('medium')).toBeLessThan(mean('hard'));
  });
});
