import type { MatchFormat } from '../core/match/planMatch';
import { AIMemory, type Prefs, type Sfx } from '../core/MiniGame';
import type { GameId } from '../core/types';
import { readSupabaseConfig, supabaseTransportFactory } from '../net/config';
import type { TransportFactory } from '../net/Transport';
import { loadNickname, saveNickname } from '../platform/profile';
import { applyMotionPreference, prefersReducedMotion, SettingsStore } from '../platform/settings';
import { createSfx } from '../platform/sound';
import type { Banner } from './components/banner';
import { confirmDialog, type ConfirmOptions } from './components/modal';
import { h } from './dom';
import { MatchFlow, type MatchSetup } from './MatchFlow';
import { OnlineFlow } from './OnlineFlow';
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
}

export class App {
  readonly settings = new SettingsStore();
  readonly sfx: Sfx = createSfx(() => this.settings.current);
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
    root.append(this.bannerRoot, this.screenRoot);
    applyMotionPreference(this.settings.current.reducedMotion);
    this.persistNickname = options.nickname === undefined;
    this.nicknameValue = options.nickname ?? loadNickname();
    this.pendingRoom = options.pendingRoom ?? null;
    if (options.transport !== undefined) {
      this.transportFactory = options.transport;
    } else {
      const config = readSupabaseConfig();
      this.transportFactory = config ? supabaseTransportFactory(config) : null;
    }
  }

  get nickname(): string | null {
    return this.nicknameValue;
  }

  get onlineAvailable(): boolean {
    return this.transportFactory !== null;
  }

  boot(): void {
    if (this.nicknameValue) this.continueAfterNickname();
    else this.goNickname();
  }

  /** animate: false = jen aktualizace téže obrazovky (bez úvodní animace, ať nebliká). */
  show(mount: Mount, { animate = true }: { animate?: boolean } = {}): void {
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
