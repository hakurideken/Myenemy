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

export function gearIcon(): SVGSVGElement {
  return svg(
    'svg',
    { ...decorative, viewBox: '0 0 24 24', class: 'icon-small' },
    svg('path', {
      d: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.4 5-.1-3 2-1.6-2-3.4-2.4.9a8 8 0 0 0-2.6-1.5L14.9 2h-4l-.4 2.9A8 8 0 0 0 8 6.4l-2.4-.9-2 3.4 2 1.6-.1 3 .1 0-2 1.6 2 3.4 2.4-.9a8 8 0 0 0 2.6 1.5l.4 2.9h4l.4-2.9a8 8 0 0 0 2.6-1.5l2.4.9 2-3.4Z',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.8',
      'stroke-linejoin': 'round',
    }),
  );
}

export function userIcon(): SVGSVGElement {
  return svg(
    'svg',
    { ...decorative, viewBox: '0 0 24 24', class: 'icon-small' },
    svg('circle', {
      cx: '12',
      cy: '8',
      r: '4',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
    }),
    svg('path', {
      d: 'M4 21a8 8 0 0 1 16 0',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
    }),
  );
}
