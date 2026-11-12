import type { MatchFormat } from '../core/match/planMatch';
import type { Sfx } from '../core/MiniGame';
import { systemClock } from '../core/util/clock';
import { getGame } from '../games/registry';
import { translations } from '../i18n';
import {
  generateRoomCode,
  HostRoom,
  joinRoom,
  newClientId,
  PairingError,
  roomLink,
  type Identity,
  type Pairing,
} from '../net/room';
import type { Transport, TransportFactory } from '../net/Transport';
import { OnlineSession, type CloseReason, type OnlinePhase } from '../online/OnlineSession';
import type { App, Mount } from './App';
import { connectionBanner } from './components/banner';
import { gameScreen } from './screens/game';
import { gameIntroScreen } from './screens/gameIntro';
import { matchResultScreen } from './screens/matchResult';
import {
  connectingScreen,
  lobbyScreen,
  messageScreen,
  waitingScreen,
  type InviteOptions,
} from './screens/online';
import { roundResultScreen } from './screens/roundResult';
import type { TournamentLink } from './TournamentFlow';
import { TOURNAMENT_FORMAT } from '../net/tournament';
import { otherPlayer, type PerPlayer, type PlayerSlot } from '../core/types';

const SILENT: Sfx = { play: () => undefined, vibrate: () => undefined };

type CloseText = Record<Exclude<CloseReason, 'me-left'>, { title: string; text: string }>;

const t = translations(
  {
    close: {
      'opponent-left': {
        title: 'Soupeř odešel',
        text: 'Soupeř opustil místnost dřív, než zápas začal.',
      },
      'opponent-gone': {
        title: 'Spojení ztraceno',
        text: 'Se soupeřem se nepodařilo udržet spojení.',
      },
      version: {
        title: 'Jiná verze hry',
        text: 'Soupeř má jinou verzi hry – obnovte stránku (oba) a zkuste to znovu.',
      },
      cheat: {
        title: 'Nesoulad dat',
        text: 'Data od soupeře nesouhlasí s tím, k čemu se zavázal. Zápas byl ukončen.',
      },
    },
    player: 'Hráč',
    creating: 'Zakládám místnost…',
    joining: (code: string) => `Připojuji se do místnosti ${code}…`,
    fullTitle: 'Místnost je plná',
    notFoundTitle: 'Místnost nenalezena',
    fullText: 'V místnosti už hrají dva hráči.',
    notFoundText: (code: string) =>
      `Místnost ${code} neexistuje nebo hostitel neodpovídá. Zkontroluj kód.`,
    otherCode: 'Zkusit jiný kód',
    menu: 'Do menu',
    unavailableTitle: 'Online server je nedostupný',
    unavailableText:
      'Nepodařilo se spojit se serverem do 5 sekund – může být dočasně mimo provoz nebo uspaný. Zkus to za chvíli znovu, nebo si zahraj proti AI.',
    retry: 'Zkusit znovu',
    vsAi: 'Proti AI',
    leaveTitle: 'Odejít ze zápasu?',
    leaveText: 'Soupeř vyhraje kontumací.',
    leaveTournamentText: 'Prohraješ tento turnajový zápas kontumací a soupeř postoupí.',
    leave: 'Odejít',
    backTournament: 'Zpět na turnaj',
  },
  {
    close: {
      'opponent-left': {
        title: 'Your opponent left',
        text: 'Your opponent left the room before the match started.',
      },
      'opponent-gone': {
        title: 'Connection lost',
        text: 'The connection to your opponent could not be kept up.',
      },
      version: {
        title: 'Different game version',
        text: 'Your opponent has a different version of the game – both of you reload the page and try again.',
      },
      cheat: {
        title: 'Data mismatch',
        text: 'Your opponent’s data do not match what they committed to. The match was ended.',
      },
    },
    player: 'Player',
    creating: 'Creating a room…',
    joining: (code: string) => `Joining room ${code}…`,
    fullTitle: 'The room is full',
    notFoundTitle: 'Room not found',
    fullText: 'Two players are already playing in this room.',
    notFoundText: (code: string) =>
      `Room ${code} does not exist or the host is not responding. Check the code.`,
    otherCode: 'Try another code',
    menu: 'Menu',
    unavailableTitle: 'The online server is unavailable',
    unavailableText:
      'Could not reach the server within 5 seconds – it may be temporarily down or asleep. Try again in a moment, or play against the AI.',
    retry: 'Try again',
    vsAi: 'Against AI',
    leaveTitle: 'Leave the match?',
    leaveText: 'Your opponent wins by forfeit.',
    leaveTournamentText: 'You lose this tournament match by forfeit and your opponent advances.',
    leave: 'Leave',
    backTournament: 'Back to the tournament',
  },
);

