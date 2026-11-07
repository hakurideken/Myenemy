export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 16;

// Písmena (vč. diakritiky po NFC), číslice 0–9, mezera a _ . - – žádné řídicí ani neviditelné znaky.
const ALLOWED = /^[\p{L}0-9 _.-]+$/u;
/** Znaky, které se nezobrazí (např. hangulská výplň U+3164) – přezdívka by byla neviditelná. */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/u;
const LETTER = /\p{L}/u;
/**
 * Všechna písmena z jedné abecedy. Jinak by šlo napodobit jiného hráče: cyrilské a (U+0430),
 * čerokíjské A (U+13AA), lisuské A (U+A4EE) nebo arménské o (U+0585) vypadají jako latinka.
 */
const SCRIPTS = [
  // Latinka jen základní a se středoevropskou diakritikou (bez ɑ, ı a podobných dvojníků).
  /^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u0130\u0132-\u0137\u0139-\u0148\u014A-\u017E]$/u,
  // Azbuka a řečtina jen v rozsazích písmen – stejně jako kontrola na serveru
  // (supabase/migrations/…_accounts.sql, nickname_is_valid).
  /^[\u0400-\u0481\u048A-\u052F]$/u,
  /^[\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03FF\u1F00-\u1FBC\u1FC2-\u1FCC\u1FD0-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FFC]$/u,
];

import { translations } from '../i18n';

const t = translations(
  {
    tooShort: (min: number) => `Přezdívka musí mít aspoň ${min} znaky.`,
    tooLong: (max: number) => `Přezdívka může mít nejvýš ${max} znaků.`,
    chars: 'Povolená jsou písmena (i s diakritikou), číslice, mezera a znaky _ . -',
    script: 'Písmena musí být z jedné abecedy: latinka, azbuka, nebo řečtina.',
  },
  {
    tooShort: (min: number) => `The nickname needs at least ${min} characters.`,
    tooLong: (max: number) => `The nickname can have at most ${max} characters.`,
    chars: 'Allowed are letters (accents too), digits, space and _ . -',
    script: 'Letters must come from one alphabet: Latin, Cyrillic or Greek.',
  },
);

export type NicknameResult = { ok: true; value: string } | { ok: false; error: string };

export function normalizeNickname(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

export function validateNickname(raw: string): NicknameResult {
  const value = normalizeNickname(raw);
  const length = [...value].length;
  if (length < NICKNAME_MIN) {
    return { ok: false, error: t.tooShort(NICKNAME_MIN) };
  }
  if (length > NICKNAME_MAX) {
    return { ok: false, error: t.tooLong(NICKNAME_MAX) };
  }
  // NFKC odhalí „ozdobné“ varianty písmen a číslic (matematické 𝐚, plnou šířku, ligatury).
  if (!ALLOWED.test(value) || INVISIBLE.test(value) || value !== value.normalize('NFKC')) {
    return { ok: false, error: t.chars };
  }
  const letters = [...value].filter((ch) => LETTER.test(ch));
  if (letters.length > 0 && !SCRIPTS.some((script) => letters.every((ch) => script.test(ch)))) {
    return { ok: false, error: t.script };
  }
  return { ok: true, value };
}
