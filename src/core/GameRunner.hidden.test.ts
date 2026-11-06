import { beforeEach, describe, expect, it, vi } from 'vitest';
import { battleship, PLACEMENT_TIMEOUT_MS } from '../games/battleship';
import { isValidFleet, type BattleshipView, type Fleet } from '../games/battleship/logic';
import { GameRunner } from './GameRunner';
import {
  AIMemory,
  type AnyMiniGameModule,
  type RenderFrame,
  type RoundEnd,
  type RoundContext,
  type ViewContext,
} from './MiniGame';
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

  it('po konci hry jsou vidět lodě soupeře a výsledek kola nese odkrytou desku', async () => {
    const { module, stub } = stubbed(battleship);
    const ends: RoundEnd[] = [];
    const runner = new GameRunner(module);
    runner.init(context(clock));
    runner.onEnd((result) => ends.push(result));
    runner.start();
    stub.ctx?.submitSecret('A', FLEET);
    let next = 0;
    for (let i = 0; i < 500 && !last(stub).frame.finished; i++) {
      const { frame } = last(stub);
      // Během hry lodě AI nikdy nejsou vidět.
      expect(frame.opponentSecret).toBeNull();
      const view = bsView(stub);
      if (view.turn === 'A' && view.pending === null && frame.canAct.includes('A')) {
        stub.ctx?.submit('A', { kind: 'shot', cell: next++ });
      } else {
        clock.advance(2000);
        await flush();
      }
    }
    const { frame } = last(stub);
    expect(frame.finished).not.toBeNull();
    const aiFleet = frame.opponentSecret as Fleet;
    expect(isValidFleet(aiFleet)).toBe(true);

    clock.advance(battleship.revealMs);
    expect(ends).toHaveLength(1);
    expect(ends[0]?.final).toMatchObject({
      perspective: 'A',
      view: bsView(stub),
      secrets: { A: FLEET, B: aiFleet },
    });
  });

  it('hra bez závěrečné desky ji ve výsledku kola nemá', async () => {
    const { module, stub } = stubbed({ ...battleship, showFinalBoard: false });
    const ends: RoundEnd[] = [];
    const runner = new GameRunner(module);
    runner.init(context(clock));
    runner.onEnd((result) => ends.push(result));
    runner.start();
    stub.ctx?.submitSecret('A', FLEET);
    let next = 0;
    for (let i = 0; i < 500 && ends.length === 0; i++) {
      const view = bsView(stub);
      if (view.turn === 'A' && view.pending === null && last(stub).frame.canAct.includes('A')) {
        stub.ctx?.submit('A', { kind: 'shot', cell: next++ });
      } else {
        clock.advance(2000);
        await flush();
      }
    }
    expect(ends[0]?.final).toBeUndefined();
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

describe('GameRunner – skrytá informace online', () => {
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
