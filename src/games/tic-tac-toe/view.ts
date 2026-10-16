import type { GameView, RenderFrame, ViewContext } from '../../core/MiniGame';
import { h, setText } from '../../ui/dom';
import { MARK_LABEL, outcomeMessage, playerMark, statusLine, turnMessage } from '../shared/board';
import type { TttMove, TttView } from './logic';

/** Klávesy 1–9 = pole zleva doprava, shora dolů. */
function cellForKey(code: string): number | null {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return match?.[1] ? Number(match[1]) - 1 : null;
}

export function createTttView(ctx: ViewContext<TttMove>): GameView<TttView> {
  let frame: RenderFrame | null = null;
  let latest: TttView | null = null;

  const status = statusLine();
  const cells = Array.from({ length: 9 }, (_, i) =>
    // „?“ = ještě nevykresleno, aby první render doplnil nápovědu i do prázdných polí.
    h('button', { type: 'button', class: 'ttt-cell', 'data-owner': '?', onclick: () => play(i) }),
  );
  const board = h(
    'div',
    { class: 'ttt-board', role: 'group', 'aria-label': 'Hrací deska 3×3' },
    cells,
  );
  const container = h('div', { class: 'board-game ttt' }, status, board);
  ctx.root.append(container);

  const active = (): boolean =>
    frame !== null && frame.finished === null && frame.canAct.includes(frame.perspective);

  function play(cell: number): void {
    if (!frame || !latest || !active() || latest.cells[cell] !== null) return;
    ctx.sfx.play('click');
    ctx.submit(frame.perspective, { cell });
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const cell = cellForKey(event.code);
    if (cell === null) return;
    event.preventDefault();
    play(cell);
  }
  window.addEventListener('keydown', onKey);

  return {
    render(view, f) {
      latest = view;
      frame = f;
      const canPlay = active();
      view.cells.forEach((owner, i) => {
        const button = cells[i];
        if (!button) return;
        if (button.dataset.owner !== (owner ?? '')) {
          button.dataset.owner = owner ?? '';
          button.replaceChildren(
            owner ? playerMark(owner) : h('span', { class: 'cell-hint' }, i + 1),
          );
        }
        const row = Math.floor(i / 3) + 1;
        const col = (i % 3) + 1;
        button.setAttribute(
          'aria-label',
          `Řádek ${row}, sloupec ${col}: ${owner ? `${MARK_LABEL[owner]} (${ctx.names[owner]})` : 'prázdné'}`,
        );
        button.disabled = owner !== null || !canPlay;
        button.classList.toggle('is-win', view.winLine?.includes(i) ?? false);
        button.classList.toggle('is-last', view.last === i);
      });
      board.classList.toggle('is-active', canPlay);
      setText(
        status,
        f.finished
          ? outcomeMessage(ctx, f.finished)
          : `${turnMessage(ctx, view.turn, f)} · ${MARK_LABEL[view.turn]}`,
      );
    },
    destroy() {
      window.removeEventListener('keydown', onKey);
      container.remove();
    },
  };
}
