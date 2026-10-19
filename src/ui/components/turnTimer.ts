import type { Clock } from '../../core/util/clock';
import { translations } from '../../i18n';
import { h, setText } from '../dom';

const t = translations(
  {
    label: 'Čas na tah',
    left: (n: number) =>
      n === 1
        ? 'Zbývá 1 sekunda na tah.'
        : n >= 2 && n <= 4
          ? `Zbývají ${n} sekundy na tah.`
          : `Zbývá ${n} sekund na tah.`,
  },
  {
    label: 'Time for your move',
    left: (n: number) =>
      n === 1 ? '1 second left for your move.' : `${n} seconds left for your move.`,
  },
);

export interface TurnTimer {
  readonly el: HTMLElement;
  set(deadline: number | null, totalMs: number): void;
  destroy(): void;
}

const URGENT_MS = 5000;

/** „Zbývá 5 sekund“, „Zbývají 3 sekundy“, „Zbývá 1 sekunda“. */
export function secondsLeftText(n: number): string {
  return t.left(n);
}

export function createTurnTimer(clock: Clock): TurnTimer {
  const bar = h('div', { class: 'turn-timer-bar' });
  const label = h('span', { class: 'turn-timer-label', 'aria-hidden': 'true' });
  // Čtečka obrazovky dostane jen jedno upozornění, ne odpočet každou sekundu.
  const announce = h('span', { class: 'sr-only', 'aria-live': 'polite' });
  const el = h(
    'div',
    { class: 'turn-timer is-idle', role: 'timer', 'aria-label': t.label },
    h('div', { class: 'turn-timer-track' }, bar),
    label,
    announce,
  );
  let interval: ReturnType<typeof setInterval> | null = null;
  let deadline = 0;
  let total = 1;
  let warned = false;

  const tick = (): void => {
    const left = Math.max(0, deadline - clock.now());
    bar.style.width = `${(left / total) * 100}%`;
    setText(label, `${Math.ceil(left / 1000)} s`);
    const urgent = left <= URGENT_MS;
    el.classList.toggle('is-urgent', urgent);
    if (urgent && !warned && left > 0) {
      warned = true;
      setText(announce, secondsLeftText(Math.ceil(left / 1000)));
    }
  };

  const stop = (): void => {
    if (interval !== null) clearInterval(interval);
    interval = null;
  };

  return {
    el,
    set(next, totalMs) {
      stop();
      setText(announce, '');
      if (next === null) {
        el.classList.add('is-idle');
        return;
      }
      if (next !== deadline) warned = false;
      deadline = next;
      total = Math.max(1, totalMs);
      el.classList.remove('is-idle');
      tick();
      interval = setInterval(tick, 200);
    },
    destroy: stop,
  };
}
