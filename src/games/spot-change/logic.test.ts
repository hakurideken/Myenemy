import { describe, expect, it } from 'vitest';
import { AIMemory } from '../../core/MiniGame';
import { DRAW, win, type Difficulty } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { spotAIDelay, spotAIMove } from './ai';
import { CELLS, ITEMS, judgeSpots, ROUNDS, scoreAnswers, spotLogic, type SpotState } from './logic';

const fresh = (seed = 'zmena'): SpotState =>
  spotLogic.setup({ rng: createRng(seed), starter: 'A' });

describe('Co se změnilo – logika', () => {
  it('každé kolo má přesně jednu změnu na označeném políčku', () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = fresh(`s${seed}`);
      expect(s.rounds).toHaveLength(ROUNDS);
      s.rounds.forEach((round, i) => {
        expect(round.before).toHaveLength(CELLS);
        expect(round.before.filter((p) => p !== null)).toHaveLength(ITEMS[i] ?? 0);
        const changed = round.before
          .map((p, cell) => (p === round.after[cell] ? -1 : cell))
          .filter((cell) => cell >= 0);
        expect(changed).toEqual([round.cell]);
        const before = round.before[round.cell] ?? null;
        const after = round.after[round.cell] ?? null;
        if (round.kind === 'gone') expect([before !== null, after]).toEqual([true, null]);
        if (round.kind === 'new') expect([before, after !== null]).toEqual([null, true]);
        if (round.kind === 'swap')
          expect(before !== null && after !== null && before !== after).toBe(true);
        // Obrázky se na desce neopakují.
        const pictures = round.after.filter((p) => p !== null);
        expect(new Set(pictures).size).toBe(pictures.length);
      });
    }
  });

  it('body za správná políčka, čas jen u správných; příliš rychlá odpověď neplatí', () => {
    const { rounds } = fresh();
    const answers = rounds.map((r, i) => ({ cell: i < 4 ? r.cell : -1, ms: 1000 }));
    expect(scoreAnswers(rounds, answers)).toEqual({ kind: 'score', correct: 4, ms: 4000 });
    expect(scoreAnswers(rounds, answers.slice(1))).toEqual({ kind: 'invalid' });
    const fast = rounds.map((r) => ({ cell: r.cell, ms: 50 }));
    expect(scoreAnswers(rounds, fast)).toEqual({ kind: 'invalid' });
  });

  it('víc správných vyhrává, při shodě rychlejší', () => {
    const r = (correct: number, ms: number) => ({ kind: 'score', correct, ms }) as const;
    expect(judgeSpots(r(5, 9000), r(4, 100))).toEqual(win('A'));
    expect(judgeSpots(r(5, 9000), r(5, 8000))).toEqual(win('B'));
    expect(judgeSpots(r(0, 0), r(0, 0))).toEqual(DRAW);
  });

  it('odpovědi soupeře se ukážou až na konci', () => {
    let s = fresh();
    const answers = s.rounds.map((r) => ({ cell: r.cell, ms: 900 }));
    s = spotLogic.apply(s, 'A', { kind: 'answers', answers });
    expect(spotLogic.view(s, 'B').answers).toBeNull();
    s = spotLogic.apply(s, 'B', { kind: 'answers', answers: [] });
    expect(spotLogic.view(s, 'B').answers?.A).toEqual(answers);
    expect(spotLogic.outcome(s)).toEqual(win('A'));
  });
});

describe('Co se změnilo – AI', () => {
  const correct = (d: Difficulty, seed: string): number => {
    const s = fresh(seed);
    const view = spotLogic.view(s, 'B');
    const ai = { difficulty: d, rng: createRng(seed), me: 'B' as const, memory: new AIMemory() };
    const move = spotAIMove(view, ai);
    expect(spotAIDelay(view, move)).toBeGreaterThan(10_000);
    const result = scoreAnswers(s.rounds, move.answers);
    if (result.kind !== 'score') throw new Error('neplatné');
    return result.correct;
  };

  it('těžká AI odpoví správně častěji než lehká', () => {
    let easy = 0;
    let hard = 0;
    for (let i = 0; i < 40; i++) {
      easy += correct('easy', `e${i}`);
      hard += correct('hard', `h${i}`);
    }
    expect(hard).toBeGreaterThan(easy * 1.2);
  });
});
