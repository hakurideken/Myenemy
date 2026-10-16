import { AIMemory, type Prefs, type Sfx } from '../core/MiniGame';
import type { GameId } from '../core/types';
import { loadNickname, saveNickname } from '../platform/profile';
import { prefersReducedMotion, SettingsStore } from '../platform/settings';
import { createSfx } from '../platform/sound';
import { MatchFlow, type LocalMode, type MatchSetup } from './MatchFlow';
import { menuScreen } from './screens/menu';
import { nicknameScreen } from './screens/nickname';
import { settingsScreen } from './screens/settings';
import { setupScreen } from './screens/setup';

/** Vykreslí obrazovku do kořene; vrácená funkce se zavolá při odchodu z ní. */
export type Mount = (root: HTMLElement) => (() => void) | void;

export class App {
  readonly settings = new SettingsStore();
  readonly sfx: Sfx = createSfx(() => this.settings.current);
  private readonly memories = new Map<GameId, AIMemory>();
  private cleanup: (() => void) | null = null;
  private nicknameValue: string | null = loadNickname();

  constructor(private readonly root: HTMLElement) {}

  get nickname(): string | null {
    return this.nicknameValue;
  }

  boot(): void {
    if (this.nicknameValue) this.goMenu();
    else this.goNickname();
  }

  show(mount: Mount): void {
    this.cleanup?.();
    this.cleanup = null;
    this.root.replaceChildren();
    this.cleanup = mount(this.root) ?? null;
    window.scrollTo(0, 0);
    const target =
      this.root.querySelector<HTMLElement>('[data-autofocus]') ??
      this.root.querySelector<HTMLElement>('h1');
    target?.focus({ preventScroll: true });
  }

  prefs(): Prefs {
    return { reducedMotion: prefersReducedMotion() };
  }

  aiMemory(gameId: GameId): AIMemory {
    let memory = this.memories.get(gameId);
    if (!memory) {
      memory = new AIMemory();
      this.memories.set(gameId, memory);
    }
    return memory;
  }

  setNickname(name: string): void {
    this.nicknameValue = name;
    saveNickname(name);
  }

  goNickname(): void {
    this.show(nicknameScreen(this));
  }

  goMenu(): void {
    if (!this.nicknameValue) {
      this.goNickname();
      return;
    }
    this.show(menuScreen(this));
  }

  goSetup(mode: LocalMode): void {
    this.show(setupScreen(this, mode));
  }

  goSettings(): void {
    this.show(settingsScreen(this));
  }

  /** Vyhodí MatchFormatError, pokud formát nejde sestavit. */
  startMatch(setup: MatchSetup): void {
    new MatchFlow(this, setup).start();
  }
}
