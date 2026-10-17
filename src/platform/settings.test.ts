import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from './settings';

/** Minimální localStorage pro Node. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('nastavení', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('výchozí: zvuky a vibrace zapnuté, animace podle systému', () => {
    expect(new SettingsStore().current).toEqual({
      sound: true,
      vibration: true,
      reducedMotion: false,
    });
  });

  it('starší uložené nastavení (bez omezení animací) se nezahodí', () => {
    vi.stubGlobal(
      'localStorage',
      memoryStorage({ 'myenemy:settings': JSON.stringify({ sound: false, vibration: true }) }),
    );
    expect(new SettingsStore().current).toEqual({
      sound: false,
      vibration: true,
      reducedMotion: false,
    });
  });

  it('změna se uloží a přežije nové načtení', () => {
    new SettingsStore().update({ reducedMotion: true });
    expect(new SettingsStore().current.reducedMotion).toBe(true);
  });

  it('nesmysl v úložišti = výchozí hodnoty', () => {
    vi.stubGlobal('localStorage', memoryStorage({ 'myenemy:settings': '{"sound":"ano"' }));
    expect(new SettingsStore().current.sound).toBe(true);
  });
});
