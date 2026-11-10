import { describe, expect, it } from 'vitest';
import { AIMemory } from '../../core/MiniGame';
import { DRAW, win, type Difficulty } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { sequenceAIDelay, sequenceAIMove } from './ai';
import {
  COUNTDOWN_MS,
  judgeRuns,
  levelLength,
  MAX_LENGTH,
  MAX_LEVEL,
  MAX_PRESSES,
  normalizeRun,
  replay,
  sequenceLogic,
  type SequenceState,
} from './logic';

const fresh = (seed = 'sekvence'): SequenceState =>
  sequenceLogic.setup({ rng: createRng(seed), starter: 'A' });

/** Správné stisky pro prvních n kol. */
function correctPresses(seq: readonly number[], levels: number): number[] {
  const out: number[] = [];
  for (let l = 1; l <= levels; l++) out.push(...seq.slice(0, levelLength(l)));
  return out;
}

describe('Sekvence – logika', () => {
  it('řada má 17 položek z polí 0–3 a stejný seed = stejná řada', () => {
    const s = fresh();
    expect(s.sequence).toHaveLength(MAX_LENGTH);
    expect(s.sequence.every((p) => p >= 0 && p <= 3)).toBe(true);
    expect(fresh('x').sequence).toEqual(fresh('x').sequence);
    // Nikde tři stejná pole za sebou.
    for (let i = 2; i < s.sequence.length; i++) {
      const same = s.sequence[i] === s.sequence[i - 1] && s.sequence[i] === s.sequence[i - 2];
      expect(same).toBe(false);
    }
  });

  it('z odeslaných stisků spočítá zvládnutá kola – chyba uprostřed kola se nepočítá', () => {
    const { sequence } = fresh();
    expect(replay(sequence, [])).toEqual({ level: 0, used: 0 });
    expect(replay(sequence, correctPresses(sequence, 3)).level).toBe(3);
    const wrong = [...correctPresses(sequence, 2), ...sequence.slice(0, 2), 9];
    expect(replay(sequence, wrong).level).toBe(2);
    expect(replay(sequence, correctPresses(sequence, MAX_LEVEL)).level).toBe(MAX_LEVEL);
    expect(correctPresses(sequence, MAX_LEVEL).length).toBeLessThanOrEqual(MAX_PRESSES);
  });

  it('nelidsky rychlé zadání je neplatné', () => {
    const { sequence } = fresh();
    const presses = correctPresses(sequence, 4);
    expect(normalizeRun(sequence, { kind: 'run', presses, ms: 5 })).toEqual({ kind: 'invalid' });
    expect(normalizeRun(sequence, { kind: 'run', presses, ms: 8000 })).toEqual({
      kind: 'run',
      level: 4,
      ms: 8000,
    });
  });

  it('víc kol vyhrává, při shodě rychlejší, úplná shoda remíza', () => {
    const run = (level: number, ms: number) => ({ kind: 'run', level, ms }) as const;
    expect(judgeRuns(run(5, 9000), run(4, 1000))).toEqual(win('A'));
    expect(judgeRuns(run(5, 9000), run(5, 8000))).toEqual(win('B'));
    expect(judgeRuns(run(5, 9000), run(5, 9000))).toEqual(DRAW);
    expect(judgeRuns(run(0, 0), { kind: 'invalid' })).toEqual(win('A'));
  });

  it('hra končí, až mají hotovo oba', () => {
    let s = fresh();
    s = sequenceLogic.apply(s, 'A', {
      kind: 'run',
      presses: correctPresses(s.sequence, 2),
      ms: 3000,
    });
    expect(sequenceLogic.outcome(s)).toBeNull();
    expect(sequenceLogic.view(s, 'B').opponentDone).toBe(true);
    expect(sequenceLogic.view(s, 'B').results).toBeNull();
    s = sequenceLogic.apply(s, 'B', { kind: 'run', presses: [], ms: 0 });
    expect(sequenceLogic.outcome(s)).toEqual(win('A'));
  });
});

describe('Sekvence – AI', () => {
  const level = (d: Difficulty, seed: string): number => {
    const s = fresh(seed);
    const view = sequenceLogic.view(s, 'B');
    const ai = { difficulty: d, rng: createRng(seed), me: 'B' as const, memory: new AIMemory() };
    const move = sequenceAIMove(view, ai);
    // AI odešle výsledek do pár sekund po odpočtu – hráč na ni nečeká, i když skončí hned.
    const delay = sequenceAIDelay(view, move, ai);
    expect(delay).toBeGreaterThan(COUNTDOWN_MS);
    expect(delay).toBeLessThan(COUNTDOWN_MS + 3500);
    const result = normalizeRun(s.sequence, move);
    if (result.kind !== 'run') throw new Error('AI poslala neplatný běh');
    return result.level;
  };

  it('tahy jsou platné a těžká zvládne víc kol než lehká', () => {
    let easy = 0;
    let hard = 0;
    for (let i = 0; i < 40; i++) {
      easy += level('easy', `e${i}`);
      hard += level('hard', `h${i}`);
    }
    expect(hard / 40).toBeGreaterThan(easy / 40 + 3);
  });
});
