import { describe, expect, it } from 'vitest';
import {
  CardCodec,
  createKeyPair,
  encodeCard,
  isDeckElement,
  jacobi,
  modInverse,
  modPow,
  P,
  Q,
  randomBelow,
  secureShuffle,
  unlockCard,
} from './mentalPoker';

/** Miller–Rabin s pevnými bázemi – stačí k odhalení překlepu v konstantě. */
function probablyPrime(n: bigint): boolean {
  let d = n - 1n;
  let r = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    r++;
  }
  for (const a of [2n, 3n, 5n, 7n, 11n]) {
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let i = 1; i < r; i++) {
      x = (x * x) % n;
      if (x === n - 1n) {
        composite = false;
        break;
      }
    }
    if (composite) return false;
  }
  return true;
}

describe('mental poker – aritmetika', () => {
  it('p je 2048bitové bezpečné prvočíslo (p = 2q + 1, obě prvočísla)', () => {
    expect(P.toString(2)).toHaveLength(2048);
    expect(P).toBe(2n * Q + 1n);
    expect(probablyPrime(P)).toBe(true);
    expect(probablyPrime(Q)).toBe(true);
  });

  it('modPow a modInverse', () => {
    expect(modPow(3n, 200n, 1000n)).toBe(3n ** 200n % 1000n);
    expect(modPow(5n, 0n, 7n)).toBe(1n);
    const e = 65537n;
    expect((e * modInverse(e, Q)) % Q).toBe(1n);
    expect(() => modInverse(6n, 9n)).toThrow();
  });

  it('Jacobiho symbol: karty jsou rezidua, −1 není (p ≡ 3 mod 4)', () => {
    expect(jacobi(4n, P)).toBe(1);
    expect(jacobi(P - 1n, P)).toBe(-1);
    expect(jacobi(15n, 7n)).toBe(1);
    expect(jacobi(3n, 7n)).toBe(-1);
  });

  it('karty jsou rezidua bez vzájemných vztahů (šifrování by je prozradilo)', async () => {
    const codec = await CardCodec.create(32);
    const deck = codec.encodedDeck();
    expect(deck.every(isDeckElement)).toBe(true);
    expect(new Set(deck).size).toBe(32);
    // Dříve (id + 2)²: 4 · 9 = 36 – součin dvou karet byl jiná karta.
    const values = new Set(deck);
    for (const a of deck) {
      for (const b of deck) expect(values.has((a * b) % P)).toBe(false);
    }
    expect(await encodeCard(5)).toBe(deck[5]);
  });

  it('šifrování komutuje a dvojí odemknutí vrátí kartu', async () => {
    const codec = await CardCodec.create(32);
    const a = createKeyPair();
    const b = createKeyPair();
    const m = await encodeCard(17);
    const ab = modPow(modPow(m, a.e), b.e);
    expect(modPow(modPow(m, b.e), a.e)).toBe(ab);
    expect(codec.decode(unlockCard(ab, a.d, b.d))).toBe(17);
    expect(codec.decode(unlockCard(ab, a.d, a.d))).toBeNull();
  });

  it('náhoda: randomBelow v mezích, míchání je permutace', () => {
    for (let i = 0; i < 200; i++) {
      const x = randomBelow(10n);
      expect(x >= 0n && x < 10n).toBe(true);
    }
    const deck = Array.from({ length: 32 }, (_, i) => i);
    expect(secureShuffle(deck).sort((x, y) => x - y)).toEqual(deck);
  });
});
