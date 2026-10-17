import { h, uid } from '../dom';

/**
 * Zbytek obrazovky za dialogem: neklikatelný, mimo Tab i mimo čtečku obrazovky.
 * Vrací funkci, která stav vrátí.
 */
export function makeInert(container: Element, keep: Element): () => void {
  const changed: HTMLElement[] = [];
  for (const child of container.children) {
    if (child === keep || !(child instanceof HTMLElement) || child.inert) continue;
    child.inert = true;
    changed.push(child);
  }
  return () => {
    for (const el of changed) el.inert = false;
  };
}

/** Tab a Shift+Tab kolují jen mezi ovládacími prvky dialogu. */
export function trapFocus(dialog: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const focusable = [
    ...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, [tabindex="0"]'),
  ];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export interface ConfirmOptions {
  readonly title: string;
  readonly message: string;
  readonly confirm: string;
  readonly cancel?: string;
}

/**
 * Potvrzovací dialog místo window.confirm: ve stylu hry, s pastí na fokus a Escape.
 * Výchozí fokus je na „zůstat“ – omylem stisknutý Enter nic nezničí.
 */
export function confirmDialog(host: HTMLElement, o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const titleId = uid('dialog-title');
    const textId = uid('dialog-text');
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const cancel = h('button', { type: 'button', class: 'btn' }, o.cancel ?? 'Zůstat');
    const confirm = h('button', { type: 'button', class: 'btn btn-danger' }, o.confirm);
    const dialog = h(
      'div',
      {
        class: 'dialog',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        'aria-describedby': textId,
      },
      h('h2', { id: titleId, class: 'dialog-title' }, o.title),
      h('p', { id: textId, class: 'dialog-text' }, o.message),
      h('div', { class: 'dialog-actions' }, cancel, confirm),
    );
    const backdrop = h('div', { class: 'dialog-backdrop' }, dialog);
    const restore = makeInert(host, backdrop);

    const close = (result: boolean): void => {
      document.removeEventListener('keydown', onKey, true);
      restore();
      backdrop.remove();
      if (!result) previous?.focus();
      resolve(result);
    };
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
        return;
      }
      trapFocus(dialog, event);
      // Herní zkratky (mezerník, čísla…) za dialogem nesmí reagovat.
      event.stopPropagation();
    }
    cancel.addEventListener('click', () => close(false));
    confirm.addEventListener('click', () => close(true));
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(false);
    });
    document.addEventListener('keydown', onKey, true);
    host.append(backdrop);
    cancel.focus();
  });
}
