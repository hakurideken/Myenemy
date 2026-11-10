import { translations } from '../../i18n';
import { formatHandle } from '../../net/account';
import {
  parseHandle,
  type Friend,
  type FriendStatus,
  type FriendRequest,
  type SendRequestResult,
} from '../../net/friends';
import type { App, Mount } from '../App';
import { button } from '../components/common';
import { h, setText } from '../dom';
import { accountErrorText } from './account';

const t = translations(
  {
    title: 'Kamarádi',
    myHandle: 'Tvoje jméno pro kamarády',
    copy: 'Kopírovat',
    copied: 'Zkopírováno.',
    addLabel: 'Přidat kamaráda',
    addHint: 'Celé jméno i s kódem za #, třeba Pepa#0042.',
    send: 'Poslat žádost',
    badHandle: 'Zadej jméno i s kódem, třeba Pepa#0042.',
    sendResult: {
      sent: 'Žádost odeslaná – kamarád ji teď musí přijmout.',
      accepted: 'Hotovo – už jste kamarádi (žádost od něj už čekala).',
      'already-friends': 'Už jste kamarádi.',
      'already-sent': 'Žádost už je odeslaná a čeká na odpověď.',
      'not-found': 'Hráč s tímhle jménem a kódem neexistuje.',
      self: 'To jsi ty. 🙂',
      'no-profile': 'Nejdřív si zvol přezdívku.',
    } satisfies Record<SendRequestResult, string>,
    incoming: 'Žádosti pro tebe',
    outgoing: 'Odeslané žádosti',
    friends: 'Kamarádi',
    noFriends: 'Zatím žádní kamarádi. Pošli někomu žádost – nebo mu dej své jméno s kódem.',
    accept: 'Přijmout',
    decline: 'Odmítnout',
    cancel: 'Zrušit',
    remove: 'Odebrat',
    play: 'Pozvat do hry',
    status: { online: 'online', playing: 've hře', offline: 'offline' } satisfies Record<
      FriendStatus,
      string
    >,
    removeTitle: 'Odebrat kamaráda?',
    removeText: (handle: string) =>
      `${handle} zmizí z kamarádů a smaže se i vaše vzájemné skóre. Přidat se můžete znovu.`,
    removeConfirm: 'Odebrat',
    removeKeep: 'Ponechat',
    score: (wins: number, losses: number) => `Ty ${wins} : ${losses}`,
    scoreLabel: (handle: string, wins: number, losses: number) =>
      `Proti ${handle}: ${wins} výher, ${losses} proher`,
    scoreHint:
      'Skóre se počítá z online zápasů, kde jste oba přihlášení – započte se, až ho potvrdí oba.',
    loading: 'Načítám…',
    signIn: 'Kamarádi jsou jen pro přihlášené. Přihlas se vpravo nahoře.',
    back: 'Zpět do menu',
  },
  {
    title: 'Friends',
    myHandle: 'Your name for friends',
    copy: 'Copy',
    copied: 'Copied.',
    addLabel: 'Add a friend',
    addHint: 'The full name with the code after #, e.g. Pepa#0042.',
    send: 'Send request',
    badHandle: 'Enter the name with its code, e.g. Pepa#0042.',
    sendResult: {
      sent: 'Request sent – your friend now has to accept it.',
      accepted: 'Done – you are friends now (their request was already waiting).',
      'already-friends': 'You are already friends.',
      'already-sent': 'You already sent a request; it is waiting for an answer.',
      'not-found': 'No player has this name and code.',
      self: 'That is you. 🙂',
      'no-profile': 'Pick a nickname first.',
    } satisfies Record<SendRequestResult, string>,
    incoming: 'Requests for you',
    outgoing: 'Sent requests',
    friends: 'Friends',
    noFriends: 'No friends yet. Send someone a request – or give them your name with its code.',
    accept: 'Accept',
    decline: 'Decline',
    cancel: 'Cancel',
    remove: 'Remove',
    play: 'Invite to a game',
    status: { online: 'online', playing: 'in a game', offline: 'offline' } satisfies Record<
      FriendStatus,
      string
    >,
    removeTitle: 'Remove friend?',
    removeText: (handle: string) =>
      `${handle} will be removed from your friends and your head-to-head score is deleted. You can add each other again.`,
    removeConfirm: 'Remove',
    removeKeep: 'Keep',
    score: (wins: number, losses: number) => `You ${wins} : ${losses}`,
    scoreLabel: (handle: string, wins: number, losses: number) =>
      `Against ${handle}: ${wins} wins, ${losses} losses`,
    scoreHint:
      'The score counts online matches where you are both signed in – it is added once both of you confirm it.',
    loading: 'Loading…',
    signIn: 'Friends are for signed-in players. Sign in at the top right.',
    back: 'Back to menu',
  },
);

