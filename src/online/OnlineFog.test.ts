import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blindLabels, hashToGroup, padLabels, randomKey, blind } from '../core/fog/psi';
import { LocalFog } from '../core/fog/LocalFog';
import type { FogRules } from '../core/MiniGame';
import type { PerPlayer, PlayerSlot } from '../core/types';
import { createRng } from '../core/util/rng';
import {
  CELLS,
  huntFog,
  huntLogic,
  positionOf,
  reachablePaths,
  roleOf,
  type HuntMove,
  type HuntPrivate,
  type HuntState,
  type HuntView,
} from '../games/hunt/logic';
import { settle } from '../test/helpers';
import { OnlineFog, type FogMessage } from './OnlineFog';

type Rules = FogRules<HuntMove, HuntView, HuntPrivate>;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('šifrovaný průnik', () => {
  it('pozorovatel pozná jen shodné štítky', async () => {
    const o = randomKey();
    const tKey = randomKey();
    const queries = padLabels(['F:1', 'F:2', 'F:3'], 6, 'q') ?? [];
    const exposed = padLabels(['F:2', 'T:9'], 3, 'x') ?? [];
    const sent = await blindLabels(queries, o);
    const doubles = sent.map((v) => blind(v, tKey));
    const shown = new Set((await blindLabels(exposed, tKey)).map((v) => blind(v, o)));
    expect(queries.filter((_, i) => shown.has(doubles[i] ?? 0n))).toEqual(['F:2']);
    expect(await hashToGroup('F:2')).toBe(await hashToGroup('F:2'));
    expect(padLabels(['A', 'B'], 1, 'z')).toBeNull();
  });
});

interface Duel {
  state: HuntState;
  index: number;
  readonly keepers: PerPlayer<OnlineFog>;
  readonly problems: PerPlayer<string[]>;
}

/** Dvě online mlhy propojené frontou zpráv (doručení po pořadí). */
function duel(rules: PerPlayer<Rules> = { A: huntFog, B: huntFog }): Duel {
  const state = huntLogic.setup({ rng: createRng('mlha-duel'), starter: 'A' });
  const problems: PerPlayer<string[]> = { A: [], B: [] };
  const keepers = {} as PerPlayer<OnlineFog>;
  for (const me of ['A', 'B'] as const) {
    const other: PlayerSlot = me === 'A' ? 'B' : 'A';
    keepers[me] = new OnlineFog(
      rules[me],
      me,
      (message: FogMessage) => {
        // Kopie přes JSON jako po síti.
        const copy = JSON.parse(JSON.stringify(message)) as FogMessage;
        queueMicrotask(() => keepers[other].receive(copy));
      },
      (detail) => problems[me].push(detail),
    );
  }
  const d: Duel = { state, index: 0, keepers, problems };
  for (const me of ['A', 'B'] as const) keepers[me].begin(() => d.state);
  return d;
}

async function untilReady(d: Duel): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (d.keepers.A.ready() && d.keepers.B.ready()) return;
    // Odhalený podvod hru zastaví (v zápase končí kontumací).
    if (d.problems.A.length > 0 || d.problems.B.length > 0) return;
    await settle();
  }
  throw new Error('mlha nedoběhla');
}

/** Odehraje veřejný tah u obou (u tahajícího i se soukromou částí). */
function apply(d: Duel, player: PlayerSlot, move: HuntMove): void {
  const keeper = d.keepers[player];
  expect(keeper.stage(player, d.state, move)).toBe(true);
  d.state = huntLogic.apply(d.state, player, move);
  d.index++;
  keeper.record(d.index, player, move, () => d.state);
  const other: PlayerSlot = player === 'A' ? 'B' : 'A';
  d.keepers[other].record(d.index, player, huntFog.publicMove(move), () => d.state);
}

