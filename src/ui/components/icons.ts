import { svg } from '../dom';

const decorative = { 'aria-hidden': 'true', focusable: 'false' };

export function swordsIcon(): SVGSVGElement {
  return svg(
    'svg',
    { ...decorative, viewBox: '0 0 64 64', class: 'icon-swords' },
    svg(
      'g',
      { fill: 'none', 'stroke-linecap': 'round', 'stroke-width': '5' },
      svg('path', { d: 'M12 12 42 42M37 49l12-12M44 44l7 7', stroke: 'var(--a)' }),
      svg('path', { d: 'M52 12 22 42M27 49 15 37M20 44l-7 7', stroke: 'var(--b)' }),
    ),
  );
}

export function trophyIcon(): SVGSVGElement {
  return svg(
    'svg',
    { ...decorative, viewBox: '0 0 64 64', class: 'icon-trophy' },
    svg('path', {
      d: 'M18 12H9v4a9 9 0 0 0 9 9M46 12h9v4a9 9 0 0 1-9 9',
      fill: 'none',
      stroke: 'var(--gold)',
      'stroke-width': '4',
    }),
    svg('path', { d: 'M18 8h28v14a14 14 0 0 1-28 0Z', fill: 'var(--gold)' }),
    svg('path', { d: 'M28 35h8v10h-8ZM20 47h24v9H20Z', fill: 'var(--gold)' }),
  );
}
