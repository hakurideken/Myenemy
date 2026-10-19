import { afterEach, describe, expect, it, vi } from 'vitest';

const CZECH = /[áčďéěíňóřšťúůýž]/i;
/** Vlastní jména, která zůstávají i v angličtině (typ karet, název hry). */
const stripNames = (text: string): string => text.replaceAll('Mariáš', '').replaceAll('Prší', '');
const MODES = ['pve', 'local', 'online'] as const;

/** Načte moduly znovu, jako by stránka startovala s uloženým jazykem. */
async function loadWith(stored: string | null): Promise<void> {
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'myenemy:lang' ? stored : null),
    setItem: () => undefined,
  });
  await Promise.resolve();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('jazyk', () => {
  it('v testech bez volby je čeština', async () => {
    await loadWith(null);
    const { lang, translations } = await import('./i18n');
    expect(lang()).toBe('cs');
    expect(translations<string>('ahoj', 'hello')).toBe('ahoj');
  });

  it('uložená volba angličtiny platí', async () => {
    await loadWith('en');
    const { lang, translations } = await import('./i18n');
    expect(lang()).toBe('en');
    expect(translations<string>('ahoj', 'hello')).toBe('hello');
  });

  it('anglicky nezůstane v hrách žádný český text', async () => {
    await loadWith('en');
    const { GAMES } = await import('./games/registry');
    for (const game of GAMES) {
      const texts = [game.name, ...game.rules, ...MODES.flatMap((m) => game.controls(m))];
      for (const text of texts) expect(stripNames(text), `${game.id}: ${text}`).not.toMatch(CZECH);
    }
  });

  it('anglicky nezůstane český text v popiscích a kartách', async () => {
    await loadWith('en');
    const labels = await import('./ui/labels');
    const { cardName, SUIT_NAME } = await import('./games/shared/marias');
    const texts = [
      ...Object.values(labels.DIFFICULTY_LABEL),
      ...Object.values(labels.DIFFICULTY_HINT),
      ...Object.values(labels.TYPE_LABEL),
      ...Object.values(labels.LENGTH_LABEL),
      ...Object.values(labels.MODE_LABEL),
      ...Object.values(labels.FORMAT_INFO).flatMap((f) => [f.name, f.description]),
      ...SUIT_NAME,
    ];
    for (const text of texts) expect(text).not.toMatch(CZECH);
    expect(cardName(0)).toBe('Seven of Hearts');
  });

  it('česky zůstávají původní texty', async () => {
    await loadWith('cs');
    const { cardName } = await import('./games/shared/marias');
    const { GAMES } = await import('./games/registry');
    expect(cardName(0)).toBe('srdcová sedma');
    expect(GAMES.map((g) => g.name)).toContain('Piškvorky 3×3');
  });
});
