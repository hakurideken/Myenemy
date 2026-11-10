import { formatHandle } from '../../net/account';
import type { Friend, InviteResult } from '../../net/friends';
import type { MatchFormat, MatchPlan } from '../../core/match/planMatch';
import type { PerPlayer } from '../../core/types';
import { translations } from '../../i18n';
import { normalizeRoomCode } from '../../net/room';
import type { App, Mount } from '../App';
import { button, versus } from '../components/common';
import { slotList } from '../components/slotList';
import { h, setText } from '../dom';
import { formatTitle } from '../labels';
import { bestOfLead, RULES_NOTE } from './matchIntro';

const t = translations(
  {
    title: 'Online souboj',
    notConfigured: 'Online hra není na tomhle webu nastavená.',
    notConfiguredNote: 'Chybí připojení k serveru (Supabase). Mezitím si můžeš zahrát proti AI.',
    vsAi: 'Proti AI',
    backToMenu: 'Zpět do menu',
    badCode: 'Kód má 5 znaků – písmena a číslice (bez 0, O, 1 a I).',
    createTitle: 'Založit místnost',
    createNote: 'Vybereš formát a dostaneš kód a odkaz, který pošleš soupeři.',
    create: 'Vytvořit místnost',
    join: 'Připojit se',
    roomCode: 'Kód místnosti',
    roomCodeSpelled: (spelled: string) => `Kód místnosti ${spelled}`,
    codeHint: 'Kód ti pošle hostitel, třeba XY7KP.',
    connecting: 'Připojuji…',
    cancel: 'Zrušit',
    roomLink: 'Odkaz do místnosti',
    copied: '✓ Zkopírováno',
    copyManually: 'Zkopíruj odkaz ručně (Ctrl+C).',
    hostKicker: 'Online · hostitel',
    roomReady: 'Místnost je připravená',
    orLink: 'Nebo pošli odkaz',
    copy: 'Kopírovat',
    waiting: 'Čekám na soupeře…',
    format: (title: string) => `Formát: ${title}`,
    cancelRoom: 'Zrušit místnost',
    seeding: 'Losujeme společný seed…',
    start: 'Do boje!',
    waitingHost: 'Čekám, až hostitel spustí souboj…',
    lobbyKicker: (isHost: boolean) => `Online · ${isHost ? 'hostitel' : 'host'}`,
    seedNote:
      'Pořadí her i veškerá náhoda vychází ze seedu, ke kterému přispěli oba hráči – nemůže ho ovlivnit ani hostitel.',
    leave: 'Odejít',
    privacy:
      'Soukromí: při online hře se přes službu Supabase posílá jen přezdívka a herní tahy, hra nic neukládá. Přezdívka a nastavení zůstávají jen v tomto prohlížeči. Poskytovatel služby může vést krátké provozní záznamy (např. IP adresu).',
    checkCode: 'Kontrolní kód spojení',
    checkNote:
      'Porovnejte si ho se soupeřem (třeba ve zprávě). Pokud se liší, někdo se vložil mezi vás – odejděte.',
  },
  {
    title: 'Online duel',
    notConfigured: 'Online play is not set up on this site.',
    notConfiguredNote:
      'The server connection (Supabase) is missing. Meanwhile you can play against the AI.',
    vsAi: 'Against AI',
    backToMenu: 'Back to menu',
    badCode: 'The code has 5 characters – letters and digits (no 0, O, 1 or I).',
    createTitle: 'Create a room',
    createNote: 'Pick a format and you get a code and a link to send to your opponent.',
    create: 'Create room',
    join: 'Join',
    roomCode: 'Room code',
    roomCodeSpelled: (spelled: string) => `Room code ${spelled}`,
    codeHint: 'The host sends you the code, e.g. XY7KP.',
    connecting: 'Connecting…',
    cancel: 'Cancel',
    roomLink: 'Room link',
    copied: '✓ Copied',
    copyManually: 'Copy the link manually (Ctrl+C).',
    hostKicker: 'Online · host',
    roomReady: 'The room is ready',
    orLink: 'Or send a link',
    copy: 'Copy',
    waiting: 'Waiting for the opponent…',
    format: (title: string) => `Format: ${title}`,
    cancelRoom: 'Close the room',
    seeding: 'Drawing a shared seed…',
    start: 'Fight!',
    waitingHost: 'Waiting for the host to start the duel…',
    lobbyKicker: (isHost: boolean) => `Online · ${isHost ? 'host' : 'guest'}`,
    seedNote:
      'The game order and all randomness come from a seed both players contributed to – not even the host can influence it.',
    leave: 'Leave',
    privacy:
      'Privacy: online play sends only your nickname and game moves through the Supabase service; the game stores nothing. Your nickname and settings stay in this browser only. The service provider may keep short operational logs (e.g. your IP address).',
    checkCode: 'Connection check code',
    checkNote:
      'Compare it with your opponent (e.g. in a message). If it differs, someone got between you – leave.',
  },
);

