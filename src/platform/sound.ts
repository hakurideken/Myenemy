import type { Sfx, SfxName } from '../core/MiniGame';
import { canVibrate, type Settings } from './settings';

/** [frekvence Hz, začátek s, délka s, tvar vlny] – zvuky se syntetizují, žádné cizí nahrávky. */
type Note = readonly [number, number, number, OscillatorType];

const PATTERNS: Record<SfxName, readonly Note[]> = {
  signal: [
    [880, 0, 0.09, 'square'],
    [1320, 0.08, 0.14, 'square'],
  ],
  click: [[640, 0, 0.04, 'triangle']],
  tick: [[1000, 0, 0.03, 'sine']],
  win: [
    [523, 0, 0.12, 'triangle'],
    [659, 0.11, 0.12, 'triangle'],
    [784, 0.22, 0.25, 'triangle'],
  ],
  lose: [
    [392, 0, 0.16, 'sawtooth'],
    [262, 0.15, 0.3, 'sawtooth'],
  ],
  draw: [
    [440, 0, 0.12, 'triangle'],
    [440, 0.16, 0.12, 'triangle'],
  ],
};

export function createSfx(getSettings: () => Settings): Sfx {
  let audio: AudioContext | null = null;

  function context(): AudioContext {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    return audio;
  }

  function tone(ac: AudioContext, [freq, offset, duration, type]: Note): void {
    const start = ac.currentTime + offset;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.07, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  return {
    play(name) {
      if (!getSettings().sound) return;
      try {
        const ac = context();
        for (const note of PATTERNS[name]) tone(ac, note);
      } catch {
        /* zvuk není k dispozici – hra funguje dál bez něj */
      }
    },
    vibrate(pattern) {
      // Prohlížeč vibrace před prvním dotykem uživatele blokuje (a hlásí chybu).
      if (!getSettings().vibration || !canVibrate() || !navigator.userActivation.hasBeenActive) {
        return;
      }
      navigator.vibrate(pattern as number | number[]);
    },
  };
}
