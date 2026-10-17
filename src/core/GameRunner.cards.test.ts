import { beforeEach, describe, expect, it, vi } from 'vitest';
import { okoBere } from '../games/oko-bere';
import type { OkoView } from '../games/oko-bere/logic';
import { prsi } from '../games/prsi';
import type { PrsiView } from '../games/prsi/logic';
import { GameRunner } from './GameRunner';
import {
  AIMemory,
  type AnyMiniGameModule,
  type CardAt,
  type CardDealer,
  type KnownCards,
  type RenderFrame,
  type RoundContext,
  type ViewContext,
} from './MiniGame';
import { otherPlayer, type PerPlayer, type PlayerSlot } from './types';
import { ManualClock } from './util/clock';
import { createRng } from './util/rng';

interface Stub {
  ctx: ViewContext<unknown> | null;
  readonly renders: { view: unknown; frame: RenderFrame }[];
}

function stubbed(game: AnyMiniGameModule): { module: AnyMiniGameModule; stub: Stub } {
  const stub: Stub = { ctx: null, renders: [] };
  return {
    stub,
    module: {
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
    },
  };
}

function context(clock: ManualClock, overrides: Partial<RoundContext> = {}): RoundContext {
  return {
    root: {} as HTMLElement,
    mode: 'pve',
    names: { A: 'Ondra', B: 'AI' },
    seats: { A: { kind: 'human' }, B: { kind: 'ai', difficulty: 'medium' } },
    starter: 'A',
    rng: createRng('karty'),
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
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let clock: ManualClock;
beforeEach(() => {
  clock = new ManualClock();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('GameRunner – karty', () => {
  it('hráč zná jen svou kartu; soupeřovy se ukážou až při odhalení', async () => {
    const { module, stub } = stubbed(okoBere);
    const runner = new GameRunner(module);
    runner.init(context(clock));
    runner.start();
    await flush();
    const cards = last(stub).frame.cards;
    expect(cards?.has(0)).toBe(true);
    expect(cards?.has(1)).toBe(false);

    stub.ctx?.submit('A', { kind: 'stand' });
    // AI dohraje (stojí nebo líže), pak se odhalí karty obou.
    for (let i = 0; i < 20 && !last(stub).frame.finished; i++) {
      clock.advance(1500);
      await flush();
    }
    const view = last(stub).view as OkoView;
    expect(last(stub).frame.finished).not.toBeNull();
    expect(view.shown).toHaveLength(view.hands.A.length + view.hands.B.length);
    expect(last(stub).frame.cards?.has(1)).toBe(true);
  });

  it('karta, kterou hráč nemá, se zahrát nedá (tvrzení ověří rozdávající)', async () => {
    const { module, stub } = stubbed(prsi);
    const runner = new GameRunner(module);
    runner.init(context(clock));
    runner.start();
    await flush();
    const view = last(stub).view as PrsiView;
    const known = last(stub).frame.cards;
    const pos = view.hands.A[0] ?? 0;
    const real = known?.get(pos) ?? 0;
    const before = stub.renders.length;
    stub.ctx?.submit('A', { kind: 'play', pos, card: (real + 1) % 32, suit: null });
    expect(stub.renders).toHaveLength(before);
    expect(console.warn).toHaveBeenCalled();
  });

  it('hotseat: po předání vidí hráč jen svou ruku', async () => {
    const { module, stub } = stubbed(prsi);
    const runner = new GameRunner(module);
    runner.init(
      context(clock, {
        mode: 'local',
        seats: { A: { kind: 'human' }, B: { kind: 'human' } },
        starter: 'B',
      }),
    );
    runner.start();
    await flush();
    const { view, frame } = last(stub);
    const v = view as PrsiView;
    // Kdo je na tahu, závisí na úvodní kartě (eso / sedma) – ověřit podle pohledu.
    const me = frame.perspective;
    expect(frame.canAct).toEqual([me]);
    expect(v.hands[me].every((p) => frame.cards?.has(p))).toBe(true);
    expect(v.hands[otherPlayer(me)].some((p) => frame.cards?.has(p))).toBe(false);
  });

  it('dokud se balíček míchá, nikdo netáhne a karty jsou null', async () => {
    let release: () => void = () => undefined;
    const deck = Array.from({ length: 32 }, (_, i) => 31 - i);
    let entitled: PerPlayer<readonly number[]> = { A: [], B: [] };
    const dealer: CardDealer = {
      ready: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      entitle: (e) => {
        entitled = e;
      },
      known: (player: PlayerSlot): KnownCards =>
        new Map(entitled[player].map((p) => [p, deck[p] ?? 0])),
      peek: (positions): CardAt[] => positions.map((pos) => ({ pos, card: deck[pos] ?? 0 })),
      check: (claims) => claims.every((c) => deck[c.pos] === c.card),
      onChange: () => () => undefined,
    };
    const { module, stub } = stubbed(prsi);
    const runner = new GameRunner(module);
    runner.init(context(clock, { dealer }));
    runner.start();
    await flush();
    expect(last(stub).frame).toMatchObject({ cards: null, canAct: [] });
    release();
    await flush();
    expect(last(stub).frame.cards).not.toBeNull();
    // Úvodní karta (pozice 8) je odhalená všem.
    expect((last(stub).view as PrsiView).faceUp).toEqual([{ pos: 8, card: 23 }]);
  });
});
