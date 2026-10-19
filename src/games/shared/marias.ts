import { translations } from '../../i18n';

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

/** Čeština: přídavné jméno barvy pro rod ženský / mužský / střední. */
const CS_SUIT_ADJ: readonly (readonly [string, string, string])[] = [
  ['srdcová', 'srdcový', 'srdcové'],
  ['zelená', 'zelený', 'zelené'],
  ['kulová', 'kulový', 'kulové'],
  ['žaludská', 'žaludský', 'žaludské'],
];
const CS_RANK_NAME: readonly string[] = [
  'sedma',
  'osma',
  'devítka',
  'desítka',
  'spodek',
  'svršek',
  'král',
  'eso',
];
/** Čeština: rod názvu hodnoty: 0 = ženský, 1 = mužský, 2 = střední. */
const CS_RANK_GENDER: readonly number[] = [0, 0, 0, 0, 1, 1, 1, 2];

const EN_SUIT_NAME: readonly string[] = ['Hearts', 'Leaves', 'Bells', 'Acorns'];
const EN_RANK_NAME: readonly string[] = [
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Unter',
  'Ober',
  'King',
  'Ace',
];

const t = translations(
  {
    suits: ['srdce', 'listy', 'kule', 'žaludy'] as readonly string[],
    rankLabels: ['7', '8', '9', '10', 'Sp', 'Sv', 'K', 'E'] as readonly string[],
    cardName: (suit: number, rank: number): string =>
      `${CS_SUIT_ADJ[suit]?.[CS_RANK_GENDER[rank] ?? 0] ?? ''} ${CS_RANK_NAME[rank] ?? ''}`,
  },
  {
    suits: EN_SUIT_NAME,
    rankLabels: ['7', '8', '9', '10', 'U', 'O', 'K', 'A'],
    cardName: (suit, rank) => `${EN_RANK_NAME[rank] ?? ''} of ${EN_SUIT_NAME[suit] ?? ''}`,
  },
);

/** Název barvy (např. při volbě barvy svrškem). */
export const SUIT_NAME: readonly string[] = t.suits;
/** Krátký popisek do rohu karty. */
export const RANK_LABEL: readonly string[] = t.rankLabels;

/** Např. „srdcová sedma“, „zelený svršek“, „kulové eso“ (anglicky „Seven of Hearts“). */
export function cardName(card: number): string {
  return t.cardName(suitOf(card), rankOf(card));
}
