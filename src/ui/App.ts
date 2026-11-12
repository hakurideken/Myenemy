import type { MatchFormat } from '../core/match/planMatch';
import { AIMemory, type Prefs, type Sfx } from '../core/MiniGame';
import type { GameId } from '../core/types';
import { lang, setLang, type Lang } from '../i18n';
import { createAccount, formatHandle, type Account, type AccountState } from '../net/account';
import type { Friend } from '../net/friends';
import { readSupabaseConfig, supabaseTransportFactory } from '../net/config';
import type { Transport, TransportFactory } from '../net/Transport';
import { loadNickname, saveNickname } from '../platform/profile';
import { applyMotionPreference, prefersReducedMotion, SettingsStore } from '../platform/settings';
import { createAppMusic, type Music, type MusicTrack } from '../platform/music';
import { createSfx } from '../platform/sound';
import type { Banner } from './components/banner';
import {
  confirmDialog,
  openDialog,
  type ConfirmOptions,
  type DialogOptions,
  type OpenDialog,
} from './components/modal';
import { createInviteToast, type InviteToast } from './components/inviteToast';
import { createTopBar, type TopBar } from './components/topBar';
import { h } from './dom';
import { MatchFlow, type MatchSetup } from './MatchFlow';
import { OnlineFlow } from './OnlineFlow';
import { privacyScreen } from './screens/account';
import { friendsScreen } from './screens/friends';
import { menuScreen } from './screens/menu';
import { nicknameScreen } from './screens/nickname';
import { onlineMenuScreen } from './screens/online';
import { settingsScreen } from './screens/settings';
import { setupScreen, type SetupMode } from './screens/setup';
import { tournamentScreen } from './screens/tournament';
import { spectateScreen, type WatchTarget } from './screens/spectate';
import { TournamentFlow, type TournamentLink } from './TournamentFlow';
import { AI_LABEL } from './components/bracket';
import {
  entrantName,
  TOURNAMENT_AI,
  TOURNAMENT_FORMAT,
  type TournamentPlayer,
} from '../net/tournament';

/**
 * Obrazovky, na které se jde vrátit po obnovení stránky (i po přepnutí jazyka, které
 * stránku načte znovu). Zápas ani online místnost obnovit nejde – ty vedou do menu.
 */
type Route =
  | 'menu'
  | 'settings'
  | 'friends'
  | 'privacy'
  | 'setup-pve'
  | 'setup-online'
  | 'online'
  | 'tournament';
const ROUTES: readonly Route[] = [
  'menu',
  'tournament',
  'settings',
  'friends',
  'privacy',
  'setup-pve',
  'setup-online',
  'online',
];

