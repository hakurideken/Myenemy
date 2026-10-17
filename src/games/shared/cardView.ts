import { h, svg } from '../../ui/dom';
import { cardName, RANK, RANK_LABEL, rankOf, SUIT_NAME, suitOf } from './marias';

/** Symboly barev (vlastní kresba, střed v 0,0, velikost asi 24 jednotek). */
const SUIT_SHAPES: readonly ((cls: string) => SVGElement[])[] = [
  // srdce
  (cls) => [svg('path', { class: cls, d: 'M0 10C-15 0-10-13 0-5C10-13 15 0 0 10Z' })],
  // listy (zelené)
  (cls) => [
    svg('path', { class: cls, d: 'M0-12C10-6 10 6 0 12C-10 6-10-6 0-12Z' }),
    svg('path', { class: 'suit-vein', d: 'M0-9V14M0-2L5-6M0 3L-5-1' }),
  ],
  // kule
  (cls) => [
    svg('circle', { class: cls, r: '9.5' }),
    svg('circle', { class: 'suit-vein', r: '5' }),
    svg('path', { class: 'suit-vein', d: 'M-9.5 0H9.5' }),
  ],
  // žaludy
  (cls) => [
    svg('path', { class: cls, d: 'M-6-1C-6 8 0 12 0 12C0 12 6 8 6-1Z' }),
    svg('path', { class: `${cls} suit-cap`, d: 'M-8-1C-8-9 8-9 8-1Z' }),
    svg('path', { class: 'suit-vein', d: 'M0-8V-12' }),
  ],
];

const suitShape = (suit: number, cls = 'suit-fill'): SVGElement[] => SUIT_SHAPES[suit]?.(cls) ?? [];

/** Samostatná ikona barvy (např. pro volbu barvy svrškem). */
export function suitIcon(suit: number): SVGSVGElement {
  return svg(
    'svg',
    {
      viewBox: '-14 -14 28 28',
      class: `suit-icon suit-${suit}`,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    suitShape(suit),
  );
}

function corner(card: number, flip: boolean): SVGGElement {
  return svg(
    'g',
    { transform: flip ? 'rotate(180 30 45)' : '' },
    svg('text', { x: '7', y: '14', class: 'card-rank', 'text-anchor': 'middle' }, [
      RANK_LABEL[rankOf(card)] ?? '',
    ]),
    svg('g', { transform: 'translate(7 22) scale(0.32)' }, suitShape(suitOf(card))),
  );
}

/** Ozdoba figury: koruna (král), péro (svršek), pruh (spodek). */
function figureMark(rank: number): SVGElement | null {
  if (rank === RANK.KRAL) {
    return svg('path', { class: 'card-figure', d: 'M20 30L22 22L26 27L30 20L34 27L38 22L40 30Z' });
  }
  if (rank === RANK.SVRSEK) {
    return svg('path', { class: 'card-figure', d: 'M24 29C28 19 36 19 37 23C33 22 29 24 27 29Z' });
  }
  if (rank === RANK.SPODEK) {
    return svg('rect', {
      class: 'card-figure',
      x: '21',
      y: '62',
      width: '18',
      height: '4',
      rx: '2',
    });
  }
  return null;
}

/** Líc karty (60 × 90). */
export function cardFace(card: number): SVGSVGElement {
  const suit = suitOf(card);
  const rank = rankOf(card);
  const figure = figureMark(rank);
  return svg(
    'svg',
    {
      viewBox: '0 0 60 90',
      class: `card-svg suit-${suit}`,
      role: 'img',
      'aria-label': cardName(card),
    },
    svg('rect', { class: 'card-paper', x: '1', y: '1', width: '58', height: '88', rx: '6' }),
    corner(card, false),
    corner(card, true),
    rank === RANK.ESO
      ? svg('circle', { class: 'card-ace-ring', cx: '30', cy: '45', r: '16' })
      : null,
    figure,
    svg(
      'g',
      { transform: `translate(30 45) scale(${rank === RANK.ESO ? 1.05 : 0.9})` },
      suitShape(suit),
    ),
  );
}

/** Rub karty. */
export function cardBack(): SVGSVGElement {
  const dots: SVGElement[] = [];
  for (let y = 12; y <= 78; y += 8) {
    for (let x = 12 + ((y / 8) % 2) * 4; x <= 48; x += 8) {
      dots.push(svg('path', { class: 'card-back-dot', d: `M${x} ${y - 2}l2 2l-2 2l-2-2Z` }));
    }
  }
  return svg(
    'svg',
    {
      viewBox: '0 0 60 90',
      class: 'card-svg card-svg--back',
      role: 'img',
      'aria-label': 'karta lícem dolů',
    },
    svg('rect', { class: 'card-back', x: '1', y: '1', width: '58', height: '88', rx: '6' }),
    svg('rect', { class: 'card-back-frame', x: '6', y: '6', width: '48', height: '78', rx: '4' }),
    dots,
  );
}

/** Karta jako prvek stránky: líc, nebo rub (null = karta, kterou neznám). */
export function cardNode(card: number | null, extra = ''): HTMLElement {
  const cls = ['pcard', card === null ? 'pcard--back' : 'pcard--face', extra]
    .filter(Boolean)
    .join(' ');
  return h('div', { class: cls }, card === null ? cardBack() : cardFace(card));
}

export const suitName = (suit: number): string => SUIT_NAME[suit] ?? '';
