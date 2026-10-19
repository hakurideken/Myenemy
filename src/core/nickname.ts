export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 16;

// Písmena (vč. diakritiky po NFC), číslice, mezera a _ . -  – žádné řídicí ani neviditelné znaky.
const ALLOWED = /^[\p{L}\p{N} _.-]+$/u;

import { translations } from '../i18n';

const t = translations(
  {
    tooShort: (min: number) => `Přezdívka musí mít aspoň ${min} znaky.`,
    tooLong: (max: number) => `Přezdívka může mít nejvýš ${max} znaků.`,
    chars: 'Povolená jsou písmena (i s diakritikou), číslice, mezera a znaky _ . -',
  },
  {
    tooShort: (min: number) => `The nickname needs at least ${min} characters.`,
    tooLong: (max: number) => `The nickname can have at most ${max} characters.`,
    chars: 'Allowed are letters (accents too), digits, space and _ . -',
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
  if (!ALLOWED.test(value)) {
    return { ok: false, error: t.chars };
  }
  return { ok: true, value };
}
