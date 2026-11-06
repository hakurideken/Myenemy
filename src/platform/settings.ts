import { z } from 'zod';
import { readJson, writeJson } from './storage';

const KEY = 'settings';

const settingsSchema = z.object({
  sound: z.boolean(),
  vibration: z.boolean(),
  /** Omezit animace i bez systémového nastavení (starší uložená nastavení ho nemají). */
  reducedMotion: z.boolean().default(false),
  /** Hudba zvlášť od efektů (starší uložená nastavení ji nemají – výchozí zapnutá). */
  music: z.boolean().default(true),
  musicVolume: z.number().min(0).max(1).default(0.5),
});

export type Settings = z.infer<typeof settingsSchema>;

const DEFAULTS: Settings = {
  sound: true,
  vibration: true,
  reducedMotion: false,
  music: true,
  musicVolume: 0.5,
};

export class SettingsStore {
  private value: Settings;

  constructor() {
    const parsed = settingsSchema.safeParse(readJson(KEY));
    this.value = parsed.success ? parsed.data : { ...DEFAULTS };
  }

  get current(): Settings {
    return this.value;
  }

  update(patch: Partial<Settings>): void {
    this.value = { ...this.value, ...patch };
    writeJson(KEY, this.value);
  }
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Ruční omezení animací: třída na <html> zapne stejná pravidla jako systémové nastavení. */
export function applyMotionPreference(reduce: boolean): void {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('reduce-motion', reduce);
  }
}

export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && 'vibrate' in navigator;
}
