import { svg } from '../../ui/dom';
import type { RpsChoice } from './logic';

const base = { viewBox: '0 0 64 64', 'aria-hidden': 'true', focusable: 'false', class: 'rps-icon' };

function rock(): SVGSVGElement {
  return svg(
    'svg',
    base,
    svg('path', {
      class: 'ico-fill',
      d: 'M12 42 9 30l9-13 16-5 15 7 6 14-5 14-16 6-15-2Z',
    }),
    svg('path', { class: 'ico-line', d: 'M22 26l8 5 3 10M41 22l2 9-6 6' }),
  );
}

function scissors(): SVGSVGElement {
  return svg(
    'svg',
    base,
    svg('path', { class: 'ico-blade', d: 'M26 40 47 7M38 40 17 7' }),
    svg('circle', { class: 'ico-ring', cx: '20', cy: '48', r: '7' }),
    svg('circle', { class: 'ico-ring', cx: '44', cy: '48', r: '7' }),
    svg('circle', { class: 'ico-pin', cx: '32', cy: '28', r: '2.5' }),
  );
}

function paper(): SVGSVGElement {
  return svg(
    'svg',
    base,
    svg('path', { class: 'ico-fill', d: 'M15 7h24l11 11v39H15Z' }),
    svg('path', { class: 'ico-line', d: 'M39 7v11h11M22 30h21M22 38h21M22 46h14' }),
  );
}

export function rpsIcon(choice: RpsChoice): SVGSVGElement {
  switch (choice) {
    case 'rock':
      return rock();
    case 'scissors':
      return scissors();
    case 'paper':
      return paper();
  }
}