const CLOSE_TEXT: CloseText = t.close;

/** Online zápas v UI: založení / připojení, lobby a průběh podle fází OnlineSession. */
export class OnlineFlow {
  private readonly me: Identity;
  private transport: Transport | null = null;
  private hostRoom: HostRoom | null = null;
  private session: OnlineSession | null = null;
  /** Zápas, jehož výsledek už šel do databáze (kamarádi) – jen jednou. */
  private reportedMatch: string | null = null;
  /** Místnost, do které hostitel poslal pozvánky (při zrušení se stáhnou). */
  private invitedRoom: string | null = null;
  /** Kontrolní kód spojení pro lobby. */
  private check: string | null = null;
  private disposed = false;
  private lastScreen: string | null = null;
  /** Turnaj: zápas už začal (odchod = prohra) a výsledek už šel do turnaje. */
  private tournamentStarted = false;
  private tournamentReported = false;
  private autoStartTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onPageHide = (): void => this.dispose();

  constructor(
    private readonly app: App,
    private readonly factory: TransportFactory,
    /** Turnajový zápas (výsledek jde do pavouku, návrat na turnaj, bez odvety). */
    private readonly tournament: TournamentLink | null = null,
  ) {
    this.me = { id: newClientId(), nickname: app.nickname ?? t.player };
    window.addEventListener('pagehide', this.onPageHide);
  }

  /** Místnost čeká na soupeře (zápas ještě nezačal). */
  get waitingForOpponent(): boolean {
    return !this.disposed && this.session === null;
  }

  async createRoom(format: MatchFormat): Promise<void> {
    const code = generateRoomCode();
    this.app.show(connectingScreen(t.creating, () => this.exit()));
    const transport = await this.openTransport(() => void this.createRoom(format));
    if (!transport) return;
    try {
      this.hostRoom = await HostRoom.open({
        transport,
        clock: systemClock,
        room: code,
        me: this.me,
        format,
      });
    } catch {
      this.showUnavailable(() => void this.createRoom(format));
      return;
    }
    if (this.disposed) return;
    this.hostRoom.onVersionMismatch(() => this.showClosed('version'));
    this.hostRoom.onGuest((pairing) => this.startSession('host', pairing));
    this.tournament?.roomCreated(code);
    this.app.show(
      waitingScreen({
        code,
        link: roomLink(code, window.location),
        format,
        onCancel: () => this.exit(),
        invite: this.tournament ? undefined : this.inviteOptions(code),
        tournament: this.tournament !== null,
      }),
    );
  }

  /** Přihlášený hráč s přezdívkou může zvát kamarády do právě založené místnosti. */
  private inviteOptions(code: string): InviteOptions | undefined {
    const account = this.app.account;
    const auto = this.app.takePendingInvite();
    if (account.state.kind !== 'signed-in' || !account.state.profile) return undefined;
    return {
      friends: () => account.friends(),
      send: (friend) => {
        this.invitedRoom = code;
        return account.sendGameInvite(friend.id, code);
      },
      auto,
    };
  }

  async joinRoom(code: string): Promise<void> {
    this.app.show(connectingScreen(t.joining(code), () => this.exit()));
    const transport = await this.openTransport(() => void this.joinRoom(code));
    if (!transport) return;
    let pairing: Pairing;
    try {
      pairing = await joinRoom({ transport, clock: systemClock, room: code, me: this.me });
    } catch (err) {
      if (this.disposed) return;
      const reason = err instanceof PairingError ? err.reason : 'unavailable';
      if (this.tournament && reason !== 'unavailable') {
        // Místnost soupeře už neexistuje (nebo je plná) – zpět na pavouka, soupeř založí novou.
        this.dispose();
        this.tournament.back(code);
        return;
      }
      if (reason === 'unavailable') this.showUnavailable(() => void this.joinRoom(code));
      else if (reason === 'version') this.showClosed('version');
      else {
        this.app.show(
          messageScreen(
            reason === 'full' ? t.fullTitle : t.notFoundTitle,
            reason === 'full' ? t.fullText : t.notFoundText(code),
            [
              {
                label: t.otherCode,
                onClick: () => this.exitTo(() => this.app.goOnline()),
                primary: true,
              },
              { label: t.menu, onClick: () => this.exit() },
            ],
          ),
        );
      }
      return;
    }
    if (this.disposed) {
      void pairing.peer.bye();
      return;
    }
    this.startSession('guest', pairing);
  }

