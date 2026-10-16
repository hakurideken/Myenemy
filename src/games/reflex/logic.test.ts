import { describe, expect, it } from 'vitest';
import { AIMemory } from '../../core/MiniGame';
import { DIFFICULTIES, DRAW, win } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { reflexAIDelay, reflexAIMove } from './ai';
import {
  COLORS,
  judgeReflex,
  normalizeReflex,
  reflexLogic as logic,
  reflexMoveSchema,
  SHAPES,
  targetLabel,
  type ReflexResult,
} from './logic';

const hit = (ms: number): ReflexResult => ({ kind: 'hit', ms });
const MISS: ReflexResult = { kind: 'miss' };
const EARLY: ReflexResult = { kind: 'false-start' };
const TIMEOUT: ReflexResult = { kind: 'timeout' };

describe('Postřeh – deska', () => {
  it('čtyři cíle s různými barvami i tvary, cíl a prodleva ze seedu', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const s = logic.setup({ rng: createRng(seed), starter: 'A' });
      expect(new Set(s.targets.map((t) => t.color)).size).toBe(4);
      expect(new Set(s.targets.map((t) => t.shape)).size).toBe(4);
      expect(s.target).toBeGreaterThanOrEqual(0);
      expect(s.target).toBeLessThan(4);
    }
    expect(logic.setup({ rng: createRng('z'), starter: 'A' })).toEqual(
      logic.setup({ rng: createRng('z'), starter: 'B' }),
    );
  });

  it('popisky se správným rodem', () => {
    expect(targetLabel({ color: 'yellow', shape: 'star' })).toBe('žlutá hvězda');
    expect(targetLabel({ color: 'green', shape: 'triangle' })).toBe('zelený trojúhelník');
    expect(COLORS).toHaveLength(4);
    expect(SHAPES).toHaveLength(4);
  });
});

describe('Postřeh – vyhodnocení', () => {
  it('správnost klepnutí určuje logika', () => {
    expect(normalizeReflex({ kind: 'tap', index: 2, ms: 351.4 }, 2)).toEqual(hit(351));
    expect(normalizeReflex({ kind: 'tap', index: 1, ms: 351 }, 2)).toEqual(MISS);
    expect(normalizeReflex({ kind: 'tap', index: 2, ms: 60 }, 2)).toEqual(EARLY);
    expect(normalizeReflex({ kind: 'tap', index: 2, ms: 4000 }, 2)).toEqual(TIMEOUT);
  });

  it('rychlejší zásah vyhrává, chyba prohrává i proti „nestihl“', () => {
    expect(judgeReflex(hit(300), hit(420))).toEqual(win('A'));
    expect(judgeReflex(hit(300), hit(300))).toEqual(DRAW);
    expect(judgeReflex(MISS, TIMEOUT)).toEqual(win('B'));
    expect(judgeReflex(EARLY, hit(900))).toEqual(win('B'));
    expect(judgeReflex(MISS, EARLY)).toEqual(DRAW);
    expect(judgeReflex(TIMEOUT, TIMEOUT)).toEqual(DRAW);
  });

  it('výsledek soupeře je skrytý, dokud neklepnou oba', () => {
    let s = logic.setup({ rng: createRng('v'), starter: 'A' });
    s = logic.apply(s, 'A', { kind: 'tap', index: s.target, ms: 280 });
    expect(logic.view(s, 'B')).toMatchObject({ mine: null, opponentDone: true, results: null });
    s = logic.apply(s, 'B', { kind: 'timeout' });
    expect(logic.outcome(s)).toEqual(win('A'));
  });

  it('schéma tahu', () => {
    expect(reflexMoveSchema.safeParse({ kind: 'tap', index: 3, ms: 250 }).success).toBe(true);
    expect(reflexMoveSchema.safeParse({ kind: 'tap', index: 4, ms: 250 }).success).toBe(false);
    expect(reflexMoveSchema.safeParse({ kind: 'hit', ms: 250 }).success).toBe(false);
  });
});

describe('Postřeh – AI', () => {
  it.each(DIFFICULTIES)(
    '%s: většinou trefí správný cíl, pomaleji než u Tasce, ve správný čas',
    (difficulty) => {
      const rng = createRng(`rf-${difficulty}`);
      const ai = { difficulty, rng, me: 'B' as const, memory: new AIMemory() };
      const view = logic.view(logic.setup({ rng, starter: 'A' }), 'B');
      let hits = 0;
      for (let i = 0; i < 400; i++) {
        const move = reflexAIMove(view, ai);
        expect(reflexMoveSchema.safeParse(move).success).toBe(true);
        const result = normalizeReflex(move, view.target);
        if (result.kind === 'hit') {
          hits++;
          expect(result.ms).toBeGreaterThan(250);
          expect(reflexAIDelay(view, move, ai)).toBe(
            view.delayMs + (move.kind === 'tap' ? move.ms : 0),
          );
        }
      }
      expect(hits / 400).toBeGreaterThan(0.8);
    },
  );
});
