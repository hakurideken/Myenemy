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
