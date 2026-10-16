import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { z } from 'zod';
import { AI_THINK_MAX_MS, AI_THINK_MIN_MS, GameRunner } from './GameRunner';
import {
  AIMemory,
  type GameView,
  type MiniGameModule,
  type RenderFrame,
  type RoundContext,
  type RoundEnd,
  type ViewContext,
} from './MiniGame';
import { DRAW, otherPlayer, win, type PlayerSlot } from './types';
import { ManualClock } from './util/clock';
import { createRng } from './util/rng';

// Sekvenční testovací hra: hráči střídavě přičítají 1–2, kdo dosáhne 5, vyhrál.
interface RaceState {
  readonly total: number;
  readonly turn: PlayerSlot;
  readonly last: PlayerSlot | null;
}
interface RaceMove {
  readonly step: number;
}

// Současná testovací hra: oba tajně zvolí číslo, vyšší vyhrává.
interface PickState {
  readonly order: readonly PlayerSlot[];
  readonly picks: Partial<Record<PlayerSlot, number>>;
}
interface PickMove {
  readonly n: number;
}
interface PickView {
  readonly mine: number | null;
}

/** Falešné vykreslení: zaznamenává rendery a zpřístupní ViewContext (submit). */
interface Harness<V, M> {
  readonly renders: { view: V; frame: RenderFrame }[];
  readonly destroyView: Mock<() => void>;
  viewCtx: ViewContext<M> | null;
  readonly createView: (ctx: ViewContext<M>) => GameView<V>;
}

function harness<V, M>(): Harness<V, M> {
  const h: Harness<V, M> = {
    renders: [],
    destroyView: vi.fn<() => void>(),
    viewCtx: null,
    createView: (ctx) => {
      h.viewCtx = ctx;
      return {
        render: (view, frame) => {
          h.renders.push({ view, frame });
        },
        destroy: h.destroyView,
      };
    },
  };
  return h;
}

function raceGame(
  createView: (ctx: ViewContext<RaceMove>) => GameView<RaceState>,
  overrides: Partial<MiniGameModule<RaceState, RaceMove, RaceState>> = {},
): MiniGameModule<RaceState, RaceMove, RaceState> {
  return {
    id: 'race',
    name: 'Závod',
    type: 'turn',
    length: 'quick',
    rules: ['test'],
    controls: () => [],
    localLayout: 'shared',
    moveTimeoutMs: 10_000,
    revealMs: 500,
    logic: {
      setup: ({ starter }) => ({ total: 0, turn: starter, last: null }),
      toMove: (s) => [s.turn],
      legal: (_s, _p, m) => m.step >= 1 && m.step <= 2,
      apply: (s, p, m) => ({ total: s.total + m.step, turn: otherPlayer(p), last: p }),
      outcome: (s) => (s.total >= 5 && s.last ? win(s.last) : null),
      view: (s) => s,
    },
    moveSchema: z.object({ step: z.number().int() }),
    viewSchema: z.custom<RaceState>(() => true),
    getAIMove: () => ({ step: 1 }),
    summarize: (v) => `celkem ${v.total}`,
    createView,
    ...overrides,
  };
}

