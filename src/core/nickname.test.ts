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

  it('odmítne neviditelnou přezdívku a míchání abeced (vydávání se za jiného)', () => {
    // Hangulská výplň a cyrilské „а“ skládáme z kódů, ať nejsou ve zdrojáku doslova.
    const filler = String.fromCodePoint(0x3164);
    const cyrillicA = String.fromCodePoint(0x0430);
    expect(validateNickname(filler + filler).ok).toBe(false);
    expect(validateNickname(`P${cyrillicA}vel`).ok).toBe(false);
    // Písmena z jiných písem, která vypadají jako latinka, a „ozdobné“ varianty písmen.
    const from = (...codes: number[]): string => String.fromCodePoint(...codes);
    for (const bad of [
      from(0x13aa, 0x13e2, 0x13d9), // čerokíjština
      from(0xa4ee, 0xa4f2), // lisu
      'J' + from(0x0585) + 'hn', // arménské o v latince
      from(0x1d41a, 0x1d41b), // matematické tučné a, b
      from(0xff30) + 'avel', // P plné šířky
      'Pavel' + from(0x00b2), // horní index
      'J' + from(0x0251) + 'n' + from(0x0251), // latinské alfa místo a
      from(0x0131) + 'van', // turecké ı bez tečky
    ]) {
      expect(validateNickname(bad).ok, bad).toBe(false);
    }
    expect(validateNickname('Ἀλέξης').ok).toBe(true);
    expect(validateNickname('Иван').ok).toBe(true);
    expect(validateNickname('Pavel 2').ok).toBe(true);
  });
});
