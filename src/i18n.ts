import { readItem, writeItem } from './platform/storage';

/**
 * Jazyk rozhraní. Texty si každý modul drží vedle sebe v češtině i angličtině
 * (`translations`), TypeScript hlídá, že anglická verze má stejný tvar jako česká.
 * Jazyk se vybere při startu stránky; po přepnutí se stránka znovu načte.
 */
export type Lang = 'cs' | 'en';
export const LANGS: readonly Lang[] = ['cs', 'en'];

const KEY = 'lang';

function detect(): Lang {
  const stored = readItem(KEY);
  if (stored === 'cs' || stored === 'en') return stored;
  // Mimo prohlížeč (testy) česky; v prohlížeči podle jeho jazyků.
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return 'cs';
  const preferred = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const code = tag.toLowerCase().slice(0, 2);
    if (code === 'cs' || code === 'sk') return 'cs';
    if (code === 'en') return 'en';
  }
  return 'en';
}

let current: Lang | null = null;

export function lang(): Lang {
  current ??= detect();
  return current;
}

/** Uloží volbu; o znovunačtení stránky se postará volající. */
export function setLang(next: Lang): void {
  current = next;
  writeItem(KEY, next);
}

/** Texty modulu v aktuálním jazyce. */
export function translations<T>(cs: T, en: NoInfer<T>): T {
  return lang() === 'en' ? en : cs;
}
