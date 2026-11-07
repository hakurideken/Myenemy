import type { MatchFormat } from '../core/match/planMatch';
import { AIMemory, type Prefs, type Sfx } from '../core/MiniGame';
import type { GameId } from '../core/types';
import { lang, setLang, type Lang } from '../i18n';
import { createAccount, type Account, type AccountState } from '../net/account';
import { readSupabaseConfig, supabaseTransportFactory } from '../net/config';
import type { TransportFactory } from '../net/Transport';
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
import { createTopBar, type TopBar } from './components/topBar';
import { h } from './dom';
import { MatchFlow, type MatchSetup } from './MatchFlow';
import { OnlineFlow } from './OnlineFlow';
import { privacyScreen } from './screens/account';
import { menuScreen } from './screens/menu';
import { nicknameScreen } from './screens/nickname';
import { onlineMenuScreen } from './screens/online';
import { settingsScreen } from './screens/settings';
import { setupScreen, type SetupMode } from './screens/setup';

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
  private readonly topBar: TopBar;
  /** Jsme na obrazovce přezdívky (po přihlášení s hotovým profilem se jde dál). */
  private onNickname = false;
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

  constructor(
    private readonly root: HTMLElement,
    private readonly options: AppOptions = {},
  ) {
    const supabase = readSupabaseConfig();
    this.account = createAccount({ config: options.account === false ? null : supabase });
    this.topBar = createTopBar(this);
    root.append(this.topBar.el, this.bannerRoot, this.screenRoot);
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
    else this.goMenu();
  }

  goNickname(): void {
    this.show(nicknameScreen(this));
    this.onNickname = true;
  }

  goPrivacy(): void {
    this.leaveOnline();
    this.show(privacyScreen(this));
  }

  /**
   * Přihlášení se změnilo: přezdívka z profilu platí i ve hře. Nový účet bez přezdívky
   * si ji zvolí – ale ne uprostřed zápasu (lišta je pak skrytá).
   */
  private onAccountChange(state: AccountState): void {
    this.topBar.update();
    if (state.kind !== 'signed-in') return;
    const inMatch = this.topBar.el.hidden;
    if (state.profile) {
      this.setNickname(state.profile.nickname);
      if (this.onNickname) this.continueAfterNickname();
    } else if (!inMatch) {
      this.goNickname();
    }
  }

  goMenu(): void {
    this.leaveOnline();
    if (!this.nicknameValue) {
      this.goNickname();
      return;
    }
    this.show(menuScreen(this));
  }

  goSetup(mode: SetupMode): void {
    this.show(setupScreen(this, mode));
  }

  goSettings(): void {
    this.leaveOnline();
    this.show(settingsScreen(this));
  }

  goOnline(): void {
    this.leaveOnline();
    this.show(onlineMenuScreen(this, this.onlineAvailable));
  }

  /** Vyhodí MatchFormatError, pokud formát nejde sestavit. */
  startMatch(setup: MatchSetup): void {
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

  private startOnline(): OnlineFlow | null {
    this.leaveOnline();
    if (!this.transportFactory) {
      this.show(onlineMenuScreen(this, false));
      return null;
    }
    this.online = new OnlineFlow(this, this.transportFactory);
    return this.online;
  }

  private leaveOnline(): void {
    this.online?.dispose();
    this.online = null;
    this.setBanner(null);
  }
}