/** Kam se vrátit podle adresy (#settings…); neznámé nebo prázdné = menu. */
export function routeFromHash(hash: string): Route {
  const name = hash.replace(/^#/, '');
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : 'menu';
}

/** Vykreslí obrazovku do kořene; vrácená funkce se zavolá při odchodu z ní. */
export type Mount = (root: HTMLElement) => (() => void) | void;

export interface AppOptions {
  /** undefined = podle konfigurace Supabase, null = online vypnuté. */
  readonly transport?: TransportFactory | null;
  /** Pevná přezdívka (vývojový režim dvou hráčů v jedné záložce) – nic se neukládá. */
  readonly nickname?: string;
  /** Kód místnosti z odkazu ?room=. */
  readonly pendingRoom?: string | null;
  /** Návrh kódu pro připojení (vývojový režim). */
  readonly suggestRoom?: () => string | null;
  /** false = bez hudby (vývojový režim dvou hráčů – hrála by dvakrát přes sebe). */
  readonly music?: boolean;
  /** false = bez účtů (vývojový režim dvou hráčů – sdílely by jedno přihlášení). */
  readonly account?: boolean;
}

const SILENT_MUSIC: Music = {
  play: () => undefined,
  refresh: () => undefined,
  unlock: () => undefined,
};

export class App {
  readonly settings = new SettingsStore();
  readonly sfx: Sfx = createSfx(() => this.settings.current);
  readonly music: Music;
  readonly account: Account;
  readonly tournament: TournamentFlow;
  private readonly topBar: TopBar;
  /** Jsme na obrazovce přezdívky (po přihlášení s hotovým profilem se jde dál). */
  private onNickname = false;
  /** Kdy se naposledy obnovily žádosti o přátelství (tečka na účtu). */
  private requestsCheckedAt = 0;
  private readonly inviteToast: InviteToast;
  /** Kamarád, kterého pozvat, jakmile vznikne online místnost (z obrazovky Kamarádi). */
  private pendingInvite: Friend | null = null;
  private readonly memories = new Map<GameId, AIMemory>();
  private readonly screenRoot = h('div', { class: 'app-screen' });
  private readonly bannerRoot = h('div', { class: 'app-banner' });
  private readonly transportFactory: TransportFactory | null;
  private cleanup: (() => void) | null = null;
  private banner: Banner | null = null;
  private online: OnlineFlow | null = null;
  private pendingRoom: string | null;
  private nicknameValue: string | null;
  private readonly persistNickname: boolean;
  /** Obrazovka v adrese (#…); null = zápas nebo místnost (po obnovení do menu). */
  private route: Route | null = null;
  private friendsShownSignedIn = false;
  private tournamentShownSignedIn = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: AppOptions = {},
  ) {
    const supabase = readSupabaseConfig();
    this.account = createAccount({ config: options.account === false ? null : supabase });
    this.topBar = createTopBar(this);
    this.tournament = new TournamentFlow(this);
    this.tournament.onChange(() => this.updateInviteToast());
    this.inviteToast = createInviteToast({
      acceptGame: (invite) => {
        void this.account.dismissGameInvite(invite.id).catch(() => undefined);
        this.joinOnline(invite.room);
      },
      declineGame: (invite) =>
        void this.account.dismissGameInvite(invite.id).catch(() => undefined),
      acceptTournament: (invite) => {
        this.tournament.api.dismissInvite(invite.id).catch(() => undefined);
        void this.tournament.join(invite.code).finally(() => this.goTournament());
      },
      declineTournament: (invite) => {
        this.tournament.api.dismissInvite(invite.id).catch(() => undefined);
        if (this.account.state.kind === 'signed-in') void this.account.refreshNotifications();
      },
      openTournament: () => this.goTournament(),
    });
    root.append(this.topBar.el, this.bannerRoot, this.screenRoot, this.inviteToast.el);
    this.watchNotifications();
    this.account.onChange((state) => this.onAccountChange(state));
    this.topBar.update();
    this.music =
      options.music === false ? SILENT_MUSIC : createAppMusic(() => this.settings.current);
    applyMotionPreference(this.settings.current.reducedMotion);
    this.persistNickname = options.nickname === undefined;
    this.nicknameValue = options.nickname ?? loadNickname();
    this.pendingRoom = options.pendingRoom ?? null;
    if (options.transport !== undefined) {
      this.transportFactory = options.transport;
    } else {
      this.transportFactory = supabase ? supabaseTransportFactory(supabase) : null;
    }
  }

  get nickname(): string | null {
    return this.nicknameValue;
  }

  get onlineAvailable(): boolean {
    return this.transportFactory !== null;
  }

  boot(): void {
    this.account.start();
    if (this.nicknameValue) this.continueAfterNickname();
    else this.goNickname();
  }

  /**
   * animate: false = jen aktualizace téže obrazovky (bez úvodní animace, ať nebliká).
   * music: co má hrát – všude podkladová hudba, na konci zápasu výhra / prohra.
   * chrome: lišta vpravo nahoře (jazyk, nastavení, účet) – během zápasu a online
   *   místnosti skrytá, ať se omylem neopustí rozehraná hra.
   */
  show(
    mount: Mount,
    {
      animate = true,
      music = 'theme',
      chrome = this.online === null,
    }: { animate?: boolean; music?: MusicTrack; chrome?: boolean } = {},
  ): void {
    this.music.play(music);
    this.topBar.el.hidden = !chrome;
    this.updateInviteToast();
    this.onNickname = false;
    this.cleanup?.();
    this.cleanup = null;
    this.screenRoot.classList.toggle('is-static', !animate);
    this.screenRoot.replaceChildren();
    this.cleanup = mount(this.screenRoot) ?? null;
    window.scrollTo(0, 0);
    this.root.scrollTop = 0;
    const target =
      this.screenRoot.querySelector<HTMLElement>('[data-autofocus]') ??
      this.screenRoot.querySelector<HTMLElement>('h1');
    target?.focus({ preventScroll: true });
  }

  /**
   * Přepnutí jazyka: volba se uloží a stránka se načte znovu – texty si moduly berou
   * při načtení. Mimo zápas (menu, nastavení) se tím nic neztratí.
   */
  switchLanguage(next: Lang): void {
    if (next === lang()) return;
    setLang(next);
    window.location.reload();
  }

  /** Dialog nad celou aplikací (přihlášení, účet). */
  dialog(options: DialogOptions): OpenDialog {
    return openDialog(this.root, options);
  }

  /** Potvrzovací dialog nad celou aplikací (zbytek je mezitím neaktivní). */
  confirm(options: ConfirmOptions): Promise<boolean> {
    return confirmDialog(this.root, options);
  }

  setBanner(banner: Banner | null): void {
    this.banner?.destroy();
    this.banner = banner;
    this.bannerRoot.replaceChildren(...(banner ? [banner.el] : []));
  }

  prefs(): Prefs {
    return { reducedMotion: prefersReducedMotion() || this.settings.current.reducedMotion };
  }

  aiMemory(gameId: GameId): AIMemory {
    let memory = this.memories.get(gameId);
    if (!memory) {
      memory = new AIMemory();
      this.memories.set(gameId, memory);
    }
    return memory;
  }

  suggestedRoom(): string | null {
    return this.options.suggestRoom?.() ?? null;
  }

  setNickname(name: string): void {
    this.nicknameValue = name;
    if (this.persistNickname) saveNickname(name);
  }

  /** Po zadání přezdívky: rovnou do místnosti z odkazu, jinak do menu. */
  continueAfterNickname(): void {
    const room = this.pendingRoom;
    this.pendingRoom = null;
    if (room) this.joinOnline(room);
    else this.goRoute(this.persistNickname ? routeFromHash(window.location.hash) : 'menu');
  }

  private goRoute(route: Route): void {
    switch (route) {
      case 'settings':
        return this.goSettings();
      case 'friends':
        return this.goFriends();
      case 'privacy':
        return this.goPrivacy();
      case 'setup-pve':
        return this.goSetup('pve');
      case 'setup-online':
        return this.onlineAvailable ? this.goSetup('online') : this.goOnline();
      case 'online':
        return this.goOnline();
      case 'tournament':
        return this.goTournament();
      case 'menu':
        return this.goMenu();
    }
  }

  /** Zapíše obrazovku do adresy (bez nového záznamu v historii). */
  private setRoute(route: Route | null): void {
    this.route = route;
    // Vývojový režim dvou hráčů: obě poloviny sdílí adresu – nic nezapisovat.
    if (!this.persistNickname) return;
    const hash = route && route !== 'menu' ? `#${route}` : '';
    if (window.location.hash === hash) return;
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${hash}`,
    );
  }

  goNickname(): void {
    this.show(nicknameScreen(this));
    this.onNickname = true;
  }

  goFriends(): void {
    this.leaveOnline();
    this.pendingInvite = null;
    this.show(friendsScreen(this));
    this.setRoute('friends');
    this.friendsShownSignedIn = this.account.state.kind === 'signed-in';
  }

  goPrivacy(): void {
    this.leaveOnline();
    this.pendingInvite = null;
    this.show(privacyScreen(this));
    this.setRoute('privacy');
  }

  /**
   * Přihlášení se změnilo: přezdívka z profilu platí i ve hře. Nový účet bez přezdívky
   * si ji zvolí – ale ne uprostřed zápasu (lišta je pak skrytá).
   */
  private onAccountChange(state: AccountState): void {
    this.topBar.update();
    this.updateInviteToast();
    if (state.kind !== 'signed-in') {
      if (state.kind !== 'loading') this.tournament.reset();
      return;
    }
    const inMatch = this.topBar.el.hidden;
    if (state.profile) {
      this.setNickname(state.profile.nickname);
      // Rozehraný turnaj: hned „jsem tady“ (a obnovená obrazovka turnaje se načte).
      if (this.tournament.state === undefined) void this.tournament.refresh();
      if (this.onNickname) this.continueAfterNickname();
      // Obnovená stránka s kamarády: přihlášení doběhlo až po vykreslení – načíst znovu.
      else if (this.route === 'friends' && !this.friendsShownSignedIn) this.goFriends();
      else if (this.route === 'tournament' && !this.tournamentShownSignedIn) this.goTournament();
    } else if (!inMatch) {
      this.goNickname();
    }
  }

  goMenu(): void {
    this.leaveOnline();
    this.pendingInvite = null;
    if (!this.nicknameValue) {
      this.goNickname();
      return;
    }
    this.show(menuScreen(this));
    this.setRoute('menu');
    this.refreshNotifications(5_000);
  }

  /** Žádosti a pozvánky; minIntervalMs = nevolat častěji (návraty do menu). */
  private refreshNotifications(minIntervalMs = 0): void {
    const now = Date.now();
    if (this.account.state.kind !== 'signed-in' || now - this.requestsCheckedAt < minIntervalMs) {
      return;
    }
    this.requestsCheckedAt = now;
    // Lišta je skrytá = rozehraný zápas nebo online místnost → kamarádům „ve hře“.
    this.account.refreshNotifications(this.topBar.el.hidden === true).catch(() => undefined);
  }

  /**
   * Průběžně (každých 15 s, jen ve viditelné záložce) obnovuje žádosti o přátelství
   * a pozvánky do hry – bez obnovení stránky.
   */
  private watchNotifications(): void {
    if (this.account.state.kind === 'unavailable') return;
    window.setInterval(() => {
      if (!document.hidden) this.refreshNotifications(10_000);
    }, 15_000);
    // Zavřená záložka / odchod ze stránky: kamarádům hned offline.
    window.addEventListener('pagehide', () => this.account.goOffline());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.refreshNotifications(3_000);
    });
  }

  /** Pozvánky ukazovat jen mimo rozehraný zápas a online místnost. */
  private updateInviteToast(): void {
    const state = this.account.state;
    const signedIn = state.kind === 'signed-in';
    this.inviteToast.update({
      games: signedIn ? state.invites : [],
      // Do turnaje zvát jen toho, kdo v žádném není.
      tournaments: signedIn && this.tournament.state === null ? state.tournamentInvites : [],
      // Můj turnajový zápas je připravený a nejsem na obrazovce turnaje.
      matchReady: this.route !== 'tournament' && this.tournament.matchWaiting,
      visible: !this.topBar.el.hidden,
    });
  }

  /** Z obrazovky Kamarádi: založit místnost a kamaráda do ní rovnou pozvat. */
  inviteToGame(friend: Friend): void {
    this.pendingInvite = friend;
    this.goSetup('online');
  }

  /** Komu půjde pozvánka, až vznikne místnost (pro text v nastavení zápasu). */
  get pendingInviteName(): string | null {
    return this.pendingInvite ? formatHandle(this.pendingInvite) : null;
  }

  /** Kamarád čekající na pozvánku do právě založené místnosti (jen jednou). */
  takePendingInvite(): Friend | null {
    const friend = this.pendingInvite;
    this.pendingInvite = null;
    return friend;
  }

  goSetup(mode: SetupMode): void {
    if (mode !== 'online') this.pendingInvite = null;
    this.show(setupScreen(this, mode));
    this.setRoute(mode === 'pve' ? 'setup-pve' : 'setup-online');
  }

  goSettings(): void {
    this.leaveOnline();
    this.pendingInvite = null;
    this.show(settingsScreen(this));
    this.setRoute('settings');
  }

  goTournament(): void {
    this.leaveOnline();
    this.pendingInvite = null;
    this.show(tournamentScreen(this));
    this.setRoute('tournament');
    this.updateInviteToast();
    this.tournamentShownSignedIn = this.account.state.kind === 'signed-in';
  }

  /** Sledovat zápas ostatních v turnaji (návrat na pavouka). */
  watchMatch(target: WatchTarget): void {
    this.leaveOnline();
    this.pendingInvite = null;
    this.show(spectateScreen(this, target));
    this.setRoute(null);
    this.updateInviteToast();
  }

  /** Turnajový zápas proti hráči: jsem hostitel (horní v pavouku) – založím místnost. */
  hostTournamentMatch(link: TournamentLink): void {
    const flow = this.startOnline(link);
    if (flow) void flow.createRoom(TOURNAMENT_FORMAT);
  }

  /** Turnajový zápas proti hráči: připojím se do místnosti, kterou soupeř založil. */
  joinTournamentMatch(link: TournamentLink, room: string): void {
    const flow = this.startOnline(link);
    if (flow) void flow.joinRoom(room);
  }

  /** Turnajový zápas proti AI (střední) – hraje se v prohlížeči. */
  playTournamentAi(link: TournamentLink, opponent: TournamentPlayer): void {
    this.leaveOnline();
    const mySlot = this.tournament.state?.me ?? link.slots.A;
    this.setRoute(null);
    new MatchFlow(this, {
      mode: 'pve',
      format: TOURNAMENT_FORMAT,
      names: { A: this.nicknameValue ?? 'Hráč', B: entrantName(opponent, AI_LABEL) },
      difficulty: TOURNAMENT_AI,
      tournament: { link, mySlot },
    }).start();
  }

  /** Nový kanál pro sledování (vysílání / příjem); null = online není nastavené. */
  openSpectateTransport(): Promise<Transport> | null {
    return this.transportFactory ? this.transportFactory() : null;
  }

  /** Online místnost čeká na soupeře (turnaj: zápas mezitím mohl skončit kontumací). */
  get waitingForOpponent(): boolean {
    return this.online?.waitingForOpponent ?? false;
  }

  goOnline(): void {
    this.leaveOnline();
    this.pendingInvite = null;
    this.show(onlineMenuScreen(this, this.onlineAvailable));
    this.setRoute('online');
  }

  /** Vyhodí MatchFormatError, pokud formát nejde sestavit. */
  startMatch(setup: MatchSetup): void {
    this.setRoute(null);
    new MatchFlow(this, setup).start();
  }

  createOnlineRoom(format: MatchFormat): void {
    const flow = this.startOnline();
    if (flow) void flow.createRoom(format);
  }

  joinOnline(code: string): void {
    const flow = this.startOnline();
    if (flow) void flow.joinRoom(code);
  }

  private startOnline(tournament: TournamentLink | null = null): OnlineFlow | null {
    this.leaveOnline();
    if (!this.transportFactory) {
      this.show(onlineMenuScreen(this, false));
      return null;
    }
    this.setRoute(null);
    this.online = new OnlineFlow(this, this.transportFactory, tournament);
    return this.online;
  }

  private leaveOnline(): void {
    this.online?.dispose();
    this.online = null;
    this.setBanner(null);
  }
}