function pickGame(
  createView: (ctx: ViewContext<PickMove>) => GameView<PickView>,
  overrides: Partial<MiniGameModule<PickState, PickMove, PickView>> = {},
): MiniGameModule<PickState, PickMove, PickView> {
  return {
    id: 'pick',
    name: 'Volba',
    type: 'turn',
    length: 'quick',
    rules: ['test'],
    controls: () => [],
    localLayout: 'hotseat',
    moveTimeoutMs: 10_000,
    revealMs: 500,
    logic: {
      setup: ({ starter }) => ({ order: [starter, otherPlayer(starter)], picks: {} }),
      toMove: (s) => s.order.filter((p) => s.picks[p] === undefined),
      legal: (s, p) => s.picks[p] === undefined,
      apply: (s, p, m) => {
        const picks = { ...s.picks };
        picks[p] = m.n;
        return { ...s, picks };
      },
      outcome: (s) => {
        const { A, B } = s.picks;
        if (A === undefined || B === undefined) return null;
        return A === B ? DRAW : win(A > B ? 'A' : 'B');
      },
      view: (s, viewer) => ({ mine: s.picks[viewer] ?? null }),
    },
    moveSchema: z.object({ n: z.number() }),
    viewSchema: z.custom<PickView>(() => true),
    getAIMove: () => ({ n: 1 }),
    summarize: () => '',
    createView,
    ...overrides,
  };
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

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let clock: ManualClock;
beforeEach(() => {
  clock = new ManualClock();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('GameRunner – PvE', () => {
  it('AI táhne až po „přemýšlení“ 0,5–1,5 s', () => {
    const h = harness<RaceState, RaceMove>();
    const runner = new GameRunner(raceGame(h.createView));
    runner.init(context(clock));
    runner.start();
    expect(h.renders.at(-1)?.frame.canAct).toEqual(['A']);

    runner.onInput('A', { step: 2 });
    expect(h.renders.at(-1)?.view).toMatchObject({ total: 2, turn: 'B' });
    expect(h.renders.at(-1)?.frame.canAct).toEqual([]);

    clock.advance(AI_THINK_MIN_MS - 1);
    expect(h.renders.at(-1)?.view.total).toBe(2);
    clock.advance(AI_THINK_MAX_MS - AI_THINK_MIN_MS + 1);
    expect(h.renders.at(-1)?.view).toMatchObject({ total: 3, turn: 'A' });
  });

  it('zahodí nevalidní vstup a tah hráče, který není na tahu', () => {
    const h = harness<RaceState, RaceMove>();
    const runner = new GameRunner(raceGame(h.createView));
    runner.init(context(clock));
    runner.start();
    const before = h.renders.length;
    runner.onInput('A', { step: 'dva' });
    runner.onInput('A', { step: 7 });
    runner.onInput('B', { step: 1 });
    expect(h.renders).toHaveLength(before);
    expect(console.warn).toHaveBeenCalledTimes(3);
  });

  it('view smí odeslat tah jen za lokálního hráče, který je na tahu', () => {
    const h = harness<RaceState, RaceMove>();
    const runner = new GameRunner(raceGame(h.createView));
    runner.init(context(clock));
    runner.start();
    h.viewCtx?.submit('B', { step: 1 });
    expect(h.renders.at(-1)?.view.total).toBe(0);
    h.viewCtx?.submit('A', { step: 1 });
    expect(h.renders.at(-1)?.view.total).toBe(1);
  });

  it('neaktivní hráč dostane po limitu automatický tah', () => {
    const h = harness<RaceState, RaceMove>();
    const timer = vi.fn();
    const runner = new GameRunner(raceGame(h.createView));
    runner.init(context(clock, { showTurnTimer: timer }));
    runner.start();
    expect(timer).toHaveBeenLastCalledWith(10_000, 10_000);
    clock.advance(9_999);
    expect(h.renders.at(-1)?.view.total).toBe(0);
    clock.advance(1);
    expect(h.renders.at(-1)?.view).toMatchObject({ total: 1, turn: 'B' });
    expect(timer).toHaveBeenLastCalledWith(null, 10_000);
  });

  it('u současného tahu se lhůta hráče neresetuje, když mezitím táhne AI', () => {
    const h = harness<PickView, PickMove>();
    const runner = new GameRunner(pickGame(h.createView));
    const ended: RoundEnd[] = [];
    runner.init(context(clock));
    runner.onEnd((r) => ended.push(r));
    runner.start();
    clock.advance(AI_THINK_MAX_MS);
    clock.advance(10_000 - AI_THINK_MAX_MS - 1);
    expect(h.renders.at(-1)?.view.mine).toBeNull();
    clock.advance(1);
    expect(h.renders.at(-1)?.view.mine).toBe(1);
    expect(h.renders.at(-1)?.frame.finished).toEqual(DRAW);
  });

  it('konec ohlásí až po revealMs, se shrnutím, a AI dostane finální pohled', () => {
    const h = harness<RaceState, RaceMove>();
    const observe = vi.fn();
    const runner = new GameRunner(raceGame(h.createView, { aiObserve: observe }));
    const ended: RoundEnd[] = [];
    runner.init(
      context(clock, { seats: { A: { kind: 'human' }, B: { kind: 'human' } }, mode: 'local' }),
    );
    runner.onEnd((r) => ended.push(r));
    runner.start();
    runner.onInput('A', { step: 2 });
    runner.onInput('B', { step: 2 });
    runner.onInput('A', { step: 1 });
    expect(h.renders.at(-1)?.frame.finished).toEqual(win('A'));
    expect(ended).toEqual([]);
    clock.advance(499);
    expect(ended).toEqual([]);
    clock.advance(1);
    expect(ended).toEqual([{ outcome: win('A'), summary: 'celkem 5' }]);
    expect(observe).not.toHaveBeenCalled();
  });

  it('aiObserve dostane finální pohled AI hráče', () => {
    const h = harness<RaceState, RaceMove>();
    const observe = vi.fn();
    const runner = new GameRunner(raceGame(h.createView, { aiObserve: observe }));
    runner.init(context(clock));
    runner.start();
    runner.onInput('A', { step: 2 });
    clock.advance(AI_THINK_MAX_MS);
    runner.onInput('A', { step: 2 });
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({ total: 5 }),
      expect.objectContaining({ me: 'B', difficulty: 'easy' }),
    );
  });

  it('destroy zruší AI, lhůty i ohlášení konce', () => {
    const h = harness<RaceState, RaceMove>();
    const runner = new GameRunner(raceGame(h.createView));
    const ended = vi.fn();
    runner.init(context(clock));
    runner.onEnd(ended);
    runner.start();
    runner.onInput('A', { step: 2 });
    runner.destroy();
    expect(clock.pending).toBe(0);
    clock.advance(60_000);
    expect(h.renders.at(-1)?.view.total).toBe(2);
    expect(ended).not.toHaveBeenCalled();
    expect(h.destroyView).toHaveBeenCalledOnce();
  });

  it('přepočítá tah AI, pokud se stav během přemýšlení změnil', () => {
    const h = harness<PickView, PickMove>();
    let calls = 0;
    const runner = new GameRunner(
      pickGame(h.createView, {
        getAIMove: () => ({ n: ++calls === 1 ? -1 : 2 }),
        logic: {
          ...pickGame(h.createView).logic,
          legal: (s, p, m) => s.picks[p] === undefined && m.n >= 0,
        },
      }),
    );
    runner.init(context(clock));
    runner.start();
    clock.advance(AI_THINK_MAX_MS);
    expect(calls).toBe(2);
  });
});

describe('GameRunner – lokální hotseat', () => {
  it('před každou tajnou volbou předá zařízení a druhý hráč mezitím nemůže hrát', async () => {
    const h = harness<PickView, PickMove>();
    const handoffs: PlayerSlot[] = [];
    const runner = new GameRunner(pickGame(h.createView));
    runner.init(
      context(clock, {
        mode: 'local',
        seats: { A: { kind: 'human' }, B: { kind: 'human' } },
        starter: 'B',
        handoff: (to) => {
          handoffs.push(to);
          return Promise.resolve();
        },
      }),
    );
    runner.start();
    expect(handoffs).toEqual(['B']);
    await flush();
    expect(h.renders.at(-1)?.frame).toMatchObject({ perspective: 'B', canAct: ['B'] });

    h.viewCtx?.submit('A', { n: 9 });
    expect(h.renders.at(-1)?.view.mine).toBeNull();

    h.viewCtx?.submit('B', { n: 3 });
    expect(handoffs).toEqual(['B', 'A']);
    await flush();
    const last = h.renders.at(-1);
    expect(last?.frame).toMatchObject({ perspective: 'A', canAct: ['A'] });
    expect(last?.view.mine).toBeNull();

    h.viewCtx?.submit('A', { n: 5 });
    expect(h.renders.at(-1)?.frame.finished).toEqual(win('A'));
  });

  it('lhůta na tah běží až po předání zařízení', async () => {
    const h = harness<PickView, PickMove>();
    let release: () => void = () => undefined;
    const runner = new GameRunner(pickGame(h.createView));
    runner.init(
      context(clock, {
        mode: 'local',
        seats: { A: { kind: 'human' }, B: { kind: 'human' } },
        handoff: () => new Promise<void>((resolve) => (release = resolve)),
      }),
    );
    runner.start();
    clock.advance(30_000);
    expect(h.renders).toHaveLength(0);
    release();
    await flush();
    clock.advance(9_999);
    expect(h.renders.at(-1)?.view.mine).toBeNull();
    clock.advance(1);
    expect(h.renders.length).toBeGreaterThan(0);
  });
});
