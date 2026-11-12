import { translations } from '../../i18n';
import { formatHandle } from '../../net/account';
import type { GameInvite, TournamentInvite } from '../../net/friends';
import { h } from '../dom';
import { button } from './common';

const t = translations(
  {
    invites: 'Pozvánka do hry',
    from: (handle: string) => `${handle} tě zve do hry.`,
    tournamentFrom: (handle: string) => `${handle} tě zve do turnaje.`,
    matchReady: 'Tvůj turnajový zápas je připravený – soupeř čeká.',
    accept: 'Přijmout',
    decline: 'Odmítnout',
    open: 'Přejít na turnaj',
    more: (n: number) => `+${n} další`,
  },
  {
    invites: 'Game invite',
    from: (handle: string) => `${handle} invites you to a game.`,
    tournamentFrom: (handle: string) => `${handle} invites you to a tournament.`,
    matchReady: 'Your tournament match is ready – your opponent is waiting.',
    accept: 'Accept',
    decline: 'Decline',
    open: 'Go to the tournament',
    more: (n: number) => `+${n} more`,
  },
);

export interface ToastContent {
  readonly games: readonly GameInvite[];
  readonly tournaments: readonly TournamentInvite[];
  /** Můj turnajový zápas je připravený (a nejsem na obrazovce turnaje). */
  readonly matchReady: boolean;
  /** false = rozehraný zápas nebo online místnost – nic neukazovat. */
  readonly visible: boolean;
}

export interface InviteToast {
  readonly el: HTMLElement;
  /** Ukáže to nejdůležitější: připravený zápas, pak nejnovější pozvánku (nebo nic). */
  update(content: ToastContent): void;
}

export interface InviteToastHandlers {
  readonly acceptGame: (invite: GameInvite) => void;
  readonly declineGame: (invite: GameInvite) => void;
  readonly acceptTournament: (invite: TournamentInvite) => void;
  readonly declineTournament: (invite: TournamentInvite) => void;
  readonly openTournament: () => void;
}

/** Upozornění na pozvánku nebo turnajový zápas (dole na obrazovce, mimo rozehraný zápas). */
export function createInviteToast(handlers: InviteToastHandlers): InviteToast {
  const el = h('section', { class: 'invite-toast', 'aria-label': t.invites, hidden: true });
  let shown: string | null = null;

  const render = (key: string, text: string, more: number, actions: HTMLElement[]): void => {
    const fullKey = `${key}|${more}`;
    if (shown === fullKey) return;
    const fresh = shown === null || !shown.startsWith(`${key}|`);
    shown = fullKey;
    el.replaceChildren(
      h(
        'p',
        { class: 'invite-text', role: 'status' },
        text,
        more > 0 ? h('span', { class: 'invite-more' }, ` ${t.more(more)}`) : '',
      ),
      h('div', { class: 'invite-actions' }, actions),
    );
    if (fresh) {
      // Nové upozornění – krátce zvýraznit (animace se spustí znovu).
      el.classList.remove('is-new');
      void el.offsetWidth;
      el.classList.add('is-new');
    }
  };

  return {
    el,
    update({ games, tournaments, matchReady, visible }) {
      const game = games[0];
      const tournament = tournaments[0];
      el.hidden = !visible || (!matchReady && !game && !tournament);
      if (el.hidden) {
        shown = null;
        return;
      }
      const more = games.length + tournaments.length - 1;
      if (matchReady) {
        render('match', t.matchReady, 0, [
          button(t.open, handlers.openTournament, 'btn btn-primary btn-small'),
        ]);
      } else if (game) {
        render(`g:${game.id}`, t.from(formatHandle(game)), more, [
          button(t.accept, () => handlers.acceptGame(game), 'btn btn-primary btn-small'),
          button(t.decline, () => handlers.declineGame(game), 'btn btn-ghost btn-small'),
        ]);
      } else if (tournament) {
        render(`t:${tournament.id}`, t.tournamentFrom(formatHandle(tournament)), more, [
          button(
            t.accept,
            () => handlers.acceptTournament(tournament),
            'btn btn-primary btn-small',
          ),
          button(
            t.decline,
            () => handlers.declineTournament(tournament),
            'btn btn-ghost btn-small',
          ),
        ]);
      }
    },
  };
}
