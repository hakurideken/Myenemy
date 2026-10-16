import type { PlayerSlot } from '../../core/types';
import { h, uid } from '../dom';

/** Neprůhledná obrazovka mezi tahy, aby druhý hráč neviděl tajná data. */
export function showHandoff(container: HTMLElement, name: string, slot: PlayerSlot): Promise<void> {
  return new Promise((resolve) => {
    const titleId = uid('handoff');
    const confirm = h(
      'button',
      { type: 'button', class: 'btn btn-primary btn-lg' },
      `Jsem ${name} – pokračovat`,
    );
    const overlay = h(
      'div',
      {
        class: `handoff handoff--${slot.toLowerCase()}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
      },
      h('p', { class: 'kicker' }, 'Předej zařízení'),
      h('h2', { id: titleId, class: 'handoff-name' }, name),
      h('p', { class: 'lead' }, 'Na řadě je tento hráč. Ostatní se nedívejte!'),
      confirm,
    );
    confirm.addEventListener(
      'click',
      () => {
        overlay.remove();
        resolve();
      },
      { once: true },
    );
    container.append(overlay);
    confirm.focus();
  });
}