  /** Odchod z online režimu (soupeř vyhraje kontumací, pokud se hrálo). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('pagehide', this.onPageHide);
    if (this.autoStartTimer !== null) clearTimeout(this.autoStartTimer);
    this.app.setBanner(null);
    // Turnaj: odchod z rozehraného zápasu = prohra kontumací (nahlásí se hned).
    const s = this.session;
    if (this.tournament && s && this.tournamentStarted && !this.tournamentReported) {
      this.reportTournament(otherPlayer(s.me), s.score);
    }
    // Odcházím z rozhodnutého zápasu dřív, než se nahlásil výsledek – nahlásit teď.
    const report = this.session?.leavingReport;
    if (report) this.reportResult(report.matchKey, report.won, 'left');
    // Místnost zaniká bez soupeře – pozvánky do ní stáhnout.
    if (!this.session && this.invitedRoom) {
      this.app.account.cancelGameInvites(this.invitedRoom).catch(() => undefined);
    }
    const leaving = this.session?.leave() ?? Promise.resolve();
    const transport = this.transport;
    const hostRoom = this.hostRoom;
    void leaving.finally(() => {
      void (hostRoom ? hostRoom.close() : transport?.close());
    });
  }

  private exit(): void {
    this.exitTo(() => this.home());
  }

  /** Kam po zápase: turnaj, nebo menu. */
  private home(): void {
    if (this.tournament) this.tournament.back();
    else this.app.goMenu();
  }

  private get menuLabel(): string {
    return this.tournament ? t.backTournament : t.menu;
  }

  /** Výsledek turnajového zápasu: hráči místnosti A/B → pozice v pavouku, skóre horní : dolní. */
  private reportTournament(winner: PlayerSlot, score: PerPlayer<number>): void {
    const link = this.tournament;
    if (!link || this.tournamentReported) return;
    this.tournamentReported = true;
    const hostOnTop = link.slots.A === link.top;
    link.finish(link.slots[winner], hostOnTop ? score.A : score.B, hostOnTop ? score.B : score.A);
  }

  private exitTo(next: () => void): void {
    this.dispose();
    next();
  }

  private async openTransport(retry: () => void): Promise<Transport | null> {
    try {
      const transport = await this.factory();
      if (this.disposed) {
        void transport.close();
        return null;
      }
      this.transport = transport;
      return transport;
    } catch {
      if (!this.disposed) this.showUnavailable(retry);
      return null;
    }
  }

  private showUnavailable(retry: () => void): void {
    void this.transport?.close();
    this.transport = null;
    this.app.show(
      messageScreen(t.unavailableTitle, t.unavailableText, [
        { label: t.retry, onClick: retry, primary: true },
        ...(this.tournament
          ? []
          : [{ label: t.vsAi, onClick: () => this.exitTo(() => this.app.goSetup('pve')) }]),
        { label: this.menuLabel, onClick: () => this.exit() },
      ]),
    );
  }

  private showClosed(reason: Exclude<CloseReason, 'me-left'>, detail: string | null = null): void {
    const { title, text } = CLOSE_TEXT[reason];
    this.app.setBanner(null);
    this.app.show(
      messageScreen(title, detail ? `${text} (${detail})` : text, [
        { label: this.menuLabel, onClick: () => this.exit(), primary: true },
      ]),
    );
  }

  private startSession(role: 'host' | 'guest', pairing: Pairing): void {
    if (this.session || this.disposed) return;
    // Turnaj: zápas musí být best of 9 s náhodnými hrami – jinak to není turnajový zápas.
    if (this.tournament && JSON.stringify(pairing.format) !== JSON.stringify(TOURNAMENT_FORMAT)) {
      void pairing.peer.bye();
      this.dispose();
      this.tournament.back();
      return;
    }
    this.check = pairing.check;
    const names =
      role === 'host'
        ? { A: this.me.nickname, B: pairing.opponent.nickname }
        : { A: pairing.opponent.nickname, B: this.me.nickname };
    const session = new OnlineSession({
      role,
      peer: pairing.peer,
      names,
      format: pairing.format,
      clock: systemClock,
      reportKey: pairing.reportKey,
    });
    this.session = session;
    session.onConnection((state) => {
      if (this.disposed) return;
      this.app.setBanner(
        state.lost && state.deadline !== null
          ? connectionBanner(state.deadline, () => systemClock.now())
          : null,
      );
    });
    session.onPhase((phase) => {
      if (!this.disposed) this.render(session, phase);
    });
  }

  private confirmLeave(): void {
    void this.app
      .confirm({
        title: t.leaveTitle,
        message: this.tournament ? t.leaveTournamentText : t.leaveText,
        confirm: t.leave,
      })
      .then((ok) => {
        if (ok && !this.disposed) this.exit();
      });
  }