/** Celá hra: tahy náhodně, hlášení lovce podle toho, co vidí. */
async function playOut(d: Duel, seed: string): Promise<void> {
  const rng = createRng(seed);
  await untilReady(d);
  for (let i = 0; i < 300 && !huntLogic.outcome(d.state); i++) {
    if (d.problems.A.length > 0 || d.problems.B.length > 0) break;
    const player = huntLogic.toMove(d.state)[0] as PlayerSlot;
    const knowledge = d.keepers[player].knowledge(player);
    if (!knowledge) throw new Error('bez znalosti');
    let move: HuntMove | null = huntFog.respond(d.state, player, knowledge);
    if (!move && d.state.phase === 'break') move = { kind: 'start' };
    if (!move) {
      const own = knowledge.own as HuntPrivate;
      const paths = reachablePaths(d.state.terrain, positionOf(own), roleOf(d.state, player));
      move = { kind: 'move', path: rng.pick(paths) };
    }
    apply(d, player, move);
    await untilReady(d);
  }
  for (const me of ['A', 'B'] as const) d.keepers[me].finish();
}

const audit = (keeper: OnlineFog): Promise<string | null> =>
  keeper.waitAudit((cb) => void setTimeout(cb, 5000));

describe('online mlha', () => {
  it('pozorování sedí s lokální mlhou a po hře se obě trasy ověří', async () => {
    const d = duel();
    const local = new LocalFog(huntFog);
    let localState = d.state;
    local.begin(() => localState);
    const rng = createRng('srovnani');
    await untilReady(d);
    for (let i = 0; i < 300 && !huntLogic.outcome(d.state); i++) {
      const player = huntLogic.toMove(d.state)[0] as PlayerSlot;
      const knowledge = d.keepers[player].knowledge(player);
      // Online i lokálně musí hráč vidět totéž.
      expect(knowledge?.sightings.map((s) => s.seen)).toEqual(
        local.knowledge(player)?.sightings.map((s) => s.seen),
      );
      let move: HuntMove | null = knowledge ? huntFog.respond(d.state, player, knowledge) : null;
      if (!move && d.state.phase === 'break') move = { kind: 'start' };
      if (!move) {
        const own = knowledge?.own as HuntPrivate;
        const paths = reachablePaths(d.state.terrain, positionOf(own), roleOf(d.state, player));
        move = { kind: 'move', path: rng.pick(paths) };
      }
      expect(local.stage(player, localState, move)).toBe(true);
      apply(d, player, move);
      localState = d.state;
      local.record(d.index, player, move, () => localState);
      await untilReady(d);
    }
    expect(huntLogic.outcome(d.state)).not.toBeNull();
    for (const me of ['A', 'B'] as const) d.keepers[me].finish();
    expect(await audit(d.keepers.A)).toBeNull();
    expect(await audit(d.keepers.B)).toBeNull();
    // Po ověření zná každý trasy soupeře z obou poločasů.
    const revealed = d.keepers.A.knowledge('A')?.revealed;
    expect(revealed?.size).toBe(d.state.halves.length);
    expect(d.problems).toEqual({ A: [], B: [] });
  }, 60_000);

  it('kdo se dívá dál, než smí, je po poločase odhalen', async () => {
    const peeking: Rules = {
      ...huntFog,
      queries(view, player, own) {
        const real = huntFog.queries(view, player, own);
        const kind = own.role === 'hunter' ? 'F' : 'H';
        const extra: string[] = [];
        for (
          let cell = 0;
          cell < CELLS && real.length + extra.length < huntFog.maxQueries;
          cell++
        ) {
          const label = `${kind}:${cell}`;
          if (!real.includes(label)) extra.push(label);
        }
        return [...real, ...extra];
      },
    };
    const d = duel({ A: huntFog, B: peeking });
    await playOut(d, 'koukal');
    expect(await audit(d.keepers.A)).toMatch(/dál|further/);
    expect(d.problems.A.length).toBeGreaterThan(0);
  }, 60_000);

  it('kdo zatají svou polohu, je po poločase odhalen', async () => {
    const hiding: Rules = {
      ...huntFog,
      exposed: (_view, _player, own) => (own.role === 'hunter' ? ['H:0'] : ['F:0']),
    };
    const d = duel({ A: huntFog, B: hiding });
    await playOut(d, 'schovany');
    expect(d.problems.A.join(' ')).toMatch(/zatajil|hid/);
  }, 60_000);
});
