import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonicalJson';
import { combineSeeds, commit, sha256Hex, verifyCommit } from './commitReveal';

describe('canonicalJson', () => {
  it('nezávisí na pořadí klíčů a vynechá undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' }, z: undefined })).toBe(
      canonicalJson({ a: { c: 'x', d: [1, 2] }, b: 1 }),
    );
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('odmítne nekonečna a funkce', () => {
    expect(() => canonicalJson({ x: Infinity })).toThrow(TypeError);
    expect(() => canonicalJson({ x: () => 1 })).toThrow(TypeError);
  });
});

describe('commit-reveal', () => {
  it('SHA-256 odpovídá známé hodnotě', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('odhalení s původní hodnotou a solí projde', async () => {
    const c = await commit({ choice: 'rock' });
    expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(c.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyCommit(c.hash, { choice: 'rock' }, c.salt)).toBe(true);
  });

  it('jiná hodnota, jiná sůl nebo poškozený hash neprojde', async () => {
    const c = await commit({ choice: 'rock' });
    expect(await verifyCommit(c.hash, { choice: 'paper' }, c.salt)).toBe(false);
    expect(await verifyCommit(c.hash, { choice: 'rock' }, '0'.repeat(64))).toBe(false);
    expect(await verifyCommit('x', { choice: 'rock' }, c.salt)).toBe(false);
    expect(await verifyCommit(c.hash, { choice: 'rock' }, 'kratka')).toBe(false);
  });

  it('stejná hodnota má pokaždé jiný hash (sůl)', async () => {
    const a = await commit('seed');
    const b = await commit('seed');
    expect(a.hash).not.toBe(b.hash);
  });

  it('společný seed závisí na obou příspěvcích a jejich pořadí', async () => {
    const ab = await combineSeeds('a', 'b');
    expect(ab).toBe(await combineSeeds('a', 'b'));
    expect(ab).not.toBe(await combineSeeds('b', 'a'));
    expect(ab).not.toBe(await combineSeeds('a', 'c'));
  });
});
