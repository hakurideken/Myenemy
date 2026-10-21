import { beforeEach, describe, expect, it, vi } from 'vitest';
import { battleship, PLACEMENT_TIMEOUT_MS } from '../games/battleship';
import { cellOf, isValidFleet, type BattleshipView, type Fleet } from '../games/battleship/logic';
import { logik } from '../games/logik';
import type { LogikView } from '../games/logik/logic';
import { GameRunner } from './GameRunner';
import {
  AIMemory,
  type AnyMiniGameModule,
  type RenderFrame,
  type RoundContext,
  type ViewContext,
} from './MiniGame';
import type { PlayerSlot } from './types';
import { ManualClock } from './util/clock';
import { createRng } from './util/rng';

const FLEET: Fleet = [
  { row: 0, col: 0, horizontal: true },
  { row: 2, col: 0, horizontal: true },
  { row: 4, col: 0, horizontal: true },
  { row: 6, col: 0, horizontal: true },
  { row: 6, col: 6, horizontal: true },
];

interface Stub {
  ctx: ViewContext<unknown> | null;
  readonly renders: { view: unknown; frame: RenderFrame }[];
}

function stubbed(game: AnyMiniGameModule): { module: AnyMiniGameModule; stub: Stub } {
  const stub: Stub = { ctx: null, renders: [] };
  const module: AnyMiniGameModule = {
    ...game,
    createView: (ctx) => {
      stub.ctx = ctx;
      return {
        render: (view, frame) => {
          stub.renders.push({ view, frame });
        },
        destroy: () => undefined,
      };
    },
  };
  return { module, stub };
}

function context(clock: ManualClock, overrides: Partial<RoundContext> = {}): RoundContext {
  return {
    root: {} as HTMLElement,
    mode: 'pve',
    names: { A: 'Ondra', B: 'AI' },
    seats: { A: { kind: 'human' }, B: { kind: 'ai', difficulty: 'easy' } },
    starter: 'A',
    rng: createRng('game'),
    aiRng: createRng('ai'),
    aiMemory: new AIMemory(),
    clock,
    prefs: { reducedMotion: true },
    sfx: { play: () => undefined, vibrate: () => undefined },
    handoff: () => Promise.resolve(),
    showTurnTimer: () => undefined,
    ...overrides,
  };
}

