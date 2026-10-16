import type { GameView, RenderFrame, ViewContext } from '../../core/MiniGame';
import { PLAYER_SLOTS, type Outcome, type PerPlayer, type PlayerSlot } from '../../core/types';
import type { TimerHandle } from '../../core/util/clock';
import { h, setText } from '../../ui/dom';
import { rpsIcon } from './icons';
import {
  CHOICE_LABEL,
  describeRps,
  RPS_CHOICES,
  type RpsChoice,
  type RpsMove,
  type RpsView,
} from './logic';

const KEYS: Partial<Record<string, RpsChoice>> = {
  Digit1: 'rock',
  Numpad1: 'rock',
  Digit2: 'scissors',
  Numpad2: 'scissors',
  Digit3: 'paper',
  Numpad3: 'paper',
};

export const RPS_SHAKE_MS = 900;

interface Side {
  readonly el: HTMLElement;
  readonly icon: HTMLElement;
  readonly choice: HTMLElement;
}

export function createRpsView(ctx: ViewContext<RpsMove>): GameView<RpsView> {
  let frame: RenderFrame | null = null;
  let latest: RpsView | null = null;
  let revealStarted = false;
  const timers: TimerHandle[] = [];

  const prompt = h('h2', { class: 'rps-prompt' });
  const status = h('p', { class: 'rps-status', 'aria-live': 'polite' });
  const buttons = RPS_CHOICES.map((choice, i) =>
    h(
      'button',
      {
        type: 'button',
        class: 'rps-choice',
        'data-choice': choice,
        'aria-pressed': 'false',
        onclick: () => choose(choice),
      },
      rpsIcon(choice),
      h('span', { class: 'rps-choice-label' }, CHOICE_LABEL[choice]),
      h('kbd', null, String(i + 1)),
    ),
  );
  const picker = h(
    'div',
    { class: 'rps-picker', role: 'group', 'aria-label': 'Tvoje volba' },
    buttons,
  );

  const makeSide = (player: PlayerSlot): Side => {
    const icon = h('div', { class: 'rps-side-icon' });
    const choice = h('span', { class: 'rps-side-choice' });
    const el = h(
      'div',
      { class: `rps-side rps-side--${player.toLowerCase()}` },
      h('span', { class: 'rps-side-name' }, ctx.names[player]),
      icon,
      choice,
    );
    return { el, icon, choice };
  };
  const sides: PerPlayer<Side> = { A: makeSide('A'), B: makeSide('B') };
  const reveal = h(
    'div',
    { class: 'rps-reveal', hidden: true },
    sides.A.el,
    h('span', { class: 'rps-vs', 'aria-hidden': 'true' }, 'VS'),
    sides.B.el,
  );
  const verdict = h('p', { class: 'rps-verdict', 'aria-live': 'polite' });
  const container = h('div', { class: 'rps' }, prompt, picker, status, reveal, verdict);
  ctx.root.append(container);

  function canChoose(): boolean {
    return (
      frame !== null &&
      latest !== null &&
      frame.finished === null &&
      latest.mine === null &&
      frame.canAct.includes(frame.perspective)
    );
  }

  function choose(choice: RpsChoice): void {
    if (!canChoose() || !frame) return;
    ctx.sfx.play('click');
    ctx.submit(frame.perspective, { choice });
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const choice = KEYS[event.code];
    if (!choice) return;
    event.preventDefault();
    choose(choice);
  }
  window.addEventListener('keydown', onKey);

  function showFinal(revealed: PerPlayer<RpsChoice>, outcome: Outcome): void {
    container.classList.remove('is-shaking');
    for (const p of PLAYER_SLOTS) {
      const side = sides[p];
      side.icon.replaceChildren(rpsIcon(revealed[p]));
      setText(side.choice, CHOICE_LABEL[revealed[p]]);
      side.el.classList.toggle('is-winner', outcome.kind === 'win' && outcome.winner === p);
      side.el.classList.toggle('is-loser', outcome.kind === 'win' && outcome.winner !== p);
    }
    const result = outcome.kind === 'draw' ? 'remíza' : `vyhrává ${ctx.names[outcome.winner]}`;
    setText(verdict, `${describeRps(revealed)} – ${result}`);
  }

  function startReveal(revealed: PerPlayer<RpsChoice>, outcome: Outcome): void {
    revealStarted = true;
    picker.hidden = true;
    setText(status, '');
    reveal.hidden = false;
    if (ctx.prefs.reducedMotion) {
      showFinal(revealed, outcome);
      return;
    }
    container.classList.add('is-shaking');
    for (const p of PLAYER_SLOTS) sides[p].icon.replaceChildren(rpsIcon('rock'));
    setText(verdict, 'Kámen… nůžky… papír!');
    timers.push(ctx.clock.setTimeout(() => showFinal(revealed, outcome), RPS_SHAKE_MS));
  }

  return {
    render(view, f) {
      latest = view;
      frame = f;
      const active = canChoose();
      setText(
        prompt,
        f.finished
          ? 'Odhalení!'
          : ctx.mode === 'local'
            ? `${ctx.names[f.perspective]}, vyber zbraň`
            : 'Vyber zbraň',
      );
      for (const button of buttons) {
        const chosen = view.mine === button.dataset.choice;
        button.disabled = !active;
        button.setAttribute('aria-pressed', String(chosen));
        button.classList.toggle('is-chosen', chosen);
      }
      if (!f.finished) {
        let text: string;
        if (view.mine) {
          text = `Vybráno: ${CHOICE_LABEL[view.mine]}. ${view.opponentReady ? 'Odhalujeme…' : 'Čekám na soupeře…'}`;
        } else {
          text = view.opponentReady ? 'Soupeř už má vybráno!' : 'Soupeř vybírá…';
        }
        setText(status, text);
      }
      if (f.finished && view.revealed && !revealStarted) startReveal(view.revealed, f.finished);
    },
    destroy() {
      for (const t of timers) ctx.clock.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      container.remove();
    },
  };
}
