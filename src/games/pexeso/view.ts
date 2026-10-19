import type { GameView, RenderFrame, ViewContext } from '../../core/MiniGame';
import { h, setText, svg } from '../../ui/dom';
import { outcomeMessage, turnMessage } from '../shared/board';
import { cardBack } from '../shared/cardView';
import { CARDS, COLS, pairOf, ROWS, seenCard, type PexesoMove, type PexesoView } from './logic';

/** Obrázky dvojic: každý má vlastní tvar i barvu (rozliší je i barvoslepý hráč). */
export const PICTURE_NAMES: readonly string[] = [
  'slunce',
  'měsíc',
  'hvězda',
  'srdce',
  'list',
  'kapka',
  'blesk',
  'koruna',
  'kotva',
  'klíč',
  'zvonek',
  'ryba',
  'houba',
  'jablko',
  'mrak',
];

type Shape = { readonly d: string; readonly stroke?: boolean };

const PICTURES: readonly (readonly Shape[])[] = [
  [
    { d: 'M0-7A7 7 0 1 1 0 7A7 7 0 1 1 0-7Z' },
    {
      d: 'M0-16V-11M0 11V16M-16 0H-11M11 0H16M-11-11L-8-8M8 8L11 11M-11 11L-8 8M8-8L11-11',
      stroke: true,
    },
  ],
  [{ d: 'M5-13A13 13 0 1 0 5 13A10 10 0 1 1 5-13Z' }],
  [{ d: 'M0-14L4-4L14-4L6 2L9 13L0 6L-9 13L-6 2L-14-4L-4-4Z' }],
  [{ d: 'M0 12C-17 1-11-14 0-6C11-14 17 1 0 12Z' }],
  [{ d: 'M-11 11C-13-6 0-14 12-12C13 1 3 13-11 11Z' }, { d: 'M-11 11L6-5', stroke: true }],
  [{ d: 'M0-14C6-5 10 0 10 5A10 10 0 0 1-10 5C-10 0-6-5 0-14Z' }],
  [{ d: 'M3-15L-9 2H-1L-4 15L9-3H1Z' }],
  [{ d: 'M-13 8L-14-7L-6 0L0-11L6 0L14-7L13 8Z' }, { d: 'M-13 12H13', stroke: true }],
  [
    { d: 'M0-9V12M-7-4H7M-11 4C-10 10-5 12 0 12C5 12 10 10 11 4', stroke: true },
    { d: 'M0-15A3 3 0 1 1 0-9A3 3 0 1 1 0-15Z', stroke: true },
  ],
  [{ d: 'M-6-5A5 5 0 1 1-6 5A5 5 0 1 1-6-5ZM-1 0H14M9 0V5M13 0V4', stroke: true }],
  [{ d: 'M-10 7C-9-6-6-11 0-11C6-11 9-6 10 7Z' }, { d: 'M-13 8H13M0 8V12', stroke: true }],
  [{ d: 'M-12 0C-6-8 6-8 10 0C6 8-6 8-12 0ZM10 0L15-6V6Z' }],
  [{ d: 'M-13 1C-13-10 13-10 13 1ZM-4 1H4L5 12H-5Z' }],
  [
    { d: 'M0-5C6-11 14-5 12 4C10 12 4 14 0 11C-4 14-10 12-12 4C-14-5-6-11 0-5Z' },
    { d: 'M0-5C0-9 2-12 4-14', stroke: true },
  ],
  [{ d: 'M-12 9A6 6 0 0 1-11-3A8 8 0 0 1 4-7A7 7 0 0 1 13 2A5 5 0 0 1 12 9Z' }],
];

