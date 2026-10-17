import type { GameView, RenderFrame, ViewContext } from '../../core/MiniGame';
import { otherPlayer, type PlayerSlot } from '../../core/types';
import { h, setText } from '../../ui/dom';
import { cardNode } from '../shared/cardView';
import { outcomeMessage } from '../shared/board';
import {
  handTotal,
  isBust,
  isOko,
  knownHand,
  shownHand,
  type OkoMove,
  type OkoView,
} from './logic';

function totalText(cards: readonly number[]): string {
  if (isOko(cards)) return 'Oko! (dvě esa)';
  const total = handTotal(cards);
  return isBust(cards) ? `${total} – přes 21` : `${total}`;
}

export function createOkoView(ctx: ViewContext<OkoMove>): GameView<OkoView> {
  let frame: RenderFrame | null = null;
  let latest: OkoView | null = null;
  const rendered = { mine: '', theirs: '' };

  const status = h('p', { class: 'board-status', 'aria-live': 'polite' });
  const round = h('p', { class: 'oko-round' });

  const theirName = h('h3', { class: 'oko-name' });
  const theirBadge = h('span', { class: 'oko-badge' });
  const theirCards = h('div', { class: 'card-row', 'aria-live': 'polite' });
  const theirTotal = h('p', { class: 'oko-total' });
  const theirs = h(
    'section',
    { class: 'oko-seat oko-seat--theirs' },
    h('div', { class: 'oko-seat-head' }, theirName, theirBadge),
    theirCards,
    theirTotal,
  );

  const myName = h('h3', { class: 'oko-name' });
  const myBadge = h('span', { class: 'oko-badge' });
  const myCards = h('div', { class: 'card-row' });
  const myTotal = h('p', { class: 'oko-total oko-total--mine', 'aria-live': 'polite' });
  const drawButton = h(
    'button',
    { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => decide('draw') },
    'Líznout',
    h('kbd', null, 'L'),
  );
  const standButton = h(
    'button',
    { type: 'button', class: 'btn btn-lg', onclick: () => decide('stand') },
    'Stát',
    h('kbd', null, 'S'),
  );
  const actions = h('div', { class: 'oko-actions' }, drawButton, standButton);
  const mine = h(
    'section',
    { class: 'oko-seat oko-seat--mine' },
    h('div', { class: 'oko-seat-head' }, myName, myBadge),
    myCards,
    myTotal,
    actions,
  );

  const container = h('div', { class: 'board-game oko' }, status, theirs, round, mine);
  ctx.root.append(container);

  const me = (): PlayerSlot => frame?.perspective ?? 'A';
  // Rozhodovat se dá, až hráč zná všechny své karty (online klíč od soupeře).
  const canDecide = (): boolean =>
    frame !== null &&
    latest !== null &&
    frame.cards !== null &&
    frame.finished === null &&
    frame.canAct.includes(frame.perspective) &&
    knownHand(latest, frame.perspective, frame.cards) !== null;

  function decide(kind: 'draw' | 'stand'): void {
    if (!frame || !canDecide()) return;
    ctx.sfx.play('click');
    ctx.submit(frame.perspective, { kind });
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'KeyL' || event.code === 'Digit1' || event.code === 'Numpad1') {
      event.preventDefault();
      decide('draw');
    } else if (event.code === 'KeyS' || event.code === 'Digit2' || event.code === 'Numpad2') {
      event.preventDefault();
      decide('stand');
    }
  }
  window.addEventListener('keydown', onKey);

  /** Překreslí řadu karet jen při změně (nové karty se „rozdají“ animací). */
  function renderRow(
    row: HTMLElement,
    key: 'mine' | 'theirs',
    cards: readonly (number | null)[],
  ): void {
    const signature = JSON.stringify(cards);
    if (rendered[key] === signature) return;
    const previous = rendered[key] ? (JSON.parse(rendered[key]) as unknown[]).length : 0;
    rendered[key] = signature;
    row.replaceChildren(...cards.map((card, i) => cardNode(card, i >= previous ? 'is-dealt' : '')));
  }

  function badge(view: OkoView, f: RenderFrame, player: PlayerSlot): string {
    if (view.stood[player]) return 'stojí';
    const d = view.decisions[player];
    // Online je rozhodnutí soupeře zapečetěné – víme jen, že ho poslal.
    if (d !== null || f.committed.includes(player)) return 'rozhodnuto';
    if (view.last[player] === 'draw') return 'lízl(a)';
    return '';
  }

  return {
    render(view, f) {
      const perspectiveChanged = frame?.perspective !== f.perspective;
      latest = view;
      frame = f;
      if (perspectiveChanged) {
        rendered.mine = '';
        rendered.theirs = '';
      }
      const mineSlot = me();
      const opp = otherPlayer(mineSlot);
      const local = ctx.localPlayers.length > 1;
      setText(myName, local ? ctx.names[mineSlot] : 'Ty');
      setText(theirName, ctx.names[opp]);

      const known = f.cards ?? new Map<number, number>();
      const myHand = view.hands[mineSlot].map((p) => known.get(p) ?? null);
      renderRow(myCards, 'mine', myHand);
      const theirShown = shownHand(view, opp);
      renderRow(theirCards, 'theirs', theirShown ?? view.hands[opp].map(() => null));

      const full = knownHand(view, mineSlot, known);
      setText(myTotal, full ? `Součet: ${totalText(full)}` : '');
      setText(
        theirTotal,
        theirShown
          ? `Součet: ${totalText(theirShown)}`
          : `${view.hands[opp].length} ${view.hands[opp].length === 1 ? 'karta' : view.hands[opp].length < 5 ? 'karty' : 'karet'}`,
      );
      setText(myBadge, badge(view, f, mineSlot));
      setText(theirBadge, badge(view, f, opp));
      setText(round, f.finished ? 'Odhalení' : `Kolo ${view.round}`);

      const active = canDecide();
      drawButton.disabled = !active;
      standButton.disabled = !active;
      actions.hidden = view.stood[mineSlot] || f.finished !== null;
      mine.classList.toggle('is-active', active);

      let text: string;
      if (f.cards === null) text = 'Míchám balíček…';
      else if (f.finished) text = outcomeMessage(ctx, f.finished);
      else if (view.stood.A && view.stood.B) text = 'Oba stojí – odhalujeme karty…';
      else if (active) {
        text = local ? `${ctx.names[mineSlot]}: líznout, nebo stát?` : 'Líznout, nebo stát?';
      } else if (view.stood[mineSlot]) {
        text =
          ctx.mode === 'pve'
            ? `Stojíš. ${ctx.names[opp]} přemýšlí…`
            : `Stojíš. Čekám na hráče ${ctx.names[opp]}…`;
      } else if (f.committed.includes(opp)) text = `${ctx.names[opp]} už se rozhodl(a)…`;
      else
        text =
          ctx.mode === 'pve' ? `${ctx.names[opp]} přemýšlí…` : `Čekám na hráče ${ctx.names[opp]}…`;
      setText(status, text);
    },
    destroy() {
      window.removeEventListener('keydown', onKey);
      container.remove();
    },
  };
}
