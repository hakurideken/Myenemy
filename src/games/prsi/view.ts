import type { CardAt, GameView, RenderFrame, ViewContext } from '../../core/MiniGame';
import { otherPlayer, type PlayerSlot } from '../../core/types';
import { h, setText } from '../../ui/dom';
import { outcomeMessage } from '../shared/board';
import { cardNode, suitIcon, suitName } from '../shared/cardView';
import { cardName, RANK, rankOf, SUIT_COUNT, suitOf } from '../shared/marias';
import { activeSuit, canPlay, handCards, topCard, type PrsiMove, type PrsiView } from './logic';

const plural = (n: number): string => (n === 1 ? 'kartu' : n >= 2 && n <= 4 ? 'karty' : 'karet');

const bySuitAndRank = (a: CardAt, b: CardAt): number =>
  suitOf(a.card) - suitOf(b.card) || rankOf(a.card) - rankOf(b.card);

export function createPrsiView(ctx: ViewContext<PrsiMove>): GameView<PrsiView> {
  let frame: RenderFrame | null = null;
  let latest: PrsiView | null = null;
  /** Vybraný svršek čekající na volbu barvy. */
  let pendingSvrsek: CardAt | null = null;
  let renderedHand = '';

  const status = h('p', { class: 'board-status', 'aria-live': 'polite' });
  const event = h('p', { class: 'prsi-event', 'aria-live': 'polite' });

  const theirName = h('h3', { class: 'prsi-name' });
  const theirCount = h('span', { class: 'prsi-count' });
  const theirFan = h('div', { class: 'card-fan', 'aria-hidden': 'true' });
  const theirs = h(
    'section',
    { class: 'prsi-seat prsi-seat--theirs' },
    h('div', { class: 'prsi-seat-head' }, theirName, theirCount),
    theirFan,
  );

  const pileCount = h('span', { class: 'prsi-pile-count' });
  const pile = h(
    'button',
    { type: 'button', class: 'prsi-pile', onclick: () => draw() },
    cardNode(null),
    pileCount,
  );
  const discardSlot = h('div', { class: 'prsi-discard' });
  const effect = h('p', { class: 'prsi-effect' });
  const table = h(
    'div',
    { class: 'prsi-table' },
    pile,
    h('div', { class: 'prsi-discard-wrap' }, discardSlot, effect),
  );

  const myName = h('h3', { class: 'prsi-name' });
  const hand = h('div', { class: 'prsi-hand', role: 'group', 'aria-label': 'Tvoje karty' });
  const drawButton = h('button', { type: 'button', class: 'btn', onclick: () => draw() });
  const standButton = h(
    'button',
    { type: 'button', class: 'btn', onclick: () => stand() },
    'Stojím',
    h('kbd', null, 'S'),
  );
  const suitButtons = Array.from({ length: SUIT_COUNT }, (_, suit) =>
    h(
      'button',
      {
        type: 'button',
        class: 'prsi-suit',
        'aria-label': `Barva ${suitName(suit)} (klávesa ${suit + 1})`,
        onclick: () => chooseSuit(suit),
      },
      suitIcon(suit),
      h('span', null, suitName(suit)),
    ),
  );
  const chooser = h(
    'div',
    { class: 'prsi-chooser', role: 'group', 'aria-label': 'Svršek: zvol barvu', hidden: true },
    h('p', { class: 'prsi-chooser-title' }, 'Svršek – jakou barvu chceš?'),
    h('div', { class: 'prsi-suits' }, suitButtons),
  );
  const actions = h('div', { class: 'prsi-actions' }, drawButton, standButton);
  const mine = h('section', { class: 'prsi-seat prsi-seat--mine' }, myName, hand, chooser, actions);

  const container = h('div', { class: 'board-game prsi' }, status, theirs, table, event, mine);
  ctx.root.append(container);

  const me = (): PlayerSlot => frame?.perspective ?? 'A';
  const myTurn = (): boolean =>
    frame !== null &&
    latest !== null &&
    frame.cards !== null &&
    frame.finished === null &&
    frame.canAct.includes(frame.perspective);

  function play(card: CardAt): void {
    if (!frame || !latest || !myTurn() || !canPlay(latest, card.card)) {
      ctx.sfx.play('tick');
      return;
    }
    if (rankOf(card.card) === RANK.SVRSEK) {
      pendingSvrsek = card;
      renderControls();
      suitButtons[0]?.focus();
      return;
    }
    ctx.sfx.play('click');
    ctx.submit(frame.perspective, { kind: 'play', pos: card.pos, card: card.card, suit: null });
  }

  function chooseSuit(suit: number): void {
    const card = pendingSvrsek;
    pendingSvrsek = null;
    if (!frame || !card || !myTurn()) return;
    ctx.sfx.play('click');
    ctx.submit(frame.perspective, { kind: 'play', pos: card.pos, card: card.card, suit });
  }

  function draw(): void {
    if (!frame || !latest || !myTurn() || latest.ace) return;
    pendingSvrsek = null;
    ctx.sfx.play('click');
    ctx.submit(frame.perspective, { kind: 'draw' });
  }

  function stand(): void {
    if (!frame || !latest || !myTurn() || !latest.ace) return;
    ctx.sfx.play('click');
    ctx.submit(frame.perspective, { kind: 'stand' });
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (pendingSvrsek) {
      const digit = /^(?:Digit|Numpad)([1-4])$/.exec(event.code);
      if (digit?.[1]) {
        event.preventDefault();
        chooseSuit(Number(digit[1]) - 1);
      } else if (event.key === 'Escape') {
        pendingSvrsek = null;
        renderControls();
      }
      return;
    }
    if (event.code === 'KeyL') {
      event.preventDefault();
      draw();
    } else if (event.code === 'KeyS') {
      event.preventDefault();
      stand();
    }
  }
  window.addEventListener('keydown', onKey);

  function myHand(): CardAt[] {
    if (!latest || !frame?.cards) return [];
    return handCards(latest, me(), frame.cards).sort(bySuitAndRank);
  }

  function renderHand(): void {
    const cards = myHand();
    const active = myTurn();
    const signature = JSON.stringify([
      cards,
      active,
      latest?.discard.at(-1),
      latest?.suit,
      latest?.penalty,
      latest?.ace,
    ]);
    if (signature === renderedHand) return;
    renderedHand = signature;
    hand.replaceChildren(
      ...cards.map((card) => {
        const playable = active && latest !== null && canPlay(latest, card.card);
        const button = h(
          'button',
          {
            type: 'button',
            class: `prsi-card${playable ? ' is-playable' : ''}`,
            'aria-label': `${cardName(card.card)}${playable ? '' : active ? ' (nejde zahrát)' : ''}`,
            onclick: () => play(card),
          },
          cardNode(card.card),
        );
        button.setAttribute('aria-disabled', String(!playable));
        return button;
      }),
    );
  }

  function renderControls(): void {
    const view = latest;
    const active = myTurn();
    chooser.hidden = !pendingSvrsek || !active;
    actions.hidden = !active || pendingSvrsek !== null;
    if (!view) return;
    drawButton.hidden = view.ace;
    standButton.hidden = !view.ace;
    drawButton.replaceChildren(
      view.penalty > 0 ? `Líznout ${view.penalty}` : 'Líznout',
      h('kbd', null, 'L'),
    );
    pile.disabled = !active || view.ace;
  }

  function eventText(view: PrsiView): string {
    const last = view.last;
    if (!last) return '';
    const who =
      ctx.localPlayers.length === 1 && last.player === me() ? 'Ty' : ctx.names[last.player];
    switch (last.kind) {
      case 'play':
        return `${who}: ${cardName(last.card)}${last.suit !== null ? ` → barva ${suitName(last.suit)}` : ''}`;
      case 'draw':
        return `${who}: lízl(a) ${last.count} ${plural(last.count)}`;
      case 'stand':
        return `${who}: stojí (eso)`;
    }
  }

  return {
    render(view, f) {
      const perspectiveChanged = frame?.perspective !== f.perspective;
      latest = view;
      frame = f;
      if (perspectiveChanged || !myTurn()) pendingSvrsek = null;
      if (perspectiveChanged) renderedHand = '';
      const mineSlot = me();
      const opp = otherPlayer(mineSlot);
      const local = ctx.localPlayers.length > 1;
      setText(myName, local ? ctx.names[mineSlot] : 'Tvoje karty');
      setText(theirName, ctx.names[opp]);
      const count = view.hands[opp].length;
      setText(
        theirCount,
        `${count} ${count === 1 ? 'karta' : count >= 2 && count <= 4 ? 'karty' : 'karet'}`,
      );
      if (theirFan.childElementCount !== count) {
        theirFan.replaceChildren(...Array.from({ length: count }, () => cardNode(null)));
      }
      setText(pileCount, String(view.drawPile.length));
      pile.setAttribute('aria-label', `Lízací balíček (${view.drawPile.length} karet)`);

      const top = topCard(view);
      const topKey = top === undefined ? '' : String(top);
      if (discardSlot.dataset.card !== topKey) {
        discardSlot.dataset.card = topKey;
        discardSlot.replaceChildren(cardNode(top ?? null, 'is-dealt'));
      }
      const suit = activeSuit(view);
      setText(
        effect,
        view.penalty > 0
          ? `Sedma! Líže se ${view.penalty}.`
          : view.ace
            ? 'Eso! Stojíš, nebo dáš eso.'
            : view.suit !== null && suit !== null
              ? `Barva: ${suitName(suit)}`
              : '',
      );

      renderHand();
      renderControls();
      setText(event, eventText(view));
      mine.classList.toggle('is-active', myTurn());

      let text: string;
      if (f.cards === null) text = 'Míchám balíček…';
      else if (top === undefined) text = 'Otáčím první kartu…';
      else if (f.finished) text = outcomeMessage(ctx, f.finished);
      else if (myTurn()) text = local ? `Na tahu: ${ctx.names[mineSlot]}` : 'Jsi na tahu';
      else
        text = ctx.mode === 'pve' ? `${ctx.names[opp]} přemýšlí…` : `Na tahu je ${ctx.names[opp]}`;
      setText(status, text);
    },
    destroy() {
      window.removeEventListener('keydown', onKey);
      container.remove();
    },
  };
}
