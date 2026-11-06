import { describe, expect, it, vi } from 'vitest';
import { audibleRange, createMusic, MUSIC_FILES, type MusicTrack } from './music';
import type { Settings } from './settings';

/** Nahraná skladba: jméno souboru v „bufferu“, ať test pozná, co hraje. */
class FakeBuffer {
  readonly numberOfChannels = 1;
  readonly sampleRate = 10;
  constructor(
    readonly track: MusicTrack,
    private readonly data = new Float32Array([0, 0, 0.5, -0.4, 0.3, 0]),
  ) {}
  get length(): number {
    return this.data.length;
  }
  get duration(): number {
    return this.data.length / this.sampleRate;
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

class FakeParam {
  value = 0;
  setValueAtTime(v: number): void {
    this.value = v;
  }
  linearRampToValueAtTime(v: number): void {
    this.value = v;
  }
  setTargetAtTime(v: number): void {
    this.value = v;
  }
  cancelScheduledValues(): void {}
}

class FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  started: number[] | null = null;
  stopped = false;
  onended: (() => void) | null = null;
  connect<T>(node: T): T {
    return node;
  }
  start(...args: number[]): void {
    this.started = args;
  }
  stop(): void {
    this.stopped = true;
  }
}

function setup(initial: Partial<Settings> = {}) {
  let settings: Settings = {
    sound: true,
    vibration: true,
    reducedMotion: false,
    music: true,
    musicVolume: 0.5,
    ...initial,
  };
  const sources: FakeSource[] = [];
  const gains: FakeParam[] = [];
  const context = {
    currentTime: 0,
    destination: {},
    createBufferSource: () => {
      const s = new FakeSource();
      sources.push(s);
      return s;
    },
    createGain: () => {
      const gain = new FakeParam();
      gains.push(gain);
      return { gain, connect: <T>(n: T): T => n };
    },
    decodeAudioData: (bytes: ArrayBuffer) =>
      Promise.resolve(new FakeBuffer(new TextDecoder().decode(bytes) as MusicTrack)),
  };
  const load = vi.fn((track: MusicTrack) =>
    Promise.resolve(new TextEncoder().encode(track).buffer),
  );
  const music = createMusic({
    settings: () => settings,
    context: () => context as unknown as AudioContext,
    load,
  });
  /** Co právě hraje (poslední spuštěný a nezastavený zdroj). */
  const now = (): MusicTrack | null => {
    const live = sources.filter((s) => s.started && !s.stopped).at(-1);
    return live?.buffer?.track ?? null;
  };
  const set = (patch: Partial<Settings>): void => {
    settings = { ...settings, ...patch };
    music.refresh();
  };
  return { music, sources, gains, load, now, set };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('hudba', () => {
  it('nehraje, dokud hráč na stránce na nic neklikl', async () => {
    const m = setup();
    m.music.refresh();
    await flush();
    expect(m.load).not.toHaveBeenCalled();
    m.music.unlock();
    await flush();
    expect(m.now()).toBe('theme');
  });

  it('podklad hraje ve smyčce bez ticha na začátku a konci', async () => {
    const m = setup();
    m.music.unlock();
    await flush();
    const source = m.sources[0];
    expect(source?.loop).toBe(true);
    expect(source?.loopStart).toBeCloseTo(0.2);
    expect(source?.loopEnd).toBeCloseTo(0.5);
  });

  it('konec zápasu: výherní skladba, po dohrání zase podklad; opakované volání ji nerestartuje', async () => {
    const m = setup();
    m.music.unlock();
    await flush();
    m.music.play('victory');
    await flush();
    expect(m.now()).toBe('victory');
    const victory = m.sources.at(-1);
    expect(victory?.loop).toBe(false);
    m.music.play('victory'); // aktualizace obrazovky odvety
    await flush();
    expect(m.sources.at(-1)).toBe(victory);
    victory?.onended?.();
    await flush();
    expect(m.now()).toBe('theme');
    m.music.play('victory');
    await flush();
    expect(m.now()).toBe('theme'); // pořád stejná obrazovka – fanfára se neopakuje
    m.music.play('theme');
    m.music.play('defeat');
    await flush();
    expect(m.now()).toBe('defeat');
    expect(MUSIC_FILES.defeat).toBe('try-again-player-1.mp3');
  });

  it('vypnutí hudby ji zastaví, hlasitost se mění za běhu; efekty to neovlivní', async () => {
    const m = setup({ musicVolume: 0.3 });
    m.music.unlock();
    await flush();
    expect(m.gains.at(-1)?.value).toBeCloseTo(0.3);
    m.set({ musicVolume: 0.8 });
    expect(m.gains.at(-1)?.value).toBeCloseTo(0.8);
    m.set({ music: false });
    expect(m.now()).toBeNull();
    m.set({ music: true });
    await flush();
    expect(m.now()).toBe('theme');
    // Podklad se načetl jen jednou (drží se v paměti).
    expect(m.load.mock.calls.filter(([t]) => t === 'theme')).toHaveLength(1);
  });

  it('rychlé přepnutí: zastaralé načítání nic nespustí', async () => {
    const m = setup();
    m.music.unlock();
    m.music.play('defeat');
    await flush();
    expect(m.sources.filter((s) => s.started && !s.stopped)).toHaveLength(1);
    expect(m.now()).toBe('defeat');
  });

  it('audibleRange: celé ticho = celá skladba', () => {
    const silent = new FakeBuffer('theme', new Float32Array(4)) as unknown as AudioBuffer;
    expect(audibleRange(silent)).toEqual({ start: 0, end: 0.4 });
  });
});
