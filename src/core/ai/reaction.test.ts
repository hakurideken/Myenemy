import { describe, expect, it } from 'vitest';
import { MIN_REACTION_MS } from '../../games/quick-draw/logic';
import { DIFFICULTIES, type Difficulty } from '../types';
import { createRng } from '../util/rng';
import { REACTION_PROFILES, sampleReaction } from './reaction';

const N = 3000;

function stats(difficulty: Difficulty): { mean: number; min: number; falseStarts: number } {
  const rng = createRng(`reaction-${difficulty}`);
  const times: number[] = [];
  let falseStarts = 0;
  for (let i = 0; i < N; i++) {
    const s = sampleReaction(difficulty, rng);
    if (s.kind === 'false-start') falseStarts++;
    else times.push(s.ms);
  }
  return {
    mean: times.reduce((a, b) => a + b, 0) / times.length,
    min: Math.min(...times),
    falseStarts: falseStarts / N,
  };
}

describe('model reakční doby AI', () => {
  it.each(DIFFICULTIES)('%s: průměr kolem cílové hodnoty (450 / 330 / 250 ms)', (d) => {
    const { mean } = stats(d);
    expect(Math.abs(mean - REACTION_PROFILES[d].meanMs)).toBeLessThan(30);
  });

  it.each(DIFFICULTIES)('%s: nikdy nadlidsky rychlá (pod limitem hostitele 100 ms)', (d) => {
    const { min } = stats(d);
    expect(min).toBeGreaterThanOrEqual(REACTION_PROFILES[d].minMs);
    expect(min).toBeGreaterThan(MIN_REACTION_MS);
  });

  it.each(DIFFICULTIES)('%s: občas udělá chybu (předčasný výstřel)', (d) => {
    const { falseStarts } = stats(d);
    expect(falseStarts).toBeGreaterThan(0);
    expect(Math.abs(falseStarts - REACTION_PROFILES[d].falseStartRate)).toBeLessThan(0.025);
  });

  it('těžší obtížnost je rychlejší', () => {
    const [easy, medium, hard] = DIFFICULTIES.map((d) => stats(d).mean);
    expect(easy).toBeGreaterThan(medium ?? 0);
    expect(medium).toBeGreaterThan(hard ?? 0);
  });
});
