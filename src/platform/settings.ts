import { z } from 'zod';
import { readJson, writeJson } from './storage';

const KEY = 'settings';

const settingsSchema = z.object({
  sound: z.boolean(),
  vibration: z.boolean(),
});

export type Settings = z.infer<typeof settingsSchema>;

const DEFAULTS: Settings = { sound: true, vibration: true };

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

export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && 'vibrate' in navigator;
}
