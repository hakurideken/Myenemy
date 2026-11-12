import { translations } from '../../i18n';
import { formatHandle } from '../../net/account';
import type { Friend, TournamentInvite } from '../../net/friends';
import {
  eliminated,
  entrantName,
  myReadyMatch,
  normalizeTournamentCode,
  placements,
  playerAt,
  TOURNAMENT_MAX_PLAYERS,
  type JoinResult,
  type StartResult,
  type TournamentInviteResult,
  type TournamentState,
} from '../../net/tournament';
import type { App, Mount } from '../App';
import { AI_LABEL, bracketView } from '../components/bracket';
import { button } from '../components/common';
import { append, h, setText, type Child } from '../dom';
import { accountErrorText, openAccountDialog } from './account';

const t = translations(
  {
    kicker: 'Turnaj',
    title: 'Turnaj',
    lobbyTitle: 'Lobby turnaje',
    runningTitle: 'Turnaj běží',
    finishedTitle: 'Turnaj skončil',
    lead: 'Vyřazovací pavouk až pro 16 hráčů. Každý zápas je na 9 her (vyhrává, kdo dřív vyhraje 5). Volná místa doplní AI (střední obtížnost), hraje se i o 3. místo.',
    signIn: 'Turnaje jsou jen pro přihlášené hráče.',
    signInButton: 'Přihlásit se',
    loading: 'Načítám turnaj…',
    offline: 'Spojení se serverem vypadlo – zkouším to znovu…',
    createTitle: 'Založit turnaj',
    createNote: 'Dostaneš kód, který pošleš kamarádům (nebo je pozveš přímo).',
    create: 'Založit turnaj',
    joinTitle: 'Připojit se kódem',
    codeLabel: 'Kód turnaje',
    codeHint: '6 znaků, třeba K7PX2M.',
    badCode: 'Kód má 6 znaků (písmena a číslice).',
    join: 'Připojit se',
    joinResult: {
      joined: '',
      'not-found': 'Turnaj s tímhle kódem neexistuje.',
      started: 'Turnaj už začal – připojit se nejde.',
      full: 'Turnaj je plný (16 hráčů).',
      busy: 'Už jsi v jiném turnaji.',
      'no-profile': 'Nejdřív si zvol přezdívku.',
    } satisfies Record<JoinResult, string>,
    invitesTitle: 'Pozvánky do turnaje',
    inviteFrom: (handle: string) => `od ${handle}`,
    acceptInvite: 'Připojit se',
    code: 'Kód turnaje',
    copy: 'Kopírovat',
    copied: 'Zkopírováno.',
    players: (n: number) => `Hráči (${n} / ${TOURNAMENT_MAX_PLAYERS})`,
    fill: (n: number, size: number) =>
      n < 2
        ? 'Turnaj jde spustit, až budou aspoň 2 hráči.'
        : size - n > 0
          ? `Po spuštění se pavouk pro ${size} doplní ${size - n}× AI (střední).`
          : `Pavouk pro ${size} hráčů je plný.`,
    organizer: 'organizátor',
    you: 'ty',
    inviteTitle: 'Pozvat kamarády',
    inviteHint: 'Kamarád dostane pozvánku přímo ve hře.',
    invite: 'Pozvat',
    invited: 'Pozváno ✓',
    noFriends: 'Zatím nemáš kamarády – pošli jim kód turnaje.',
    inviteResult: {
      sent: 'Pozváno ✓',
      'not-friends': 'Už nejste kamarádi.',
      'not-lobby': 'Turnaj už začal.',
    } satisfies Record<TournamentInviteResult, string>,
    start: 'Spustit turnaj',
    startResult: {
      started: '',
      'not-organizer': 'Spustit může jen organizátor.',
      'too-few': 'Jsou potřeba aspoň 2 hráči.',
      'not-lobby': 'Turnaj už běží.',
    } satisfies Record<StartResult, string>,
    waitStart: 'Čekáme, až organizátor turnaj spustí…',
    cancel: 'Zrušit turnaj',
    cancelTitle: 'Zrušit turnaj?',
    cancelText: 'Všichni hráči z lobby budou odhlášeni.',
    leaveLobby: 'Odejít z lobby',
    leave: 'Odejít z turnaje',
    leaveTitle: 'Odejít z turnaje?',
    leaveText: 'Zbývající zápasy prohraješ kontumací.',
    yourMatch: 'Tvůj zápas',
    vsAi: (name: string) => `Hraješ proti ${name} (střední obtížnost) – 9 her, vyhrává kdo dřív 5.`,
    vsHuman: (name: string) => `Hraješ proti ${name} – 9 her, vyhrává kdo dřív 5.`,
    play: 'Hrát zápas',
    host: 'Za chvíli se otevře místnost, soupeř se připojí sám.',
    hostAgain: 'Založit zápas',
    guestWait: (name: string) => `Čekám, až ${name} založí zápas…`,
    guestJoin: 'Připojit se k zápasu',
    guestHost: 'Soupeř zápas nezaložil – můžeš ho založit sám, soupeř se připojí.',
    oppOffline: 'Soupeř teď není ve hře. Když se do 3 minut neozve, postupuješ kontumací.',
    reported: 'Výsledek je nahlášený. Čekám, až ho potvrdí soupeř (nejdéle 3 minuty).',
    replay: 'Nahlášené výsledky se neshodovaly – zápas se hraje znovu.',
    waitNext: 'Čekáš, až se dohraje zápas, ze kterého přijde tvůj další soupeř.',
    out: 'Vypadl jsi. Pavouka můžeš sledovat dál.',
    gone: 'Z turnaje jsi odešel.',
    podium: 'Pořadí',
    places: ['🥇 1.', '🥈 2.', '🥉 3.'],
    youWon: '🏆 Vyhrál jsi turnaj!',
    close: 'Zavřít turnaj',
    menu: 'Do menu',
    stayHint:
      'Nech tuhle stránku otevřenou – kdo se 3 minuty neozve, prohraje svůj zápas kontumací.',
  },
  {
    kicker: 'Tournament',
    title: 'Tournament',
    lobbyTitle: 'Tournament lobby',
    runningTitle: 'Tournament in progress',
    finishedTitle: 'Tournament over',
    lead: 'A knockout bracket for up to 16 players. Every match is 9 games (first to win 5). Empty spots are filled with AI (medium difficulty), and there is a third-place match.',
    signIn: 'Tournaments are for signed-in players only.',
    signInButton: 'Sign in',
    loading: 'Loading the tournament…',
    offline: 'Lost the connection to the server – retrying…',
    createTitle: 'Create a tournament',
    createNote: 'You get a code to send to friends (or invite them directly).',
    create: 'Create tournament',
    joinTitle: 'Join with a code',
    codeLabel: 'Tournament code',
    codeHint: '6 characters, e.g. K7PX2M.',
    badCode: 'The code has 6 characters (letters and digits).',
    join: 'Join',
    joinResult: {
      joined: '',
      'not-found': 'No tournament with this code exists.',
      started: 'The tournament has already started.',
      full: 'The tournament is full (16 players).',
      busy: 'You are already in another tournament.',
      'no-profile': 'Pick a nickname first.',
    } satisfies Record<JoinResult, string>,
    invitesTitle: 'Tournament invites',
    inviteFrom: (handle: string) => `from ${handle}`,
    acceptInvite: 'Join',
    code: 'Tournament code',
    copy: 'Copy',
    copied: 'Copied.',
    players: (n: number) => `Players (${n} / ${TOURNAMENT_MAX_PLAYERS})`,
    fill: (n: number, size: number) =>
      n < 2
        ? 'The tournament can start once there are at least 2 players.'
        : size - n > 0
          ? `On start, the bracket of ${size} is filled with ${size - n} AI (medium).`
          : `The bracket of ${size} players is full.`,
    organizer: 'organizer',
    you: 'you',
    inviteTitle: 'Invite friends',
    inviteHint: 'Your friend gets the invite right in the game.',
    invite: 'Invite',
    invited: 'Invited ✓',
    noFriends: 'No friends yet – send them the tournament code.',
    inviteResult: {
      sent: 'Invited ✓',
      'not-friends': 'You are no longer friends.',
      'not-lobby': 'The tournament has started.',
    } satisfies Record<TournamentInviteResult, string>,
    start: 'Start tournament',
    startResult: {
      started: '',
      'not-organizer': 'Only the organizer can start it.',
      'too-few': 'At least 2 players are needed.',
      'not-lobby': 'The tournament is already running.',
    } satisfies Record<StartResult, string>,
    waitStart: 'Waiting for the organizer to start the tournament…',
    cancel: 'Cancel tournament',
    cancelTitle: 'Cancel the tournament?',
    cancelText: 'All players will be removed from the lobby.',
    leaveLobby: 'Leave the lobby',
    leave: 'Leave the tournament',
    leaveTitle: 'Leave the tournament?',
    leaveText: 'You lose your remaining matches by forfeit.',
    yourMatch: 'Your match',
    vsAi: (name: string) => `You play ${name} (medium difficulty) – 9 games, first to 5 wins.`,
    vsHuman: (name: string) => `You play ${name} – 9 games, first to 5 wins.`,
    play: 'Play the match',
    host: 'A room opens in a moment; your opponent joins automatically.',
    hostAgain: 'Open the match',
    guestWait: (name: string) => `Waiting for ${name} to open the match…`,
    guestJoin: 'Join the match',
    guestHost:
      'Your opponent has not opened the match – you can open it yourself and they will join.',
    oppOffline:
      'Your opponent is not in the game. If they stay silent for 3 minutes, you advance by forfeit.',
    reported: 'Result reported. Waiting for your opponent to confirm it (3 minutes at most).',
    replay: 'The reported results did not match – the match is replayed.',
    waitNext: 'Waiting for the match that decides your next opponent.',
    out: 'You are out. You can keep watching the bracket.',
    gone: 'You left the tournament.',
    podium: 'Standings',
    places: ['🥇 1st', '🥈 2nd', '🥉 3rd'],
    youWon: '🏆 You won the tournament!',
    close: 'Close tournament',
    menu: 'Menu',
    stayHint: 'Keep this page open – anyone silent for 3 minutes loses their match by forfeit.',
  },
);