  /** Klíč obrazovky – stejný klíč = jen aktualizace (bez animace a bez zvuku). */
  private static screenKey(phase: OnlinePhase): string {
    switch (phase.name) {
      case 'seeding':
      case 'lobby':
        return 'lobby';
      case 'intro':
      case 'playing':
      case 'round-result':
        return `${phase.name}:${phase.current.gameNo}:${phase.current.replay}`;
      default:
        return phase.name;
    }
  }

  /**
   * Výsledek pro skóre mezi kamarády: nahlásí ho oba hráči, započítá se jen shoda.
   * Nesoulad dat (cheat) se nehlásí; host bez účtu nic neposílá.
   */
  private reportResult(matchKey: string | null, won: boolean, reason: string): void {
    if (!matchKey || reason === 'cheat' || this.reportedMatch === matchKey) return;
    this.reportedMatch = matchKey;
    this.app.account
      .reportMatch(matchKey, won)
      .catch((err: unknown) => console.warn('[účet] výsledek zápasu se nenahlásil', err));
  }

  private render(s: OnlineSession, phase: OnlinePhase): void {
    const names = s.names;
    const key = OnlineFlow.screenKey(phase);
    const fresh = key !== this.lastScreen;
    this.lastScreen = key;
    const show = (mount: Mount): void => this.app.show(mount, { animate: fresh });
    if (phase.name === 'intro' || phase.name === 'playing' || phase.name === 'round-result') {
      this.tournamentStarted = true;
    }
    // Turnaj: hostitel spustí zápas sám (chvilku po spárování, ať soupeř vidí, s kým hraje).
    if (this.tournament && phase.name === 'lobby' && s.me === 'A' && this.autoStartTimer === null) {
      this.autoStartTimer = setTimeout(() => s.startMatch(), 2_000);
    }
    switch (phase.name) {
      case 'seeding':
      case 'lobby':
        show(
          lobbyScreen({
            isHost: s.me === 'A',
            names,
            format: s.format,
            plan: phase.name === 'lobby' ? phase.plan : null,
            check: this.check,
            onStart: () => s.startMatch(),
            onLeave: () => this.exit(),
          }),
        );
        break;
      case 'intro':
        show(
          gameIntroScreen({
            game: getGame(phase.current.gameId),
            current: phase.current,
            mode: 'online',
            names,
            score: s.score,
            onStart: () => s.setReady(),
            onLeave: () => this.confirmLeave(),
            online: { me: s.me, ready: phase.ready },
          }),
        );
        break;
      case 'playing': {
        const game = getGame(phase.current.gameId);
        show(
          gameScreen({
            game,
            current: phase.current,
            names,
            score: s.score,
            onLeave: () => this.confirmLeave(),
            start: (parts) =>
              s.mountRound({
                root: parts.root,
                prefs: this.app.prefs(),
                sfx: this.app.sfx,
                aiMemory: this.app.aiMemory(game.id),
                showTurnTimer: (deadline, total) => parts.showTurnTimer(deadline, total),
              }),
          }),
        );
        break;
      }
      case 'round-result':
        show(
          roundResultScreen({
            report: phase.report,
            current: phase.current,
            result: phase.result,
            game: getGame(phase.current.gameId),
            mode: 'online',
            names,
            score: s.score,
            me: s.me,
            sfx: this.app.sfx,
            onContinue: () => s.continueAfterRound(),
          }),
        );
        break;
      case 'match-result':
        this.app.setBanner(null);
        this.reportResult(phase.matchKey, phase.winner === s.me, phase.reason);
        this.reportTournament(phase.winner, s.score);
        this.app.show(
          matchResultScreen({
            names,
            winner: phase.winner,
            score: s.score,
            history: s.history,
            me: s.me,
            // Při aktualizaci stavu odvety už výsledek znovu nezvučí.
            sfx: fresh ? this.app.sfx : SILENT,
            onRematch: () => s.requestRematch(),
            onMenu: () => this.exit(),
            tournament: this.tournament ? { onBack: () => this.exit() } : undefined,
            online: {
              reason: phase.reason,
              detail: phase.detail,
              rematch: phase.rematch,
              canRematch: phase.canRematch,
            },
          }),
          // Stejná skladba při aktualizaci odvety nezačne znovu (Music.play je idempotentní).
          { animate: fresh, music: phase.winner === s.me ? 'victory' : 'defeat' },
        );
        break;
      case 'closed':
        if (phase.reason !== 'me-left') this.showClosed(phase.reason, phase.detail);
        break;
    }
  }
}
