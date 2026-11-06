import type { PlayerSlot } from '../../core/types';
import { svg } from '../dom';

/**
 * Scény na konec zápasu (čistě dekorativní, pro čtečku skryté). Pohyb dělá CSS –
 * poslední snímek každé animace je zároveň klidový obrázek pro „Omezit animace“.
 */

const W = 320;
const H = 180;
const GROUND = 160;

type Child = SVGElement | null;

const g = (attrs: Record<string, string> | null, ...children: Child[]): SVGGElement =>
  svg('g', attrs, ...children);
const line = (x1: number, y1: number, x2: number, y2: number, cls = ''): SVGLineElement =>
  svg('line', {
    x1: String(x1),
    y1: String(y1),
    x2: String(x2),
    y2: String(y2),
    ...(cls && { class: cls }),
  });

/** Zpoždění a podobné parametry jako CSS proměnné (CSP zakazuje inline style atributy). */
function vars<T extends SVGElement>(el: T, values: Record<string, string>): T {
  for (const [key, value] of Object.entries(values)) el.style.setProperty(key, value);
  return el;
}

interface FigureParts {
  /** Hlava (s obličejem) – výchozí pozice kolem [0, -42]. */
  readonly head?: SVGElement;
  /** Levá a pravá paže: čára dolů z ramene, otáčí se kolem ramene. */
  readonly armL?: SVGElement;
  readonly armR?: SVGElement;
  readonly extra?: SVGElement[];
}

/** Dvě oči kolem středu hlavy [x, y]. */
function eyes(x: number, y: number): SVGCircleElement[] {
  return [-2.4, 2.4].map((dx) =>
    svg('circle', { class: 'pd-eye', cx: String(x + dx), cy: String(y), r: '1.1' }),
  );
}

/** Panďulák s nohama v [0, 0]; paže a nohy se otáčí kolem kloubu (počátek skupiny). */
function figure(cls: string, parts: FigureParts = {}): SVGGElement {
  return g(
    { class: `pd ${cls}` },
    g(
      { transform: 'translate(0 -18)' },
      g({ class: 'pd-leg pd-leg--l' }, line(0, 0, 0, 18)),
      g({ class: 'pd-leg pd-leg--r' }, line(0, 0, 0, 18)),
    ),
    line(0, -18, 0, -34, 'pd-body'),
    g(
      { transform: 'translate(0 -33)' },
      parts.armL ?? g({ class: 'pd-arm pd-arm--l' }, line(0, 0, 0, 15)),
      parts.armR ?? g({ class: 'pd-arm pd-arm--r' }, line(0, 0, 0, 15)),
    ),
    parts.head ??
      g(null, svg('circle', { class: 'pd-head', cx: '0', cy: '-42', r: '7' }), ...eyes(0, -43.6)),
    ...(parts.extra ?? []),
  );
}

/** Trofej (stejný tvar jako ikona), spodek na zemi uprostřed scény. */
function trophy(cls: string): SVGGElement {
  return g(
    {
      class: `cel-trophy ${cls}`,
      transform: `translate(${W / 2 - 41.6} ${GROUND - 83}) scale(1.3)`,
    },
    svg('path', {
      class: 'cel-trophy-handles',
      d: 'M18 12H9v4a9 9 0 0 0 9 9M46 12h9v4a9 9 0 0 1-9 9',
    }),
    svg('path', { class: 'cel-trophy-cup', d: 'M18 8h28v14a14 14 0 0 1-28 0Z' }),
    svg('path', { class: 'cel-trophy-cup', d: 'M28 35h8v10h-8ZM20 47h24v9H20Z' }),
  );
}

function crown(): SVGGElement {
  // Spodek koruny je v počátku – po přistání sedí na okraji poháru.
  return g(
    { class: 'cel-crown' },
    svg('path', { class: 'cel-crown-body', d: 'M-12 0V-13L-6 -6 0 -16 6 -6 12 -13V0Z' }),
    svg('circle', { class: 'cel-crown-gem', cx: '0', cy: '-4', r: '2' }),
  );
}

/** Výbuch ohňostroje: raketa vyletí ze země, pak se rozprskne. */
function firework(x: number, y: number, delay: number, color: string): SVGGElement {
  const sparks: SVGElement[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = (Math.PI * 2 * i) / 12;
    const r1 = 5;
    const r2 = 17 + (i % 2) * 4;
    sparks.push(
      line(
        Math.round(Math.cos(angle) * r1 * 10) / 10,
        Math.round(Math.sin(angle) * r1 * 10) / 10,
        Math.round(Math.cos(angle) * r2 * 10) / 10,
        Math.round(Math.sin(angle) * r2 * 10) / 10,
      ),
    );
  }
  return vars(
    g(
      { class: `cel-fw cel-fw--${color}`, transform: `translate(${x} ${y})` },
      g({ class: 'cel-fw-rocket' }, svg('circle', { cx: '0', cy: '0', r: '1.6' })),
      g({ class: 'cel-fw-burst' }, ...sparks),
    ),
    { '--d': `${delay}s`, '--rise': `${GROUND - y}px` },
  );
}