/** Velikost pavouka podle počtu hráčů v lobby. */
function bracketSize(players: number): number {
  return players <= 4 ? 4 : players <= 8 ? 8 : 16;
}

export function tournamentScreen(app: App): Mount {
  return (root) => {
    const flow = app.tournament;
    const main = h('main', { class: 'screen screen--tournament' });
    const body = h('div', { class: 'stack' });
    root.append(main);
    let alive = true;
    /** Stav, který přežije překreslení (pozvaní kamarádi, chyby). */
    let friends: Friend[] | null = null;
    const invited = new Set<string>();

    const status = h('p', { class: 'field-error', 'aria-live': 'polite' });
    const fail = (err: unknown): void => setText(status, accountErrorText(err));

    const heading = (title: string): Child[] => [
      h('p', { class: 'kicker' }, t.kicker),
      h('h1', { class: 'screen-title', tabindex: '-1' }, title),
    ];

    // ---------- Bez turnaje: založit / připojit se ----------

    const invitesBox = h('div');
    const renderInvites = (): void => {
      const state = app.account.state;
      const list: readonly TournamentInvite[] =
        state.kind === 'signed-in' ? state.tournamentInvites : [];
      invitesBox.replaceChildren(
        list.length === 0
          ? ''
          : h(
              'section',
              { class: 'card' },
              h('h2', { class: 'friends-title' }, t.invitesTitle),
              h(
                'ul',
                { class: 'friend-list' },
                list.map((inv) =>
                  h(
                    'li',
                    { class: 'friend-row' },
                    h(
                      'span',
                      { class: 'friend-name' },
                      inv.code,
                      ' ',
                      h('span', { class: 'friend-status' }, t.inviteFrom(formatHandle(inv))),
                    ),
                    h(
                      'span',
                      { class: 'friend-actions' },
                      button(
                        t.acceptInvite,
                        () => void joinCode(inv.code),
                        'btn btn-primary btn-small',
                      ),
                    ),
                  ),
                ),
              ),
            ),
      );
    };

    const joinCode = async (code: string): Promise<void> => {
      setText(status, '');
      try {
        const result = await flow.join(code);
        if (result !== 'joined') setText(status, t.joinResult[result]);
      } catch (err) {
        fail(err);
      }
    };

    function homeView(): Child[] {
      const input = h('input', {
        id: 'tournament-code',
        type: 'text',
        maxlength: 8,
        autocomplete: 'off',
        autocapitalize: 'characters',
        spellcheck: 'false',
        class: 'code-input',
        'aria-describedby': 'tournament-code-hint',
      });
      const createButton = button(
        t.create,
        () => {
          createButton.disabled = true;
          setText(status, '');
          flow.create().then(
            (r) => {
              createButton.disabled = false;
              if (r.kind === 'busy') setText(status, t.joinResult.busy);
              if (r.kind === 'no-profile') setText(status, t.joinResult['no-profile']);
            },
            (err: unknown) => {
              createButton.disabled = false;
              fail(err);
            },
          );
        },
        'btn btn-primary btn-lg',
        { 'data-autofocus': true },
      );
      renderInvites();
      return [
        ...heading(t.title),
        h('p', { class: 'lead' }, t.lead),
        invitesBox,
        h(
          'section',
          { class: 'card stack' },
          h('h2', { class: 'card-title' }, t.createTitle),
          h('p', { class: 'note' }, t.createNote),
          createButton,
        ),
        h(
          'form',
          {
            class: 'card form',
            novalidate: true,
            onsubmit: (event: SubmitEvent) => {
              event.preventDefault();
              const code = normalizeTournamentCode(input.value);
              if (!code) {
                setText(status, t.badCode);
                input.focus();
                return;
              }
              void joinCode(code);
            },
          },
          h('h2', { class: 'card-title' }, t.joinTitle),
          h('label', { for: 'tournament-code', class: 'field-label' }, t.codeLabel),
          input,
          h('p', { id: 'tournament-code-hint', class: 'field-hint' }, t.codeHint),
          h('button', { type: 'submit', class: 'btn btn-lg' }, t.join),
        ),
        status,
        button(t.menu, () => app.goMenu(), 'btn btn-ghost'),
      ];
    }

    // ---------- Lobby ----------

    const loadFriends = (): void => {
      if (friends !== null) return;
      friends = [];
      app.account.friends().then(
        (list) => {
          friends = list;
          if (alive) render(true);
        },
        () => {
          friends = null;
        },
      );
    };

    function lobbyView(s: TournamentState): Child[] {
      const humans = s.players.length;
      const copyStatus = h('span', { class: 'copy-status', 'aria-live': 'polite' });
      const inLobby = new Set(s.players.map((p) => `${p.nickname}#${p.tag}`));
      loadFriends();
      const friendRows = (friends ?? [])
        .filter((f) => !inLobby.has(`${f.nickname}#${f.tag}`))
        .map((f) => {
          const b = button(
            invited.has(f.id) ? t.invited : t.invite,
            () => {
              b.disabled = true;
              flow.api.invite(f.id).then(
                (r) => {
                  if (r === 'sent') invited.add(f.id);
                  setText(b, t.inviteResult[r]);
                },
                (err: unknown) => {
                  b.disabled = false;
                  fail(err);
                },
              );
            },
            f.status === 'online' ? 'btn btn-primary btn-small' : 'btn btn-small',
            { disabled: invited.has(f.id) },
          );
          return h(
            'li',
            { class: 'friend-row' },
            h(
              'span',
              { class: 'friend-name' },
              h('span', { class: `friend-dot friend-dot--${f.status}`, 'aria-hidden': 'true' }),
              formatHandle(f),
            ),
            h('span', { class: 'friend-actions' }, b),
          );
        });

      const startButton = button(
        t.start,
        () => {
          startButton.disabled = true;
          flow.start().then(
            (r) => {
              startButton.disabled = false;
              if (r !== 'started') setText(status, t.startResult[r]);
            },
            (err: unknown) => {
              startButton.disabled = false;
              fail(err);
            },
          );
        },
        'btn btn-primary btn-lg',
        { disabled: humans < 2, 'data-autofocus': true },
      );

      return [
        ...heading(t.lobbyTitle),
        h(
          'section',
          { class: 'card stack room-card' },
          h('p', { class: 'field-label' }, t.code),
          h('p', { class: 'room-code' }, s.code),
          h(
            'div',
            { class: 'link-row' },
            button(t.copy, () => {
              navigator.clipboard
                .writeText(s.code)
                .then(() => setText(copyStatus, t.copied))
                .catch(() => undefined);
            }),
            copyStatus,
          ),
        ),
        h(
          'section',
          { class: 'card' },
          h('h2', { class: 'friends-title' }, t.players(humans)),
          h(
            'ul',
            { class: 'friend-list' },
            s.players.map((p) =>
              h(
                'li',
                { class: 'friend-row' },
                h(
                  'span',
                  { class: 'friend-name' },
                  h('span', {
                    class: `friend-dot friend-dot--${p.online ? 'online' : 'offline'}`,
                    'aria-hidden': 'true',
                  }),
                  p.tag > 0 ? formatHandle(p) : p.nickname,
                  p.organizer ? h('span', { class: 'friend-status' }, t.organizer) : '',
                  p.me ? h('span', { class: 'friend-status friend-status--online' }, t.you) : '',
                ),
              ),
            ),
          ),
          h('p', { class: 'field-hint' }, t.fill(humans, bracketSize(humans))),
        ),
        h(
          'section',
          { class: 'card' },
          h('h2', { class: 'friends-title' }, t.inviteTitle),
          h('p', { class: 'field-hint' }, t.inviteHint),
          friendRows.length > 0
            ? h('ul', { class: 'friend-list' }, friendRows)
            : h(
                'p',
                { class: 'field-hint' },
                friends === null || friends.length > 0 ? '' : t.noFriends,
              ),
        ),
        status,
        s.organizer
          ? h(
              'div',
              { class: 'actions' },
              startButton,
              button(
                t.cancel,
                () => void confirmLeave(t.cancelTitle, t.cancelText),
                'btn btn-ghost',
              ),
            )
          : h(
              'div',
              { class: 'stack' },
              h(
                'p',
                { class: 'waiting', role: 'status' },
                h('span', { class: 'pulse', 'aria-hidden': 'true' }),
                t.waitStart,
              ),
              button(t.leaveLobby, () => void leaveNow(), 'btn btn-ghost'),
            ),
        button(t.menu, () => app.goMenu(), 'btn btn-ghost'),
      ];
    }

    // ---------- Běžící a dohraný turnaj ----------

    function myMatchCard(s: TournamentState): HTMLElement {
      const me = s.me;
      const card = h(
        'section',
        { class: 'card stack tournament-status' },
        h('h2', { class: 'card-title' }, t.yourMatch),
      );
      const mePlayer = playerAt(s, me);
      if (me === null || mePlayer?.gone) {
        card.append(h('p', null, t.gone));
        return card;
      }
      const m = myReadyMatch(s);
      if (!m) {
        card.append(h('p', null, eliminated(s, me) ? t.out : t.waitNext));
        return card;
      }
      const opp = flow.opponent(m);
      const name = entrantName(opp, AI_LABEL);
      if (m.replays > 0 && !m.reported) card.append(h('p', { class: 'note' }, t.replay));
      if (m.reported) {
        card.append(
          h(
            'p',
            { class: 'waiting', role: 'status' },
            h('span', { class: 'pulse', 'aria-hidden': 'true' }),
            t.reported,
          ),
        );
        return card;
      }
      if (opp?.ai) {
        card.append(
          h('p', null, t.vsAi(name)),
          button(t.play, () => flow.play(), 'btn btn-primary btn-lg', { 'data-autofocus': true }),
        );
        return card;
      }
      card.append(h('p', null, t.vsHuman(name)));
      if (opp && !opp.online) card.append(h('p', { class: 'note' }, t.oppOffline));
      if (flow.canJoin(m)) {
        card.append(button(t.guestJoin, () => flow.play(), 'btn btn-primary btn-lg'));
      } else if (m.a === me) {
        card.append(
          h('p', { class: 'note' }, t.host),
          button(t.hostAgain, () => flow.play(), 'btn btn-primary'),
        );
      } else if (flow.canHost(m)) {
        card.append(
          h('p', { class: 'note' }, t.guestHost),
          button(t.hostAgain, () => flow.play(), 'btn btn-primary'),
        );
      } else {
        card.append(
          h(
            'p',
            { class: 'waiting', role: 'status' },
            h('span', { class: 'pulse', 'aria-hidden': 'true' }),
            t.guestWait(name),
          ),
        );
      }
      return card;
    }

    function runningView(s: TournamentState): Child[] {
      return [
        ...heading(t.runningTitle),
        myMatchCard(s),
        flow.lastReport === 'replay' ? h('p', { class: 'note' }, t.replay) : '',
        bracketView(s),
        h('p', { class: 'field-hint' }, t.stayHint),
        status,
        h(
          'div',
          { class: 'actions' },
          button(t.menu, () => app.goMenu(), 'btn btn-ghost'),
          s.me !== null && !playerAt(s, s.me)?.gone
            ? button(t.leave, () => void confirmLeave(t.leaveTitle, t.leaveText), 'btn btn-ghost')
            : button(t.close, () => void leaveNow(), 'btn btn-ghost'),
        ),
      ];
    }

    function finishedView(s: TournamentState): Child[] {
      const place = placements(s);
      const slots = [place.first, place.second, place.third];
      return [
        ...heading(t.finishedTitle),
        place.first !== null && place.first === s.me
          ? h('p', { class: 'lead tournament-win' }, t.youWon)
          : '',
        h(
          'section',
          { class: 'card' },
          h('h2', { class: 'friends-title' }, t.podium),
          h(
            'ol',
            { class: 'friend-list tournament-podium' },
            slots.map((slot, i) =>
              h(
                'li',
                { class: playerAt(s, slot)?.me ? 'friend-row is-me' : 'friend-row' },
                h(
                  'span',
                  { class: 'friend-name' },
                  `${t.places[i] ?? ''} `,
                  entrantName(playerAt(s, slot), AI_LABEL),
                ),
              ),
            ),
          ),
        ),
        bracketView(s),
        status,
        h(
          'div',
          { class: 'actions' },
          button(t.close, () => void leaveNow(), 'btn btn-primary', { 'data-autofocus': true }),
          button(t.menu, () => app.goMenu(), 'btn btn-ghost'),
        ),
      ];
    }

    const leaveNow = async (): Promise<void> => {
      try {
        await flow.leave();
      } catch (err) {
        fail(err);
      }
    };

    const confirmLeave = async (title: string, text: string): Promise<void> => {
      const ok = await app.confirm({ title, message: text, confirm: title.replace(/\?$/, '') });
      if (ok && alive) await leaveNow();
    };

    // ---------- Vykreslení ----------

    let lastKind = '';
    function render(force = false): void {
      if (!alive) return;
      const account = app.account.state;
      let kind: string;
      let parts: Child[];
      const s = flow.state;
      if (
        account.kind === 'loading' ||
        (account.kind === 'signed-in' && account.profile && s === undefined)
      ) {
        kind = 'loading';
        parts = [...heading(t.title), h('p', null, t.loading)];
      } else if (account.kind !== 'signed-in' || !account.profile) {
        kind = 'signin';
        parts = [
          ...heading(t.title),
          h('p', { class: 'lead' }, t.lead),
          h('p', null, t.signIn),
          account.kind === 'unavailable'
            ? ''
            : button(t.signInButton, () => openAccountDialog(app), 'btn btn-primary btn-lg', {
                'data-autofocus': true,
              }),
          button(t.menu, () => app.goMenu(), 'btn btn-ghost'),
        ];
      } else if (!s) {
        kind = 'home';
        // Domovská obrazovka se nepřekresluje (rozepsaný kód), pozvánky se obnovují zvlášť.
        if (lastKind === 'home' && !force && !flow.offline) return;
        parts = homeView();
      } else {
        kind = s.status;
        parts =
          s.status === 'lobby'
            ? lobbyView(s)
            : s.status === 'running'
              ? runningView(s)
              : finishedView(s);
      }
      const offline = flow.offline ? h('p', { class: 'note', role: 'status' }, t.offline) : '';
      const scrollY = window.scrollY;
      body.replaceChildren();
      append(body, offline, ...parts);
      if (kind !== lastKind) {
        // Nový druh obrazovky: fokus na nadpis (nebo hlavní tlačítko).
        const target =
          body.querySelector<HTMLElement>('[data-autofocus]') ??
          body.querySelector<HTMLElement>('h1');
        target?.focus({ preventScroll: true });
        window.scrollTo(0, 0);
      } else {
        // Jen obnova stavu: neskákat.
        window.scrollTo(0, scrollY);
      }
      lastKind = kind;
    }

    main.append(body);
    render();
    const offFlow = flow.onChange(() => render());
    const offAccount = app.account.onChange(() => {
      renderInvites();
      render();
    });
    flow.enterScreen();
    return () => {
      alive = false;
      offFlow();
      offAccount();
      flow.leaveScreen();
    };
  };
}