export function onlineMenuScreen(app: App, available: boolean): Mount {
  return (root) => {
    const main = h(
      'main',
      { class: 'screen screen--narrow' },
      h('p', { class: 'kicker' }, 'Online 1v1'),
      h('h1', { class: 'screen-title', tabindex: '-1' }, t.title),
    );
    root.append(main);

    if (!available) {
      main.append(
        h(
          'section',
          { class: 'card stack' },
          h('p', { class: 'lead' }, t.notConfigured),
          h('p', { class: 'note' }, t.notConfiguredNote),
          h(
            'div',
            { class: 'actions' },
            button(t.vsAi, () => app.goSetup('pve'), 'btn btn-primary', {
              'data-autofocus': true,
            }),
          ),
        ),
        button(t.backToMenu, () => app.goMenu(), 'btn btn-ghost'),
      );
      return;
    }

    const input = h('input', {
      id: 'room-code',
      type: 'text',
      maxlength: 7,
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
      class: 'code-input',
      'aria-describedby': 'room-code-hint room-code-error',
      value: app.suggestedRoom() ?? '',
    });
    const error = h('p', { id: 'room-code-error', class: 'field-error', 'aria-live': 'polite' });
    const join = (event: SubmitEvent): void => {
      event.preventDefault();
      const code = normalizeRoomCode(input.value);
      if (!code) {
        setText(error, t.badCode);
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      app.joinOnline(code);
    };

    main.append(
      h(
        'section',
        { class: 'card stack' },
        h('h2', { class: 'card-title' }, t.createTitle),
        h('p', { class: 'note' }, t.createNote),
        button(t.create, () => app.goSetup('online'), 'btn btn-primary btn-lg', {
          'data-autofocus': true,
        }),
      ),
      h(
        'form',
        { class: 'card form', novalidate: true, onsubmit: join },
        h('h2', { class: 'card-title' }, t.join),
        h('label', { for: 'room-code', class: 'field-label' }, t.roomCode),
        input,
        h('p', { id: 'room-code-hint', class: 'field-hint' }, t.codeHint),
        error,
        h('button', { type: 'submit', class: 'btn btn-lg' }, t.join),
      ),
      h('p', { class: 'note' }, t.privacy),
      button(t.backToMenu, () => app.goMenu(), 'btn btn-ghost'),
    );
  };
}

export function connectingScreen(text: string, onCancel: () => void): Mount {
  return (root) => {
    root.append(
      h(
        'main',
        { class: 'screen screen--narrow screen--center' },
        h('div', { class: 'spinner', 'aria-hidden': 'true' }),
        h('h1', { class: 'screen-title', tabindex: '-1' }, t.connecting),
        h('p', { class: 'lead', role: 'status' }, text),
        button(t.cancel, onCancel, 'btn btn-ghost'),
      ),
    );
  };
}

export interface InviteOptions {
  readonly friends: () => Promise<readonly Friend[]>;
  readonly send: (friend: Friend) => Promise<InviteResult>;
  /** Kamarád, kterého pozvat hned (z obrazovky Kamarádi). */
  readonly auto: Friend | null;
}

interface WaitingOptions {
  readonly code: string;
  readonly link: string;
  readonly format: MatchFormat;
  readonly onCancel: () => void;
  /** Přihlášený hráč může rovnou pozvat kamaráda (bez posílání kódu). */
  readonly invite?: InviteOptions;
}

const it = translations(
  {
    title: 'Pozvat kamaráda',
    hint: 'Kamarád dostane pozvánku přímo ve hře – kód posílat nemusíš.',
    invite: 'Pozvat',
    sent: 'Pozváno ✓',
    notFriends: 'Už nejste kamarádi',
    failed: 'Nepovedlo se',
    none: 'Zatím nemáš kamarády – přidáš je vpravo nahoře v účtu.',
    loading: 'Načítám kamarády…',
  },
  {
    title: 'Invite a friend',
    hint: 'Your friend gets the invite right in the game – no need to send the code.',
    invite: 'Invite',
    sent: 'Invited ✓',
    notFriends: 'No longer friends',
    failed: 'Failed',
    none: 'No friends yet – add them in your account at the top right.',
    loading: 'Loading friends…',
  },
);

/** Seznam kamarádů s tlačítkem „Pozvat“ (pozvánka nese kód této místnosti). */
function inviteSection(o: InviteOptions): HTMLElement {
  const list = h('ul', { class: 'friend-list' }, h('li', null, it.loading));
  const send = (friend: Friend, b: HTMLButtonElement): void => {
    b.disabled = true;
    o.send(friend).then(
      (result) => setText(b, result === 'sent' ? it.sent : it.notFriends),
      () => {
        b.disabled = false;
        setText(b, it.failed);
      },
    );
  };
  o.friends().then(
    (friends) => {
      if (friends.length === 0) {
        list.replaceChildren(h('li', { class: 'field-hint' }, it.none));
        return;
      }
      list.replaceChildren(
        ...friends.map((friend) => {
          const b = button(it.invite, () => send(friend, b), 'btn btn-small');
          if (o.auto?.id === friend.id) send(friend, b);
          return h(
            'li',
            { class: 'friend-row' },
            h('span', { class: 'friend-name' }, formatHandle(friend)),
            h('span', { class: 'friend-actions' }, b),
          );
        }),
      );
    },
    () => list.replaceChildren(h('li', { class: 'field-error' }, it.failed)),
  );
  return h(
    'section',
    { class: 'card stack' },
    h('h2', { class: 'friends-title' }, it.title),
    h('p', { class: 'field-hint' }, it.hint),
    list,
  );
}

export function waitingScreen(o: WaitingOptions): Mount {
  return (root) => {
    const linkInput = h('input', {
      type: 'text',
      readonly: true,
      value: o.link,
      class: 'link-input',
      'aria-label': t.roomLink,
      onfocus: (event: FocusEvent) => (event.currentTarget as HTMLInputElement).select(),
    });
    const copyStatus = h('span', { class: 'copy-status', 'aria-live': 'polite' });
    const copy = async (): Promise<void> => {
      try {
        await navigator.clipboard.writeText(o.link);
        setText(copyStatus, t.copied);
      } catch {
        linkInput.focus();
        linkInput.select();
        setText(copyStatus, t.copyManually);
      }
    };
    root.append(
      h(
        'main',
        { class: 'screen screen--narrow' },
        h('p', { class: 'kicker' }, t.hostKicker),
        h('h1', { class: 'screen-title', tabindex: '-1' }, t.roomReady),
        h(
          'section',
          { class: 'card stack room-card' },
          h('p', { class: 'field-label' }, t.roomCode),
          h(
            'p',
            { class: 'room-code', 'aria-label': t.roomCodeSpelled(o.code.split('').join(' ')) },
            o.code,
          ),
          h('p', { class: 'field-label' }, t.orLink),
          h(
            'div',
            { class: 'link-row' },
            linkInput,
            button(t.copy, () => void copy(), 'btn', { 'data-autofocus': true }),
          ),
          copyStatus,
        ),
        h(
          'p',
          { class: 'waiting', role: 'status' },
          h('span', { class: 'pulse', 'aria-hidden': 'true' }),
          t.waiting,
        ),
        o.invite ? inviteSection(o.invite) : null,
        h('p', { class: 'note' }, t.format(formatTitle(o.format))),
        button(t.cancelRoom, o.onCancel, 'btn btn-ghost'),
      ),
    );
  };
}

interface LobbyOptions {
  readonly isHost: boolean;
  readonly names: PerPlayer<string>;
  readonly format: MatchFormat;
  /** null = ještě se losuje společný seed. */
  readonly plan: MatchPlan | null;
  /** Kontrolní kód spojení (stejný u obou hráčů, pokud se mezi ně nikdo nevložil). */
  readonly check: string | null;
  readonly onStart: () => void;
  readonly onLeave: () => void;
}

export function lobbyScreen(o: LobbyOptions): Mount {
  return (root) => {
    let action: HTMLElement;
    if (!o.plan) {
      action = h(
        'p',
        { class: 'waiting', role: 'status' },
        h('span', { class: 'pulse', 'aria-hidden': 'true' }),
        t.seeding,
      );
    } else if (o.isHost) {
      action = button(t.start, o.onStart, 'btn btn-primary btn-lg', { 'data-autofocus': true });
    } else {
      action = h(
        'p',
        { class: 'waiting', role: 'status' },
        h('span', { class: 'pulse', 'aria-hidden': 'true' }),
        t.waitingHost,
      );
    }
    root.append(
      h(
        'main',
        { class: 'screen' },
        h('p', { class: 'kicker' }, t.lobbyKicker(o.isHost)),
        h('h1', { class: 'screen-title', tabindex: '-1' }, formatTitle(o.format)),
        versus(o.names),
        o.plan ? h('p', { class: 'lead' }, bestOfLead(o.plan)) : null,
        o.plan ? slotList(o.plan) : null,
        h('p', { class: 'note' }, RULES_NOTE),
        h('p', { class: 'note' }, t.seedNote),
        o.check
          ? h(
              'p',
              { class: 'note check-code' },
              `${t.checkCode}: `,
              h('strong', { class: 'check-digits' }, o.check),
              `. ${t.checkNote}`,
            )
          : null,
        h('div', { class: 'actions' }, button(t.leave, o.onLeave, 'btn btn-ghost'), action),
      ),
    );
  };
}

export interface MessageAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly primary?: boolean;
}

export function messageScreen(
  title: string,
  text: string,
  actions: readonly MessageAction[],
): Mount {
  return (root) => {
    root.append(
      h(
        'main',
        { class: 'screen screen--narrow screen--center' },
        h('h1', { class: 'screen-title', tabindex: '-1' }, title),
        h('p', { class: 'lead' }, text),
        h(
          'div',
          { class: 'actions' },
          actions.map((a, i) =>
            button(a.label, a.onClick, a.primary ? 'btn btn-primary btn-lg' : 'btn btn-lg', {
              'data-autofocus': i === 0,
            }),
          ),
        ),
      ),
    );
  };
}
