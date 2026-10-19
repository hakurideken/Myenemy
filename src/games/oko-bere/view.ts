import type { GameView, RenderFrame, ViewContext } from '../../core/MiniGame';
import { otherPlayer, type PlayerSlot } from '../../core/types';
import { translations } from '../../i18n';
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

const t = translations(
  {
    oko: 'Oko! (dvě esa)',
    bust: (total: number) => `${total} – přes 21`,
    total: (text: string) => `Součet: ${text}`,
    cardCount: (n: number) => `${n} ${n === 1 ? 'karta' : n < 5 ? 'karty' : 'karet'}`,
    draw: 'Líznout',
    stand: 'Stát',
    stands: 'stojí',
    decided: 'rozhodnuto',
    drew: 'lízl(a)',
    you: 'Ty',
    reveal: 'Odhalení',
    round: (n: number) => `Kolo ${n}`,
    shuffling: 'Míchám balíček…',
    bothStand: 'Oba stojí – odhalujeme karty…',
    choiceNamed: (name: string) => `${name}: líznout, nebo stát?`,
    choice: 'Líznout, nebo stát?',
    standThinking: (name: string) => `Stojíš. ${name} přemýšlí…`,
    standWaiting: (name: string) => `Stojíš. Čekám na hráče ${name}…`,
    opponentDecided: (name: string) => `${name} už se rozhodl(a)…`,
    thinking: (name: string) => `${name} přemýšlí…`,
    waiting: (name: string) => `Čekám na hráče ${name}…`,
  },
  {
    oko: 'Oko! (two aces)',
    bust: (total) => `${total} – over 21`,
    total: (text) => `Total: ${text}`,
    cardCount: (n) => `${n} ${n === 1 ? 'card' : 'cards'}`,
    draw: 'Draw',
    stand: 'Stand',
    stands: 'stands',
    decided: 'decided',
    drew: 'drew',
    you: 'You',
    reveal: 'Reveal',
    round: (n) => `Round ${n}`,
    shuffling: 'Shuffling the deck…',
    bothStand: 'Both stand – revealing cards…',
    choiceNamed: (name) => `${name}: draw or stand?`,
    choice: 'Draw or stand?',
    standThinking: (name) => `You stand. ${name} is thinking…`,
    standWaiting: (name) => `You stand. Waiting for ${name}…`,
    opponentDecided: (name) => `${name} has decided…`,
    thinking: (name) => `${name} is thinking…`,
    waiting: (name) => `Waiting for ${name}…`,
  },
);

function totalText(cards: readonly number[]): string {
  if (isOko(cards)) return t.oko;
  const total = handTotal(cards);
  return isBust(cards) ? t.bust(total) : `${total}`;
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
    t.draw,
    h('kbd', null, 'L'),
  );
  const standButton = h(
    'button',
    { type: 'button', class: 'btn btn-lg', onclick: () => decide('stand') },
    t.stand,
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
    if (view.stood[player]) return t.stands;
    const d = view.decisions[player];
    // Online je rozhodnutí soupeře zapečetěné – víme jen, že ho poslal.
    if (d !== null || f.committed.includes(player)) return t.decided;
    if (view.last[player] === 'draw') return t.drew;
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
      setText(myName, local ? ctx.names[mineSlot] : t.you);
      setText(theirName, ctx.names[opp]);

      const known = f.cards ?? new Map<number, number>();
      const myHand = view.hands[mineSlot].map((p) => known.get(p) ?? null);
      renderRow(myCards, 'mine', myHand);
      const theirShown = shownHand(view, opp);
      renderRow(theirCards, 'theirs', theirShown ?? view.hands[opp].map(() => null));

      const full = knownHand(view, mineSlot, known);
      setText(myTotal, full ? t.total(totalText(full)) : '');
      setText(
        theirTotal,
        theirShown ? t.total(totalText(theirShown)) : t.cardCount(view.hands[opp].length),
      );
      setText(myBadge, badge(view, f, mineSlot));
      setText(theirBadge, badge(view, f, opp));
      setText(round, f.finished ? t.reveal : t.round(view.round));

      const active = canDecide();
      drawButton.disabled = !active;
      standButton.disabled = !active;
      actions.hidden = view.stood[mineSlot] || f.finished !== null;
      mine.classList.toggle('is-active', active);

      let text: string;
      if (f.cards === null) text = t.shuffling;
      else if (f.finished) text = outcomeMessage(ctx, f.finished);
      else if (view.stood.A && view.stood.B) text = t.bothStand;
      else if (active) {
        text = local ? t.choiceNamed(ctx.names[mineSlot]) : t.choice;
      } else if (view.stood[mineSlot]) {
        text =
          ctx.mode === 'pve' ? t.standThinking(ctx.names[opp]) : t.standWaiting(ctx.names[opp]);
      } else if (f.committed.includes(opp)) text = t.opponentDecided(ctx.names[opp]);
      else text = ctx.mode === 'pve' ? t.thinking(ctx.names[opp]) : t.waiting(ctx.names[opp]);
      setText(status, text);
    },
    destroy() {
      window.removeEventListener('keydown', onKey);
      container.remove();
    },
  };
}
