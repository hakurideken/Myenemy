import { translations } from '../../i18n';
import { formatHandle } from '../../net/account';
import type { GameInvite } from '../../net/friends';
import { h } from '../dom';
import { button } from './common';

const t = translations(
  {
    invites: 'Pozvánka do hry',
    from: (handle: string) => `${handle} tě zve do hry.`,
    accept: 'Přijmout',
    decline: 'Odmítnout',
    more: (n: number) => `+${n} další`,
  },
  {
    invites: 'Game invite',
    from: (handle: string) => `${handle} invites you to a game.`,
    accept: 'Accept',
    decline: 'Decline',
    more: (n: number) => `+${n} more`,
  },
);

export interface InviteToast {
  readonly el: HTMLElement;
  /** Ukáže nejnovější pozvánku (nebo nic). */
  update(invites: readonly GameInvite[], visible: boolean): void;
}

/** Upozornění na pozvánku do hry (dole na obrazovce, mimo rozehraný zápas). */
export function createInviteToast(handlers: {
  readonly accept: (invite: GameInvite) => void;
  readonly decline: (invite: GameInvite) => void;
}): InviteToast {
  const el = h('section', { class: 'invite-toast', 'aria-label': t.invites, hidden: true });
  let shown: string | null = null;
  return {
    el,
    update(invites, visible) {
      const invite = invites[0];
      el.hidden = !visible || !invite;
      if (!invite || !visible) {
        shown = null;
        return;
      }
      const key = `${invite.id}|${invites.length}`;
      if (shown === key) return;
      const fresh = shown === null || !shown.startsWith(invite.id);
      shown = key;
      el.replaceChildren(
        h(
          'p',
          { class: 'invite-text', role: 'status' },
          t.from(formatHandle(invite)),
          invites.length > 1
            ? h('span', { class: 'invite-more' }, ` ${t.more(invites.length - 1)}`)
            : '',
        ),
        h(
          'div',
          { class: 'invite-actions' },
          button(t.accept, () => handlers.accept(invite), 'btn btn-primary btn-small'),
          button(t.decline, () => handlers.decline(invite), 'btn btn-ghost btn-small'),
        ),
      );
      if (fresh) {
        // Nová pozvánka – krátce zvýraznit (animace se spustí znovu).
        el.classList.remove('is-new');
        void el.offsetWidth;
        el.classList.add('is-new');
      }
    },
  };
}
