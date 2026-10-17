/**
 * Mariášové karty (32): 4 barvy × 8 hodnot. Karta = barva · 8 + hodnota.
 * Barvy: srdce, listy (zelené), kule, žaludy. Hodnoty: 7, 8, 9, 10, spodek, svršek, král, eso.
 */
export const MARIAS_SIZE = 32;
export const SUIT_COUNT = 4;
export const RANK_COUNT = 8;

export const RANK = {
  SEVEN: 0,
  EIGHT: 1,
  NINE: 2,
  TEN: 3,
  SPODEK: 4,
  SVRSEK: 5,
  KRAL: 6,
  ESO: 7,
} as const;

export const suitOf = (card: number): number => Math.floor(card / RANK_COUNT);
export const rankOf = (card: number): number => card % RANK_COUNT;
export const cardOf = (suit: number, rank: number): number => suit * RANK_COUNT + rank;

/** Název barvy (např. při volbě barvy svrškem). */
export const SUIT_NAME: readonly string[] = ['srdce', 'listy', 'kule', 'žaludy'];
/** Přídavné jméno barvy pro rod ženský / mužský / střední. */
const SUIT_ADJ: readonly (readonly [string, string, string])[] = [
  ['srdcová', 'srdcový', 'srdcové'],
  ['zelená', 'zelený', 'zelené'],
  ['kulová', 'kulový', 'kulové'],
  ['žaludská', 'žaludský', 'žaludské'],
];
const RANK_NAME: readonly string[] = [
  'sedma',
  'osma',
  'devítka',
  'desítka',
  'spodek',
  'svršek',
  'král',
  'eso',
];
/** Rod názvu hodnoty: 0 = ženský, 1 = mužský, 2 = střední. */
const RANK_GENDER: readonly number[] = [0, 0, 0, 0, 1, 1, 1, 2];
/** Krátký popisek do rohu karty. */
export const RANK_LABEL: readonly string[] = ['7', '8', '9', '10', 'Sp', 'Sv', 'K', 'E'];

/** Např. „srdcová sedma“, „zelený svršek“, „kulové eso“. */
export function cardName(card: number): string {
  const adj = SUIT_ADJ[suitOf(card)]?.[RANK_GENDER[rankOf(card)] ?? 0] ?? '';
  return `${adj} ${RANK_NAME[rankOf(card)] ?? ''}`;
}
