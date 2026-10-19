import type { PlayerSlot } from '../../core/types';
import { h, uid } from '../dom';
import { translations } from '../../i18n';
import { makeInert } from './modal';

const t = translations(
  {
    confirm: (name: string) => `Jsem ${name} – pokračovat`,
    kicker: 'Předej zařízení',
    lead: 'Na řadě je tento hráč. Ostatní se nedívejte!',
  },
  {
    confirm: (name: string) => `I am ${name} – continue`,
    kicker: 'Pass the device',
    lead: "It's this player's turn. Everyone else, look away!",
  },
);

/** Neprůhledná obrazovka mezi tahy, aby druhý hráč neviděl tajná data. */
export function showHandoff(container: HTMLElement, name: string, slot: PlayerSlot): Promise<void> {
  return new Promise((resolve) => {
    const titleId = uid('handoff');
    const confirm = h(
      'button',
      { type: 'button', class: 'btn btn-primary btn-lg' },
      t.confirm(name),
    );
    const overlay = h(
      'div',
      {
        class: `handoff handoff--${slot.toLowerCase()}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
      },
      h('p', { class: 'kicker' }, t.kicker),
      h('h2', { id: titleId, class: 'handoff-name' }, name),
      h('p', { class: 'lead' }, t.lead),
      confirm,
    );
    // Hra pod překryvem nesmí jít ovládat ani číst (Tab, čtečka obrazovky).
    const restore = makeInert(container, overlay);
    confirm.addEventListener(
      'click',
      () => {
        restore();
        overlay.remove();
        resolve();
      },
      { once: true },
    );
    container.append(overlay);
    confirm.focus();
  });
}
