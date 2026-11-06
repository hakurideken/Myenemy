import { audioContext, userHasInteracted } from './audio';
import type { Settings } from './settings';

/** Podkladová hudba (menu i hry) a skladby na konci zápasu. */
export type MusicTrack = 'theme' | 'victory' | 'defeat';

export const MUSIC_FILES: Record<MusicTrack, string> = {
  theme: 'friendly-rivalry.mp3',
  victory: 'victory-fanfare.mp3',
  defeat: 'try-again-player-1.mp3',
};

const FADE_IN_S = 0.8;
const FADE_OUT_S = 0.5;
/** Pod touto hlasitostí je vzorek ticho (MP3 ho přidává na začátek a konec). */
const SILENCE = 1e-4;

/** Úsek bez ticha na začátku a konci – smyčka pak navazuje bez mezery. */
export function audibleRange(buffer: AudioBuffer): { start: number; end: number } {
  let first = buffer.length;
  let last = -1;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    let i = 0;
    while (i < first && Math.abs(data[i] ?? 0) <= SILENCE) i++;
    first = Math.min(first, i);
    let j = data.length - 1;
    while (j > last && Math.abs(data[j] ?? 0) <= SILENCE) j--;
    last = Math.max(last, j);
  }
  if (last < first) return { start: 0, end: buffer.duration };
  return { start: first / buffer.sampleRate, end: (last + 1) / buffer.sampleRate };
}

export interface MusicDeps {
  readonly settings: () => Settings;
  readonly context: () => AudioContext;
  readonly load: (track: MusicTrack) => Promise<ArrayBuffer>;
}

export interface Music {
  /** Co má hrát dokola (opakované volání stejné skladby ji nerestartuje). */
  play(track: MusicTrack): void;
  /** Po změně nastavení (vypnutí, hlasitost). */
  refresh(): void;
  /** První kliknutí / klávesa – teprve teď smí hudba začít. */
  unlock(): void;
}

interface Playing {
  readonly track: MusicTrack;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

export function createMusic(deps: MusicDeps): Music {
  /** Co si vyžádala obrazovka – hraje dokola, dokud se obrazovka nezmění. */
  let target: MusicTrack = 'theme';
  let playing: Playing | null = null;
  let unlocked = false;
  /** Zvýší se při každé změně – zastaralé načítání pak nic nespustí. */
  let generation = 0;
  const buffers = new Map<MusicTrack, Promise<AudioBuffer>>();

  const volume = (): number => {
    const s = deps.settings();
    return s.music ? Math.min(1, Math.max(0, s.musicVolume)) : 0;
  };

  function buffer(track: MusicTrack): Promise<AudioBuffer> {
    let pending = buffers.get(track);
    if (!pending) {
      pending = deps.load(track).then((bytes) => deps.context().decodeAudioData(bytes));
      // Nepovedené načtení (offline, chyba dekódování) zkusit znovu až příště.
      pending.catch(() => buffers.delete(track));
      buffers.set(track, pending);
    }
    return pending;
  }

  function stop(): void {
    const current = playing;
    if (!current) return;
    playing = null;
    const ac = deps.context();
    const now = ac.currentTime;
    current.gain.gain.cancelScheduledValues(now);
    current.gain.gain.setValueAtTime(current.gain.gain.value, now);
    current.gain.gain.linearRampToValueAtTime(0, now + FADE_OUT_S);
    try {
      current.source.stop(now + FADE_OUT_S + 0.05);
    } catch {
      /* už skončil */
    }
    // Dekódovanou fanfáru už nepotřebujeme – zbytečně by držela paměť.
    if (current.track !== 'theme') buffers.delete(current.track);
  }

  function start(track: MusicTrack, decoded: AudioBuffer): void {
    const ac = deps.context();
    const { start: from, end } = audibleRange(decoded);
    const source = ac.createBufferSource();
    source.buffer = decoded;
    const gain = ac.createGain();
    const now = ac.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume(), now + FADE_IN_S);
    source.connect(gain).connect(ac.destination);
    // Všechny skladby dokola: podklad v menu a hrách, výhra / prohra do odchodu z výsledku.
    source.loop = true;
    source.loopStart = from;
    source.loopEnd = end;
    source.start(now, from);
    playing = { track, source, gain };
  }

  function sync(): void {
    const id = ++generation;
    if (!unlocked || volume() === 0) {
      stop();
      return;
    }
    if (playing?.track === target) {
      const ac = deps.context();
      playing.gain.gain.setTargetAtTime(volume(), ac.currentTime, 0.05);
      return;
    }
    stop();
    const track = target;
    buffer(track).then(
      (decoded) => {
        if (id !== generation || playing || target !== track || volume() === 0) return;
        start(track, decoded);
      },
      (err: unknown) => console.warn(`[hudba] ${MUSIC_FILES[track]} se nenačetla`, err),
    );
  }

  return {
    play(track) {
      if (track === target) return;
      target = track;
      sync();
    },
    refresh() {
      sync();
    },
    unlock() {
      if (unlocked) return;
      unlocked = true;
      sync();
    },
  };
}

/** Hudba aplikace: soubory z public/music, start po první interakci uživatele. */
export function createAppMusic(settings: () => Settings): Music {
  const music = createMusic({
    settings,
    context: audioContext,
    load: async (track) => {
      const response = await fetch(`${import.meta.env.BASE_URL}music/${MUSIC_FILES[track]}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    },
  });
  if (typeof window !== 'undefined') {
    const unlock = (): void => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      music.unlock();
    };
    if (userHasInteracted()) music.unlock();
    else {
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);
    }
  }
  return music;
}
