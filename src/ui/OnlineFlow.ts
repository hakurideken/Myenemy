import type { MatchFormat } from '../core/match/planMatch';
import type { Sfx } from '../core/MiniGame';
import { systemClock } from '../core/util/clock';
import { getGame } from '../games/registry';
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
import { connectingScreen, lobbyScreen, messageScreen, waitingScreen } from './screens/online';
import { roundResultScreen } from './screens/roundResult';

const SILENT: Sfx = { play: () => undefined, vibrate: () => undefined };

const CLOSE_TEXT: Record<Exclude<CloseReason, 'me-left'>, { title: string; text: string }> = {
  'opponent-left': {
    title: 'Soupeř odešel',
    text: 'Soupeř opustil místnost dřív, než zápas začal.',
  },
  'opponent-gone': { title: 'Spojení ztraceno', text: 'Se soupeřem se nepodařilo udržet spojení.' },
  version: {
    title: 'Jiná verze hry',
    text: 'Soupeř má jinou verzi hry – obnovte stránku (oba) a zkuste to znovu.',
  },
  cheat: {
    title: 'Nesoulad dat',
    text: 'Data od soupeře nesouhlasí s tím, k čemu se zavázal. Zápas byl ukončen.',
  },
};

/** Online zápas v UI: založení / připojení, lobby a průběh podle fází OnlineSession. */
export class OnlineFlow {
  private readonly me: Identity;
  private transport: Transport | null = null;
  private hostRoom: HostRoom | null = null;
  private session: OnlineSession | null = null;
  private disposed = false;
  private lastScreen: string | null = null;
  private readonly onPageHide = (): void => this.dispose();

  constructor(
    private readonly app: App,
    private readonly factory: TransportFactory,
  ) {
    this.me = { id: newClientId(), nickname: app.nickname ?? 'Hráč' };
    window.addEventListener('pagehide', this.onPageHide);
  }

  async createRoom(format: MatchFormat): Promise<void> {
    const code = generateRoomCode();
    this.app.show(connectingScreen('Zakládám místnost…', () => this.exit()));
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
    this.app.show(
      waitingScreen({
        code,
        link: roomLink(code, window.location),
        format,
        onCancel: () => this.exit(),
      }),
    );
  }

  async joinRoom(code: string): Promise<void> {
    this.app.show(connectingScreen(`Připojuji se do místnosti ${code}…`, () => this.exit()));
    const transport = await this.openTransport(() => void this.joinRoom(code));
    if (!transport) return;
    let pairing: Pairing;
    try {
      pairing = await joinRoom({ transport, clock: systemClock, room: code, me: this.me });
    } catch (err) {
      if (this.disposed) return;
      const reason = err instanceof PairingError ? err.reason : 'unavailable';
      if (reason === 'unavailable') this.showUnavailable(() => void this.joinRoom(code));
      else if (reason === 'version') this.showClosed('version');
      else {
        this.app.show(
          messageScreen(
            reason === 'full' ? 'Místnost je plná' : 'Místnost nenalezena',
            reason === 'full'
              ? 'V místnosti už hrají dva hráči.'
              : `Místnost ${code} neexistuje nebo hostitel neodpovídá. Zkontroluj kód.`,
            [
              {
                label: 'Zkusit jiný kód',
                onClick: () => this.exitTo(() => this.app.goOnline()),
                primary: true,
              },
              { label: 'Do menu', onClick: () => this.exit() },
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
    this.app.setBanner(null);
    const leaving = this.session?.leave() ?? Promise.resolve();
    const transport = this.transport;
    const hostRoom = this.hostRoom;
    void leaving.finally(() => {
      void (hostRoom ? hostRoom.close() : transport?.close());
    });
  }

  private exit(): void {
    this.exitTo(() => this.app.goMenu());
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
      messageScreen(
        'Online server je nedostupný',
        'Nepodařilo se spojit se serverem do 5 sekund – může být dočasně mimo provoz nebo uspaný. Zkus to za chvíli znovu, nebo si zahraj proti AI či ve dvou na jednom zařízení.',
        [
          { label: 'Zkusit znovu', onClick: retry, primary: true },
          { label: 'Proti AI', onClick: () => this.exitTo(() => this.app.goSetup('pve')) },
          { label: 'Dva hráči', onClick: () => this.exitTo(() => this.app.goSetup('local')) },
          { label: 'Do menu', onClick: () => this.exit() },
        ],
      ),
    );
  }

  private showClosed(reason: Exclude<CloseReason, 'me-left'>, detail: string | null = null): void {
    const { title, text } = CLOSE_TEXT[reason];
    this.app.setBanner(null);
    this.app.show(
      messageScreen(title, detail ? `${text} (${detail})` : text, [
        { label: 'Do menu', onClick: () => this.exit(), primary: true },
      ]),
    );
  }

  private startSession(role: 'host' | 'guest', pairing: Pairing): void {
    if (this.session || this.disposed) return;
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
        title: 'Odejít ze zápasu?',
        message: 'Soupeř vyhraje kontumací.',
        confirm: 'Odejít',
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

  private render(s: OnlineSession, phase: OnlinePhase): void {
    const names = s.names;
    const key = OnlineFlow.screenKey(phase);
    const fresh = key !== this.lastScreen;
    this.lastScreen = key;
    const show = (mount: Mount): void => this.app.show(mount, { animate: fresh });
    switch (phase.name) {
      case 'seeding':
      case 'lobby':
        show(
          lobbyScreen({
            isHost: s.me === 'A',
            names,
            format: s.format,
            plan: phase.name === 'lobby' ? phase.plan : null,
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
        show(
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
            online: {
              reason: phase.reason,
              detail: phase.detail,
              rematch: phase.rematch,
              canRematch: phase.canRematch,
            },
          }),
        );
        break;
      case 'closed':
        if (phase.reason !== 'me-left') this.showClosed(phase.reason, phase.detail);
        break;
    }
  }
}