export function pictureIcon(pair: number): SVGSVGElement {
  return svg(
    'svg',
    {
      viewBox: '-20 -20 40 40',
      class: `pex-picture pex-${pair}`,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    (PICTURES[pair] ?? []).map((shape) =>
      svg('path', { d: shape.d, class: shape.stroke ? 'pex-stroke' : 'pex-fill' }),
    ),
  );
}

export function createPexesoView(ctx: ViewContext<PexesoMove>): GameView<PexesoView> {
  let frame: RenderFrame | null = null;
  let latest: PexesoView | null = null;

  const status = h('p', { class: 'board-status', 'aria-live': 'polite' });
  const scoreChip = (p: 'A' | 'B'): HTMLElement =>
    h(
      'span',
      { class: `pex-score pex-score--${p.toLowerCase()}` },
      h('span', null, ctx.names[p]),
      h('strong', { class: 'pex-score-value' }, '0'),
    );
  const scores = { A: scoreChip('A'), B: scoreChip('B') };
  const cells = Array.from({ length: CARDS }, (_, p) =>
    h('button', { type: 'button', class: 'pex-card', 'data-state': '', onclick: () => flip(p) }),
  );
  const grid = h(
    'div',
    { class: 'pex-grid', role: 'group', 'aria-label': `Pexeso ${ROWS}×${COLS}` },
    cells,
  );
  const container = h(
    'div',
    { class: 'board-game pex' },
    status,
    h('div', { class: 'pex-scores' }, scores.A, scores.B),
    grid,
  );
  ctx.root.append(container);

  const active = (): boolean =>
    frame !== null &&
    frame.cards !== null &&
    frame.finished === null &&
    frame.canAct.includes(frame.perspective);

  function flip(p: number): void {
    if (!frame || !latest || !active()) return;
    if (latest.taken[p] !== null || latest.flipped.includes(p)) return;
    ctx.sfx.play('click');
    ctx.submit(frame.perspective, { kind: 'flip', pos: p });
  }

  return {
    render(view, f) {
      latest = view;
      frame = f;
      const canFlip = active();
      // Karty z posledního tahu zůstanou vidět, dokud někdo neotočí další.
      const peek: readonly number[] =
        view.flipped.length === 0 && view.last ? view.last.positions : [];
      cells.forEach((cell, p) => {
        const card = seenCard(view, p);
        const owner = view.taken[p] ?? null;
        const faceUp = card !== undefined && (view.flipped.includes(p) || peek.includes(p));
        const state = owner ? `taken-${owner}` : faceUp ? 'up' : 'down';
        const key = `${state}:${card ?? ''}`;
        if (cell.dataset.state !== key) {
          cell.dataset.state = key;
          cell.replaceChildren(owner || faceUp ? pictureIcon(pairOf(card ?? 0)) : cardBack());
          cell.classList.toggle('is-taken', owner !== null);
          cell.classList.toggle('is-up', faceUp);
        }
        const row = Math.floor(p / COLS) + 1;
        const col = (p % COLS) + 1;
        const what = owner
          ? `sebral(a) ${ctx.names[owner]}`
          : faceUp
            ? (PICTURE_NAMES[pairOf(card ?? 0)] ?? '')
            : 'otočená lícem dolů';
        cell.setAttribute('aria-label', `Řada ${row}, pozice ${col}: ${what}`);
        cell.disabled = owner !== null || !canFlip || view.flipped.includes(p);
        cell.classList.toggle('is-match', !!view.last?.match && peek.includes(p));
      });
      grid.classList.toggle('is-active', canFlip);
      for (const p of ['A', 'B'] as const) {
        setText(scores[p].lastElementChild ?? scores[p], String(view.score[p]));
        scores[p].classList.toggle('is-turn', f.finished === null && view.turn === p);
      }
      let text: string;
      if (f.cards === null) text = 'Míchám kartičky…';
      else if (f.finished) text = outcomeMessage(ctx, f.finished);
      else {
        const last = view.last;
        const prefix =
          view.flipped.length === 0 && last
            ? last.match
              ? `${ctx.names[last.player]} našel(a) dvojici! `
              : 'Není to dvojice. '
            : '';
        text = `${prefix}${turnMessage(ctx, view.turn, f)}`;
      }
      setText(status, text);
    },
    destroy() {
      container.remove();
    },
  };
}
