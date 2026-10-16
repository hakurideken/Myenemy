import type { GameView, RenderFrame, ViewContext } from '../../core/MiniGame';
import { h, setText } from '../../ui/dom';
import { MARK_LABEL, outcomeMessage, playerMark, statusLine, turnMessage } from '../shared/board';
import { cellIndex, COLS, dropRow, ROWS, type C4Move, type C4View } from './logic';

export function createC4View(ctx: ViewContext<C4Move>): GameView<C4View> {
  let frame: RenderFrame | null = null;
  let latest: C4View | null = null;
  let animatedLast: number | null = null;

  const status = statusLine();
  /** Pole sloupce shora dolů (vizuálně), indexy desky. */
  const slots: HTMLElement[][] = [];
  const columns = Array.from({ length: COLS }, (_, c) => {
    const column: HTMLElement[] = [];
    for (let row = ROWS - 1; row >= 0; row--) {
      column.push(
        h('span', { class: 'c4-slot', 'data-index': cellIndex(row, c), 'data-owner': '' }),
      );
    }
    slots.push(column);
    return h(
      'button',
      { type: 'button', class: 'c4-column', onclick: () => play(c) },
      h('span', { class: 'c4-key', 'aria-hidden': 'true' }, c + 1),
      column,
    );
  });
  const board = h('div', { class: 'c4-board', role: 'group', 'aria-label': 'Deska 7×6' }, columns);
  const container = h('div', { class: 'board-game c4' }, status, board);
  ctx.root.append(container);

  const active = (): boolean =>
    frame !== null && frame.finished === null && frame.canAct.includes(frame.perspective);

  function play(column: number): void {
    if (!frame || !latest || !active() || dropRow(latest.board, column) < 0) return;
    ctx.sfx.play('click');
    ctx.submit(frame.perspective, { column });
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const match = /^(?:Digit|Numpad)([1-7])$/.exec(event.code);
    if (!match?.[1]) return;
    event.preventDefault();
    play(Number(match[1]) - 1);
  }
  window.addEventListener('keydown', onKey);

  return {
    render(view, f) {
      latest = view;
      frame = f;
      const canPlay = active();
      columns.forEach((button, c) => {
        const free = ROWS - (dropRow(view.board, c) < 0 ? ROWS : dropRow(view.board, c));
        button.disabled = !canPlay || free === 0;
        button.setAttribute(
          'aria-label',
          `Sloupec ${c + 1}: ${free === 0 ? 'plný' : `volných ${free}`}`,
        );
        for (const slot of slots[c] ?? []) {
          const index = Number(slot.dataset.index);
          const owner = view.board[index] ?? null;
          if (slot.dataset.owner !== (owner ?? '')) {
            slot.dataset.owner = owner ?? '';
            slot.replaceChildren(...(owner ? [playerMark(owner)] : []));
            slot.className = owner ? `c4-slot c4-slot--${owner.toLowerCase()}` : 'c4-slot';
          }
          slot.classList.toggle('is-win', view.winLine?.includes(index) ?? false);
          slot.classList.toggle('is-last', view.last === index);
          if (view.last === index && animatedLast !== index && !ctx.prefs.reducedMotion) {
            // Kámen „spadne“ z horního okraje o tolik řad, kolik volných jich nad ním bylo.
            slot.style.setProperty('--drop', String(ROWS - Math.floor(index / COLS)));
            slot.classList.remove('is-dropping');
            void slot.offsetWidth;
            slot.classList.add('is-dropping');
          }
        }
      });
      animatedLast = view.last;
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
