import type { Clock } from '../../core/util/clock';
import { h, setText } from '../dom';

export interface TurnTimer {
  readonly el: HTMLElement;
  set(deadline: number | null, totalMs: number): void;
  destroy(): void;
}

const URGENT_MS = 5000;

export function createTurnTimer(clock: Clock): TurnTimer {
  const bar = h('div', { class: 'turn-timer-bar' });
  const label = h('span', { class: 'turn-timer-label' });
  const el = h(
    'div',
    { class: 'turn-timer is-idle', role: 'timer', 'aria-label': 'Čas na tah' },
    h('div', { class: 'turn-timer-track' }, bar),
    label,
  );
  let interval: ReturnType<typeof setInterval> | null = null;
  let deadline = 0;
  let total = 1;

  const tick = (): void => {
    const left = Math.max(0, deadline - clock.now());
    bar.style.width = `${(left / total) * 100}%`;
    setText(label, `${Math.ceil(left / 1000)} s`);
    el.classList.toggle('is-urgent', left <= URGENT_MS);
  };

  const stop = (): void => {
    if (interval !== null) clearInterval(interval);
    interval = null;
  };

  return {
    el,
    set(next, totalMs) {
      stop();
      if (next === null) {
        el.classList.add('is-idle');
        return;
      }
      deadline = next;
      total = Math.max(1, totalMs);
      el.classList.remove('is-idle');
      tick();
      interval = setInterval(tick, 200);
    },
    destroy: stop,
  };
}
