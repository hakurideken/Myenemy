import { describe, expect, it } from 'vitest';
import { createRng, deriveRng, randomSeed } from './rng';

const sample = (seed: string, n = 8): number[] => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe('createRng', () => {
  it('stejný seed dá stejnou posloupnost', () => {
    expect(sample('souboj')).toEqual(sample('souboj'));
  });

  it('různé seedy dají různé posloupnosti', () => {
    expect(sample('a')).not.toEqual(sample('b'));
  });

  it('next() je v intervalu [0, 1)', () => {
    const rng = createRng('rozsah');
    for (let i = 0; i < 10_000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('int() vrací celá čísla v rozsahu a pokryje všechny hodnoty', () => {
    const rng = createRng('int');
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const x = rng.int(6);
      expect(Number.isInteger(x)).toBe(true);
      seen.add(x);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('int() odmítne neplatnou mez', () => {
    const rng = createRng('x');
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(() => rng.int(2.5)).toThrow(RangeError);
  });

  it('shuffle() nemění vstup a zachová prvky', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = createRng('mix').shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
  });

  it('pick() z prázdného pole vyhodí chybu', () => {
    expect(() => createRng('x').pick([])).toThrow(RangeError);
  });

  it('normal() má přibližně zadaný průměr a směrodatnou odchylku', () => {
    const rng = createRng('gauss');
    const xs = Array.from({ length: 20_000 }, () => rng.normal(100, 10));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(mean).toBeCloseTo(100, 0);
    expect(sd).toBeGreaterThan(9.5);
    expect(sd).toBeLessThan(10.5);
  });
});

describe('deriveRng / randomSeed', () => {
  it('odvozené generátory se liší podle štítku', () => {
    expect(deriveRng('seed', 'game', 1).next()).not.toBe(deriveRng('seed', 'game', 2).next());
    expect(deriveRng('seed', 'game', 1).next()).toBe(deriveRng('seed', 'game', 1).next());
  });

  it('randomSeed() vrací 32 hex znaků a pokaždé jiný', () => {
    const a = randomSeed();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomSeed()).not.toBe(a);
  });
});
