export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 16;

// Písmena (vč. diakritiky po NFC), číslice, mezera a _ . -  – žádné řídicí ani neviditelné znaky.
const ALLOWED = /^[\p{L}\p{N} _.-]+$/u;

export type NicknameResult = { ok: true; value: string } | { ok: false; error: string };

export function normalizeNickname(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

export function validateNickname(raw: string): NicknameResult {
  const value = normalizeNickname(raw);
  const length = [...value].length;
  if (length < NICKNAME_MIN) {
    return { ok: false, error: `Přezdívka musí mít aspoň ${NICKNAME_MIN} znaky.` };
  }
  if (length > NICKNAME_MAX) {
    return { ok: false, error: `Přezdívka může mít nejvýš ${NICKNAME_MAX} znaků.` };
  }
  if (!ALLOWED.test(value)) {
    return {
      ok: false,
      error: 'Povolená jsou písmena (i s diakritikou), číslice, mezera a znaky _ . -',
    };
  }
  return { ok: true, value };
}
