import { describe, expect, it } from 'vitest';
import { formatHandle } from './account';
import { friendsSchema, isUserId, parseHandle } from './friends';

describe('kamarádi – jméno s kódem', () => {
  it('rozpozná Pepa#0042 i bez úvodních nul a s mezerami kolem', () => {
    expect(parseHandle('Pepa#0042')).toEqual({ nickname: 'Pepa', tag: 42 });
    expect(parseHandle('  Žofie Nová # 7 ')).toEqual({ nickname: 'Žofie Nová', tag: 7 });
    // Křížek může být i v přezdívce? Ne – ale kód se bere za posledním.
    expect(parseHandle('A#B#12')).toEqual({ nickname: 'A#B', tag: 12 });
  });

  it('odmítne jméno bez kódu, nulový nebo pětimístný kód', () => {
    for (const bad of ['Pepa', 'Pepa#', '#0042', 'Pepa#0000', 'Pepa#12345', 'Pepa#12a', '']) {
      expect(parseHandle(bad), bad).toBeNull();
    }
  });

  it('formát a zpět sedí', () => {
    const profile = { nickname: 'Jana', tag: 9 };
    expect(parseHandle(formatHandle(profile))).toEqual(profile);
  });

  it('odpověď serveru se ověří schématem', () => {
    const id = '0f8a4e2c-1b3d-4c5e-8f9a-0b1c2d3e4f50';
    expect(isUserId(id)).toBe(true);
    expect(isUserId('not-an-id')).toBe(false);
    expect(
      friendsSchema.safeParse([
        { id, nickname: 'Ota', tag: 1, wins: 2, losses: 0, status: 'online' },
      ]).success,
    ).toBe(true);
    expect(
      friendsSchema.safeParse([
        { id, nickname: 'Ota', tag: 1, wins: -1, losses: 0, status: 'online' },
      ]).success,
    ).toBe(false);
  });
});