const FIREWORKS: readonly [number, number, number, string][] = [
  [60, 45, 0.2, 'gold'],
  [250, 38, 0.7, 'a'],
  [110, 28, 1.2, 'b'],
  [205, 60, 1.7, 'white'],
  [40, 70, 2.4, 'b'],
  [280, 75, 2.9, 'gold'],
  [160, 22, 3.6, 'a'],
  [90, 55, 4.3, 'white'],
];

/** Výhra: ohňostroj a panďulák v barvě vítěze přinese korunu na trofej. */
export function victoryScene(winner: PlayerSlot): SVGSVGElement {
  const bearer = figure(`pd--bearer pd--${winner.toLowerCase()}`, {
    extra: [g({ class: 'pd-smile' }, svg('path', { d: 'M-3.5 -41a4 4 0 0 0 7 0' }))],
  });
  return svg(
    'svg',
    {
      class: 'celebration celebration--win',
      viewBox: `0 0 ${W} ${H}`,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    ...FIREWORKS.map(([x, y, d, c]) => firework(x, y, d, c)),
    line(10, GROUND, W - 10, GROUND, 'cel-ground'),
    trophy('is-won'),
    g({ class: 'cel-crown-path' }, crown()),
    g({ class: 'cel-bearer-path' }, bearer),
  );
}

/** Uplakaný panďulák: hlava skloněná, ruce svěšené, slzy kapou. */
function crier(x: number, delay: number): SVGGElement {
  const tears = [-1, 5].map((dx, i) =>
    vars(svg('circle', { class: 'pd-tear', cx: String(dx), cy: '-40', r: '1.4' }), {
      '--t': `${delay + i * 0.45}s`,
    }),
  );
  return g(
    { transform: `translate(${x} ${GROUND})` },
    vars(
      figure('pd--crier', {
        head: g(
          { class: 'pd-sad' },
          svg('circle', { class: 'pd-head', cx: '2', cy: '-40', r: '7' }),
          ...eyes(2, -41.6),
          // Smutně zvednutá obočí.
          line(-2, -45.5, 0.8, -44.4, 'pd-brow'),
          line(6, -45.5, 3.2, -44.4, 'pd-brow'),
          svg('path', { class: 'pd-frown', d: 'M-1 -35a4 4 0 0 1 6 0' }),
          line(-1, -41, -1.5, -37, 'pd-streak'),
          line(5, -41, 5.5, -37, 'pd-streak'),
        ),
        armL: g({ class: 'pd-arm pd-arm--cry-l' }, line(0, 0, 0, 14)),
        armR: g({ class: 'pd-arm pd-arm--cry-r' }, line(0, 0, 0, 14)),
        extra: tears,
      }),
      { '--d': `${delay}s` },
    ),
  );
}

/** Posměváček: chodí sem a tam, zastaví se a ukáže prostředníček. */
function taunter(winner: PlayerSlot, reverse: boolean): SVGGElement {
  const gesture = g(
    { class: 'pd-gesture' },
    line(0, 0, 13, -7),
    svg('rect', { class: 'pd-fist', x: '11', y: '-11', width: '6.5', height: '5.5', rx: '1.5' }),
    line(14.2, -11, 14.2, -19.5, 'pd-finger'),
  );
  return g(
    { class: `cel-taunt-path${reverse ? ' is-reverse' : ''}` },
    g(
      { class: 'cel-taunt-face' },
      figure(`pd--taunter pd--${winner.toLowerCase()}`, {
        armR: g({ class: 'pd-arm pd-arm--r pd-arm--walk' }, line(0, 0, 0, 15)),
        extra: [
          g({ class: 'pd-gesture-arm', transform: 'translate(0 -33)' }, gesture),
          g({ class: 'pd-smile' }, svg('path', { d: 'M-3.5 -41a4 4 0 0 0 7 0' })),
        ],
      }),
    ),
  );
}

/** Prohra: vybledlá trofej, tři panďuláci brečí a dva soupeřovi se posmívají. */
export function defeatScene(winner: PlayerSlot): SVGSVGElement {
  return svg(
    'svg',
    {
      class: 'celebration celebration--lose',
      viewBox: `0 0 ${W} ${H}`,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    line(10, GROUND, W - 10, GROUND, 'cel-ground'),
    trophy('is-lost'),
    crier(34, 0),
    crier(72, 0.3),
    crier(284, 0.15),
    taunter(winner, false),
    taunter(winner, true),
  );
}