export function friendsScreen(app: App): Mount {
  return (root) => {
    let alive = true;
    const state = app.account.state;
    const main = h('main', { class: 'screen screen--narrow' });
    const back = button(t.back, () => app.goMenu(), 'btn btn-ghost');
    main.append(h('h1', { class: 'screen-title', tabindex: '-1' }, t.title));
    root.append(main);

    if (state.kind !== 'signed-in' || !state.profile) {
      main.append(h('p', { class: 'lead' }, t.signIn), back);
      return;
    }
    const handle = formatHandle(state.profile);

    // --- moje jméno ---
    const copyStatus = h('p', { class: 'field-hint', 'aria-live': 'polite' });
    const mine = h(
      'section',
      { class: 'card friends-me' },
      h('p', { class: 'field-label' }, t.myHandle),
      h(
        'div',
        { class: 'friends-me-row' },
        h('strong', { class: 'account-handle' }, handle),
        button(t.copy, () => {
          navigator.clipboard
            .writeText(handle)
            .then(() => setText(copyStatus, t.copied))
            .catch(() => undefined);
        }),
      ),
      copyStatus,
    );

    // --- přidat kamaráda ---
    const input = h('input', {
      id: 'friend-handle',
      type: 'text',
      maxlength: 70,
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: 'Pepa#0042',
      'aria-describedby': 'friend-hint friend-status',
    });
    const status = h('p', { id: 'friend-status', class: 'field-hint', 'aria-live': 'polite' });
    const sendButton = h('button', { type: 'submit', class: 'btn btn-primary' }, t.send);
    const form = h(
      'form',
      {
        class: 'card form',
        novalidate: true,
        onsubmit: (event: SubmitEvent) => {
          event.preventDefault();
          const target = parseHandle(input.value);
          if (!target) {
            setText(status, t.badHandle);
            input.focus();
            return;
          }
          sendButton.disabled = true;
          app.account.sendFriendRequest(target).then(
            (result) => {
              sendButton.disabled = false;
              setText(status, t.sendResult[result]);
              if (result === 'sent' || result === 'accepted') input.value = '';
              void reload();
            },
            (err: unknown) => {
              sendButton.disabled = false;
              setText(status, accountErrorText(err));
            },
          );
        },
      },
      h('label', { for: 'friend-handle', class: 'field-label' }, t.addLabel),
      input,
      h('p', { id: 'friend-hint', class: 'field-hint' }, t.addHint),
      status,
      sendButton,
    );

    // --- seznamy ---
    const lists = h('div', { class: 'stack', 'aria-live': 'polite' }, h('p', null, t.loading));
    main.append(mine, form, lists, back);

    const action = (label: string, run: () => Promise<void>, cls = 'btn'): HTMLButtonElement => {
      const b = button(
        label,
        () => {
          b.disabled = true;
          run()
            .then(() => reload())
            .catch((err: unknown) => {
              b.disabled = false;
              setText(status, accountErrorText(err));
            });
        },
        `${cls} btn-small`,
      );
      return b;
    };

    const requestItem = (r: FriendRequest): HTMLElement =>
      h(
        'li',
        { class: 'friend-row' },
        h('span', { class: 'friend-name' }, formatHandle(r)),
        h(
          'span',
          { class: 'friend-actions' },
          ...(r.incoming
            ? [
                action(
                  t.accept,
                  () => app.account.respondFriendRequest(r.id, true),
                  'btn btn-primary',
                ),
                action(t.decline, () => app.account.respondFriendRequest(r.id, false)),
              ]
            : [action(t.cancel, () => app.account.cancelFriendRequest(r.id))]),
        ),
      );

    const friendItem = (f: Friend): HTMLElement => {
      const name = formatHandle(f);
      const remove = button(
        t.remove,
        () => {
          void app
            .confirm({
              title: t.removeTitle,
              message: t.removeText(name),
              confirm: t.removeConfirm,
              cancel: t.removeKeep,
            })
            .then((yes) => {
              if (!yes) return;
              app.account
                .removeFriend(f.id)
                .then(() => reload())
                .catch((err: unknown) => setText(status, accountErrorText(err)));
            });
        },
        'btn btn-ghost btn-small',
      );
      return h(
        'li',
        { class: 'friend-row' },
        h(
          'span',
          { class: 'friend-name' },
          h('span', { class: `friend-dot friend-dot--${f.status}`, 'aria-hidden': 'true' }),
          name,
          h('span', { class: `friend-status friend-status--${f.status}` }, t.status[f.status]),
        ),
        h(
          'span',
          { class: 'friend-score', 'aria-label': t.scoreLabel(name, f.wins, f.losses) },
          t.score(f.wins, f.losses),
        ),
        h(
          'span',
          { class: 'friend-actions' },
          app.onlineAvailable
            ? button(
                t.play,
                () => app.inviteToGame(f),
                // Online kamarád pozvánku nejspíš hned uvidí – zvýraznit.
                f.status === 'online' ? 'btn btn-primary btn-small' : 'btn btn-small',
              )
            : null,
          remove,
        ),
      );
    };

    const section = (title: string, items: HTMLElement[], empty?: string): HTMLElement | null =>
      items.length === 0 && !empty
        ? null
        : h(
            'section',
            { class: 'card' },
            h('h2', { class: 'friends-title' }, title),
            items.length > 0
              ? h('ul', { class: 'friend-list' }, ...items)
              : h('p', { class: 'field-hint' }, empty ?? ''),
          );

    async function reload(): Promise<void> {
      try {
        const [friends, requests] = await Promise.all([
          app.account.friends(),
          app.account.friendRequests(),
        ]);
        if (!alive) return;
        lists.replaceChildren(
          ...[
            section(t.incoming, requests.filter((r) => r.incoming).map(requestItem)),
            section(t.friends, friends.map(friendItem), t.noFriends),
            section(t.outgoing, requests.filter((r) => !r.incoming).map(requestItem)),
          ].filter((el): el is HTMLElement => el !== null),
          h('p', { class: 'field-hint' }, t.scoreHint),
        );
      } catch (err) {
        if (alive) lists.replaceChildren(h('p', { class: 'field-error' }, accountErrorText(err)));
      }
    }
    void reload();
    return () => {
      alive = false;
    };
  };
}
