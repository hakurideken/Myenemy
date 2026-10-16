import { h, setText } from '../dom';

export interface Banner {
  readonly el: HTMLElement;
  destroy(): void;
}

/** Pruh nahoře: soupeř se odpojil, odpočet do výhry kontumací. */
export function connectionBanner(deadline: number, now: () => number): Banner {
  const text = h('span', null);
  const el = h(
    'div',
    { class: 'banner banner--warning', role: 'status' },
    h('span', { class: 'banner-icon', 'aria-hidden': 'true' }, '⚠'),
    text,
  );
  const tick = (): void => {
    const left = Math.max(0, Math.ceil((deadline - now()) / 1000));
    setText(text, `Soupeř se odpojil – čekám ještě ${left} s, pak vyhráváš kontumací.`);
  };
  tick();
  const interval = setInterval(tick, 500);
  return { el, destroy: () => clearInterval(interval) };
}
