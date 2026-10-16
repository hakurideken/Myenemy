import { describe, expect, it } from 'vitest';
import { AIMemory, type AIContext } from '../../core/MiniGame';
import { DIFFICULTIES, DRAW, win, type Difficulty } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { quickDrawAIDelay, quickDrawAIMove } from './ai';
import {
  DELAY_MAX_MS,
  DELAY_MIN_MS,
  judge,
  normalizeResult,
  quickDrawLogic as logic,
  quickDrawMoveSchema,
  type QuickDrawResult,
} from './logic';

const reacted = (ms: number): QuickDrawResult => ({ kind: 'reacted', ms });
const FALSE_START: QuickDrawResult = { kind: 'false-start' };
const TIMEOUT: QuickDrawResult = { kind: 'timeout' };

describe('Rychlý tasec – vyhodnocení', () => {
  it('rychlejší vyhrává, stejný čas je remíza', () => {
    expect(judge(reacted(250), reacted(300))).toEqual(win('A'));
    expect(judge(reacted(301), reacted(300))).toEqual(win('B'));
    expect(judge(reacted(280), reacted(280))).toEqual(DRAW);
  });

  it('předčasný výstřel prohrává vždy, i proti tomu, kdo nestihl', () => {
    expect(judge(FALSE_START, reacted(900))).toEqual(win('B'));
    expect(judge(reacted(900), FALSE_START)).toEqual(win('A'));
    expect(judge(FALSE_START, TIMEOUT)).toEqual(win('B'));
  });

  it('kdo nestihl, prohrává s tím, kdo vystřelil', () => {
    expect(judge(TIMEOUT, reacted(1900))).toEqual(win('B'));
  });

  it('remíza: oba předčasně nebo oba nestihli', () => {
    expect(judge(FALSE_START, FALSE_START)).toEqual(DRAW);
    expect(judge(TIMEOUT, TIMEOUT)).toEqual(DRAW);
  });

  it('reakce pod 100 ms je předčasný výstřel, nad 2 s nestihl; čas se zaokrouhlí', () => {
    expect(normalizeResult(reacted(99.4))).toEqual(FALSE_START);
    expect(normalizeResult(reacted(99.6))).toEqual(reacted(100));
    expect(normalizeResult(reacted(250.7))).toEqual(reacted(251));
    expect(normalizeResult(reacted(2400))).toEqual(TIMEOUT);
  });
});

describe('Rychlý tasec – průběh', () => {
  const start = (seed = 'qd') => logic.setup({ rng: createRng(seed), starter: 'A' });

  it('prodleva signálu je v rozsahu a daná seedem', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const { delayMs } = start(seed);
      expect(delayMs).toBeGreaterThanOrEqual(DELAY_MIN_MS);
      expect(delayMs).toBeLessThanOrEqual(DELAY_MAX_MS);
    }
    expect(start('x').delayMs).toBe(start('x').delayMs);
  });

  it('kolo končí, až mají výsledek oba; každý jen jeden', () => {
    let s = start();
    expect(logic.toMove(s)).toEqual(['A', 'B']);
    s = logic.apply(s, 'A', FALSE_START);
    expect(logic.outcome(s)).toBeNull();
    expect(logic.toMove(s)).toEqual(['B']);
    expect(logic.legal(s, 'A', reacted(200))).toBe(false);
    s = logic.apply(s, 'B', reacted(320));
    expect(logic.outcome(s)).toEqual(win('B'));
  });

  it('podvržený čas pod 100 ms se počítá jako předčasný výstřel', () => {
    let s = start();
    s = logic.apply(s, 'A', reacted(30));
    s = logic.apply(s, 'B', reacted(400));
    expect(logic.outcome(s)).toEqual(win('B'));
  });

  it('schéma tahu odmítne nesmysly', () => {
    expect(quickDrawMoveSchema.safeParse({ kind: 'reacted', ms: 250 }).success).toBe(true);
    expect(quickDrawMoveSchema.safeParse({ kind: 'false-start' }).success).toBe(true);
    expect(quickDrawMoveSchema.safeParse({ kind: 'reacted', ms: -5 }).success).toBe(false);
    expect(quickDrawMoveSchema.safeParse({ kind: 'reacted', ms: '250' }).success).toBe(false);
    expect(quickDrawMoveSchema.safeParse({ kind: 'reacted', ms: Infinity }).success).toBe(false);
    expect(quickDrawMoveSchema.safeParse({ kind: 'cheat' }).success).toBe(false);
  });
});

describe('Rychlý tasec – AI', () => {
  const ai = (difficulty: Difficulty, seed: string): AIContext => ({
    difficulty,
    rng: createRng(seed),
    me: 'B',
    memory: new AIMemory(),
  });

  it.each(DIFFICULTIES)('%s: vystřelí ve skutečném čase signál + reakce', (d) => {
    const view = logic.view(logic.setup({ rng: createRng('v'), starter: 'A' }), 'B');
    const ctx = ai(d, `ai-${d}`);
    for (let i = 0; i < 200; i++) {
      const move = quickDrawAIMove(view, ctx);
      expect(quickDrawMoveSchema.safeParse(move).success).toBe(true);
      const delay = quickDrawAIDelay(view, move, ctx);
      if (move.kind === 'reacted') expect(delay).toBe(view.delayMs + move.ms);
      else expect(delay).toBeLessThan(view.delayMs);
    }
  });
});
