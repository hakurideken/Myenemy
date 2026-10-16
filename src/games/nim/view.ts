import type { GameView, RenderFrame, ViewContext } from '../../core/MiniGame';
import { h, setText, svg } from '../../ui/dom';
import { plural } from '../../ui/labels';
import { outcomeMessage, statusLine, turnMessage } from '../shared/board';
import { MAX_START, MAX_TAKE, type NimMove, type NimView } from './logic';

function matchIcon(): SVGSVGElement {
  return svg(
    'svg',
    { viewBox: '0 0 20 100', class: 'nim-match-icon', 'aria-hidden': 'true', focusable: 'false' },
    svg('rect', { class: 'nim-stick', x: '7.5', y: '16', width: '5', height: '80', rx: '2' }),
    svg('ellipse', { class: 'nim-head', cx: '10', cy: '12', rx: '6.5', ry: '9.5' }),
  );
}

const matchesWord = (n: number): string => plural(n, 'sirka', 'sirky', 'sirek');

export function createNimView(ctx: ViewContext<NimMove>): GameView<NimView> {
  let frame: RenderFrame | null = null;
  let latest: NimView | null = null;
  let preview = 0;

  const status = statusLine();
  const count = h('p', { class: 'nim-count' });
  const last = h('p', { class: 'nim-last', 'aria-live': 'polite' });
  const matches = Array.from({ length: MAX_START }, () =>
    h('span', { class: 'nim-match' }, matchIcon()),
  );
  const row = h('div', { class: 'nim-row', 'aria-hidden': 'true' }, matches);
  const buttons = Array.from({ length: MAX_TAKE }, (_, i) => {
    const take = i + 1;
    return h(
      'button',
      {
        type: 'button',
        class: 'btn btn-lg nim-take',
        onclick: () => play(take),
        onmouseenter: () => setPreview(take),
        onmouseleave: () => setPreview(0),
        onfocus: () => setPreview(take),
        onblur: () => setPreview(0),
      },
      `Vzít ${take}`,
      h('kbd', null, take),
    );
  });
  const controls = h(
    'div',
    { class: 'nim-controls', role: 'group', 'aria-label': 'Kolik sirek vzít' },
    buttons,
  );
  const container = h('div', { class: 'board-game nim' }, status, count, row, last, controls);
  ctx.root.append(container);

  const active = (): boolean =>
    frame !== null && frame.finished === null && frame.canAct.includes(frame.perspective);

  function play(take: number): void {
    if (!frame || !latest || !active() || take > latest.remaining) return;
    ctx.sfx.play('click');
    setPreview(0);
    ctx.submit(frame.perspective, { take });
  }

  function setPreview(take: number): void {
    preview = active() ? take : 0;
    paintMatches();
  }

  function paintMatches(): void {
    if (!latest) return;
    const { initial, remaining } = latest;
    matches.forEach((match, i) => {
      match.hidden = i >= initial;
      match.classList.toggle('is-taken', i >= remaining);
      match.classList.toggle('is-preview', i < remaining && i >= remaining - preview);
    });
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const match = /^(?:Digit|Numpad)([1-3])$/.exec(event.code);
    if (!match?.[1]) return;
    event.preventDefault();
    play(Number(match[1]));
  }
  window.addEventListener('keydown', onKey);

  return {
    render(view, f) {
      latest = view;
      frame = f;
      const canPlay = active();
      if (!canPlay) preview = 0;
      paintMatches();
      setText(count, `Zbývá ${view.remaining} ${matchesWord(view.remaining)}`);
      setText(
        last,
        view.lastTake
          ? `${ctx.names[view.lastTake.player]} vzal(a) ${view.lastTake.take} ${matchesWord(view.lastTake.take)}.`
          : `Na stole je ${view.initial} ${matchesWord(view.initial)}. Kdo vezme poslední, prohrává.`,
      );
      buttons.forEach((button, i) => {
        button.disabled = !canPlay || i + 1 > view.remaining;
      });
      setText(
        status,
        f.finished
          ? `${outcomeMessage(ctx, f.finished)} – ${view.loser ? ctx.names[view.loser] : ''} vzal(a) poslední sirku.`
          : turnMessage(ctx, view.turn, f),
      );
    },
    destroy() {
      window.removeEventListener('keydown', onKey);
      container.remove();
    },
  };
}