const last = (stub: Stub): { view: unknown; frame: RenderFrame } => {
  const entry = stub.renders.at(-1);
  if (!entry) throw new Error('nic nevykresleno');
  return entry;
};
const bsView = (stub: Stub): BattleshipView => last(stub).view as BattleshipView;
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let clock: ManualClock;
beforeEach(() => {
  clock = new ManualClock();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('GameRunner – skrytá informace (PvE)', () => {
  it('AI je připravená hned; po rozmístění hráče začne bitva a AI odpovídá okamžitě', () => {
    const { module, stub } = stubbed(battleship);
    const runner = new GameRunner(module);
    runner.init(context(clock));
    runner.start();
    expect(bsView(stub)).toMatchObject({ phase: 'placing', ready: { A: false, B: true } });
    expect(last(stub).frame).toMatchObject({ canAct: ['A'], secret: null });

    stub.ctx?.submitSecret('A', FLEET);
    expect(bsView(stub).phase).toBe('battle');
    expect(last(stub).frame.secret).toEqual(FLEET);

    stub.ctx?.submit('A', { kind: 'shot', cell: 10 });
    // Odpověď AI přijde bez čekání (plyne z jejích tajných dat).
    expect(bsView(stub).shots.A).toHaveLength(1);
    expect(bsView(stub).pending).toBeNull();
  });

  it('neplatné rozmístění se zahodí', () => {
    const { module, stub } = stubbed(battleship);
    const runner = new GameRunner(module);
    runner.init(context(clock));
    runner.start();
    const touching = [...FLEET];
    touching[1] = { row: 1, col: 4, horizontal: true };
    stub.ctx?.submitSecret('A', touching);
    stub.ctx?.submitSecret('A', { nesmysl: true });
    expect(bsView(stub).ready.A).toBe(false);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('na soupeřův výstřel odpovídá za hráče runner sám', async () => {
    const { module, stub } = stubbed(battleship);
    const runner = new GameRunner(module);
    runner.init(context(clock, { starter: 'B' }));
    runner.start();
    stub.ctx?.submitSecret('A', FLEET);
    expect(bsView(stub).turn).toBe('B');
    clock.advance(1500);
    await flush();
    // AI vystřelila a odpověď hráče (z jeho flotily) je už ve stavu.
    expect(bsView(stub).shots.B.length).toBeGreaterThan(0);
    expect(bsView(stub).pending).toBeNull();
  });

  it('po limitu na rozmístění dostane hráč náhodnou platnou flotilu', () => {
    const { module, stub } = stubbed(battleship);
    const timer = vi.fn();
    const runner = new GameRunner(module);
    runner.init(context(clock, { showTurnTimer: timer }));
    runner.start();
    expect(timer).toHaveBeenLastCalledWith(PLACEMENT_TIMEOUT_MS, PLACEMENT_TIMEOUT_MS);
    clock.advance(PLACEMENT_TIMEOUT_MS);
    expect(bsView(stub).phase).toBe('battle');
    expect(isValidFleet(last(stub).frame.secret as Fleet)).toBe(true);
  });
});

describe('GameRunner – skrytá informace (lokálně a online)', () => {
  it('hotseat: oba rozmístí, výsledek výstřelu je chvíli vidět, pak se předává', async () => {
    const { module, stub } = stubbed(battleship);
    const handoffs: PlayerSlot[] = [];
    const runner = new GameRunner(module);
    runner.init(
      context(clock, {
        mode: 'local',
        seats: { A: { kind: 'human' }, B: { kind: 'human' } },
        handoff: (to) => {
          handoffs.push(to);
          return Promise.resolve();
        },
      }),
    );
    runner.start();
    await flush();
    expect(handoffs).toEqual(['A']);
    stub.ctx?.submitSecret('A', FLEET);
    clock.advance(battleship.handoffDelayMs ?? 0);
    await flush();
    expect(handoffs).toEqual(['A', 'B']);
    // B nevidí A-ho flotilu.
    expect(last(stub).frame).toMatchObject({ perspective: 'B', secret: null });
    stub.ctx?.submitSecret('B', FLEET);
    clock.advance(battleship.handoffDelayMs ?? 0);
    await flush();
    expect(handoffs).toEqual(['A', 'B', 'A']);

    stub.ctx?.submit('A', { kind: 'shot', cell: cellOf(0, 0) }); // zásah – A hraje dál
    await flush();
    expect(handoffs).toHaveLength(3);
    expect(last(stub).frame.canAct).toEqual(['A']);
    stub.ctx?.submit('A', { kind: 'shot', cell: cellOf(7, 7) }); // vedle
    expect(last(stub).frame).toMatchObject({ perspective: 'A', canAct: [] });
    expect(bsView(stub).shots.A.at(-1)?.result).toBe('miss');
    clock.advance(battleship.handoffDelayMs ?? 0);
    await flush();
    expect(handoffs).toEqual(['A', 'B', 'A', 'B']);
  });

  it('hotseat Logik: kdo drží zařízení a je na tahu, hraje bez předávání', async () => {
    const { module, stub } = stubbed(logik);
    const handoffs: PlayerSlot[] = [];
    const runner = new GameRunner(module);
    runner.init(
      context(clock, {
        mode: 'local',
        seats: { A: { kind: 'human' }, B: { kind: 'human' } },
        handoff: (to) => {
          handoffs.push(to);
          return Promise.resolve();
        },
      }),
    );
    runner.start();
    await flush();
    stub.ctx?.submitSecret('A', [0, 1, 2, 3]);
    clock.advance(2000);
    await flush();
    stub.ctx?.submitSecret('B', [4, 4, 5, 5]);
    await flush();
    // B drží zařízení a v 1. kole je na tahu – tipuje hned, bez předání.
    expect(handoffs).toEqual(['A', 'B']);
    expect(last(stub).frame).toMatchObject({ perspective: 'B', canAct: ['B'] });
    stub.ctx?.submit('B', { kind: 'guess', code: [2, 2, 2, 2] });
    clock.advance(2000);
    await flush();
    expect(handoffs).toEqual(['A', 'B', 'A']);
    stub.ctx?.submit('A', { kind: 'guess', code: [1, 1, 1, 1] });
    // Odpovědi doplněné automaticky, A v dalším kole tipuje hned.
    const view = last(stub).view as LogikView;
    expect(view.guesses.A[0]?.feedback).toEqual(['none', 'none', 'none', 'none']);
    expect(view.guesses.B[0]?.feedback).toEqual(['none', 'none', 'exact', 'none']);
    expect(last(stub).frame).toMatchObject({ perspective: 'A', canAct: ['A'] });
    expect(handoffs).toEqual(['A', 'B', 'A']);
  });

  it('online: hra pokračuje, až je závazek tajných dat odeslaný', async () => {
    const { module, stub } = stubbed(battleship);
    let release: () => void = () => undefined;
    const commitSecret = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const published: unknown[] = [];
    const runner = new GameRunner(module);
    runner.init(
      context(clock, {
        mode: 'online',
        seats: { A: { kind: 'human' }, B: { kind: 'remote' } },
        bridge: { publish: (u) => published.push(u), localMove: () => undefined, commitSecret },
      }),
    );
    runner.start();
    stub.ctx?.submitSecret('A', FLEET);
    expect(commitSecret).toHaveBeenCalledWith('A', FLEET);
    expect(bsView(stub).ready.A).toBe(false);
    expect(last(stub).frame.canAct).toEqual([]);
    release();
    await flush();
    expect(bsView(stub).ready.A).toBe(true);
    // Za vzdáleného hráče, který nerozmístil, automaticky zahrát nejde.
    expect(runner.awaitsSecret('B')).toBe(true);
    expect(runner.autoMove('B')).toBe(false);
    expect(published.length).toBeGreaterThan(0);
  });
});
