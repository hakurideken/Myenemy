import { describe, expect, it } from 'vitest';
import { normalizeNickname, validateNickname } from './nickname';

const ok = (raw: string): string => {
  const result = validateNickname(raw);
  if (!result.ok) throw new Error(`Čekal jsem platnou přezdívku: ${result.error}`);
  return result.value;
};

describe('validateNickname', () => {
  it('ořízne bílé znaky a sloučí mezery', () => {
    expect(ok('   Pepa    Novák  ')).toBe('Pepa Novák');
    expect(normalizeNickname('\tJana\n')).toBe('Jana');
  });

  it('povolí diakritiku (čeština i slovenština)', () => {
    expect(ok('Žluťoučký kůň')).toBe('Žluťoučký kůň');
    expect(ok('Ľubomír')).toBe('Ľubomír');
    expect(ok('Ďábel_42')).toBe('Ďábel_42');
    expect(ok('Ôsma-hra.')).toBe('Ôsma-hra.');
  });

  it('převede rozložené znaky (NFD) na složené', () => {
    expect(ok('čert')).toBe('čert');
  });

  it('hlídá délku 2–16 znaků po oříznutí', () => {
    expect(validateNickname('A').ok).toBe(false);
    expect(validateNickname('  A  ').ok).toBe(false);
    expect(ok('Ab')).toBe('Ab');
    expect(ok('a'.repeat(16))).toHaveLength(16);
    expect(validateNickname('a'.repeat(17)).ok).toBe(false);
    expect(ok('ěščřžýáíéůúťďňó')).toHaveLength(15);
  });

  it('odmítne HTML, řídicí a neviditelné znaky', () => {
    // Neviditelné znaky skládáme z kódů, aby ve zdrojáku nebyly doslova (Trojan Source).
    const hidden = (codePoint: number): string => `Pe${String.fromCodePoint(codePoint)}pa`;
    for (const bad of [
      '<script>',
      hidden(0x0000),
      hidden(0x200b),
      hidden(0x202e),
      'a&b',
      'Kůň"',
      '😀😀',
    ]) {
      expect(validateNickname(bad).ok, bad).toBe(false);
    }
  });
});
