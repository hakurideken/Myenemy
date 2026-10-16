import type { GameView, RenderFrame, ViewContext } from '../../core/MiniGame';
import type { PlayerSlot } from '../../core/types';
import { h, setText } from '../../ui/dom';
import { outcomeMessage, playerMark, statusLine, turnMessage } from '../shared/board';
import { boxIndex, DOTS, hLine, vLine, type DotsMove, type DotsView } from './logic';

export function createDotsView(ctx: ViewContext<DotsMove>): GameView<DotsView> {
  let frame: RenderFrame | null = null;
  let latest: DotsView | null = null;

  const status = statusLine();
  const lineButtons = new Map<number, HTMLButtonElement>();
  const boxCells = new Map<number, HTMLElement>();
  const grid = h('div', { class: 'dots-grid', role: 'group', 'aria-label': 'Hrací pole 4×4' });

  // Mřížka 9×9: tečky na sudých/sudých, čáry mezi nimi, políčka na lichých/lichých.
  for (let r = 0; r < 2 * DOTS - 1; r++) {
    for (let c = 0; c < 2 * DOTS - 1; c++) {
      if (r % 2 === 0 && c % 2 === 0) {
        grid.append(h('span', { class: 'dots-dot', 'aria-hidden': 'true' }));
      } else if (r % 2 === 1 && c % 2 === 1) {
        const b = boxIndex((r - 1) / 2, (c - 1) / 2);
        const cell = h('span', { class: 'dots-box', 'data-owner': '' });
        boxCells.set(b, cell);
        grid.append(cell);
      } else {
        const horizontal = r % 2 === 0;
        const line = horizontal ? hLine(r / 2, (c - 1) / 2) : vLine((r - 1) / 2, c / 2);
        const label = horizontal
          ? `Vodorovná čára, řada teček ${r / 2 + 1}, mezi tečkami ${(c - 1) / 2 + 1} a ${(c + 1) / 2 + 1}`
          : `Svislá čára, sloupec teček ${c / 2 + 1}, mezi řadami ${(r - 1) / 2 + 1} a ${(r + 1) / 2 + 1}`;
        const button = h('button', {
          type: 'button',
          class: `dots-line dots-line--${horizontal ? 'h' : 'v'}`,
          'aria-label': label,
          onclick: () => play(line),
        });
        lineButtons.set(line, button);
        grid.append(button);
      }
    }
  }

  const scoreChip = (p: PlayerSlot): HTMLElement => {
    const value = h('span', { class: 'dots-score-value' });
    return h(
      'span',
      { class: `dots-score dots-score--${p.toLowerCase()}`, 'data-player': p },
      playerMark(p),
      h('span', null, ctx.names[p]),
      value,
    );
  };
  const scores = { A: scoreChip('A'), B: scoreChip('B') };
  const scoreRow = h('div', { class: 'dots-scores' }, scores.A, scores.B);
  const container = h('div', { class: 'board-game dots' }, status, scoreRow, grid);
  ctx.root.append(container);

  const active = (): boolean =>
    frame !== null && frame.finished === null && frame.canAct.includes(frame.perspective);

  function play(line: number): void {
    if (!frame || !latest || !active() || latest.lines[line] !== null) return;
    ctx.sfx.play('click');
    ctx.submit(frame.perspective, { line });
  }

  return {
    render(view, f) {
      latest = view;
      frame = f;
      const canPlay = active();
      for (const [line, button] of lineButtons) {
        const owner = view.lines[line] ?? null;
        button.disabled = owner !== null || !canPlay;
        button.classList.toggle('is-drawn', owner !== null);
        button.classList.toggle('is-last', view.last === line);
        if (owner) button.dataset.owner = owner;
        else delete button.dataset.owner;
      }
      for (const [b, cell] of boxCells) {
        const owner = view.boxes[b] ?? null;
        if (cell.dataset.owner !== (owner ?? '')) {
          cell.dataset.owner = owner ?? '';
          cell.replaceChildren(...(owner ? [playerMark(owner)] : []));
          cell.setAttribute(
            'aria-label',
            owner ? `Políčko: ${ctx.names[owner]}` : 'Políčko: volné',
          );
        }
      }
      for (const p of ['A', 'B'] as const) {
        setText(scores[p].lastElementChild ?? scores[p], String(view.score[p]));
        scores[p].classList.toggle('is-turn', f.finished === null && view.turn === p);
      }
      grid.classList.toggle('is-active', canPlay);
      // Hráč, který nakreslil poslední čáru a je zase na tahu, právě uzavřel políčko.
      const bonus = view.last !== null && view.lines[view.last] === view.turn;
      setText(
        status,
        f.finished
          ? outcomeMessage(ctx, f.finished)
          : `${bonus ? `${ctx.names[view.turn]} uzavřel(a) políčko a hraje znovu. ` : ''}${turnMessage(ctx, view.turn, f)}`,
      );
    },
    destroy() {
      container.remove();
    },
  };
}
