import { describe, expect, it } from 'vitest';
import { LocalFog } from '../../core/fog/LocalFog';
import { AIMemory, type FogKnowledge } from '../../core/MiniGame';
import type { Difficulty, PlayerSlot } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { huntAIMove } from './ai';
import {
  cellOf,
  CELLS,
  chebyshev,
  generateMap,
  huntFog as fog,
  huntLogic as logic,
  lineOfSight,
  playerOf,
  positionOf,
  ROUNDS,
  roleOf,
  sees,
  trackCells,
  type HuntMove,
  type HuntPrivate,
  type HuntState,
} from './logic';

const OPEN = '.'.repeat(CELLS);

/** Prázdný les (bez stromů), lovec A vlevo nahoře, liška vpravo dole. */
function openState(over: Partial<HuntState> = {}): HuntState {
  return {
    terrain: OPEN,
    starts: { hunter: cellOf(1, 1), fox: cellOf(7, 7) },
    firstHunter: 'A',
    half: 0,
    phase: 'play',
    round: 1,
    turn: 'fox',
    report: false,
    step: 0,
    halves: [],
    ...over,
  };
}

function play(s: HuntState, player: PlayerSlot, move: HuntMove): HuntState {
  expect(logic.legal(s, player, move)).toBe(true);
  return logic.apply(s, player, move);
}

const pv = (role: 'hunter' | 'fox', path: number[], last: number[] = []): HuntPrivate => ({
  half: 0,
  role,
  path,
  last,
});

describe('Hon v mlze – mapa a dohled', () => {
  it('mapa ze stejné náhody je stejná, starty volné a daleko od sebe, les průchozí', () => {
    for (let i = 0; i < 30; i++) {
      const a = generateMap(createRng(`mapa-${i}`));
      expect(generateMap(createRng(`mapa-${i}`))).toEqual(a);
      expect(a.terrain).toMatch(/^[.TB]{81}$/);
      expect(a.terrain[a.starts.hunter]).toBe('.');
      expect(a.terrain[a.starts.fox]).toBe('.');
      expect(chebyshev(a.starts.hunter, a.starts.fox)).toBe(6);
      expect([...a.terrain].filter((c) => c === 'T')).toHaveLength(12);
    }
  });

  it('výhled je souměrný a strom ho zakryje', () => {
    const rng = createRng('vyhled');
    for (let i = 0; i < 20; i++) {
      const { terrain } = generateMap(rng);
      for (let k = 0; k < 200; k++) {
        const a = rng.int(CELLS);
        const b = rng.int(CELLS);
        expect(lineOfSight(terrain, a, b)).toBe(lineOfSight(terrain, b, a));
      }
    }
    const tree = [...OPEN];
    tree[cellOf(4, 5)] = 'T';
    const terrain = tree.join('');
    expect(lineOfSight(terrain, cellOf(4, 4), cellOf(4, 6))).toBe(false);
    expect(lineOfSight(terrain, cellOf(3, 4), cellOf(3, 6))).toBe(true);
  });

  it('dohled je kruh, do keře jen ze sousedního pole, do stromu nikdy', () => {
    const from = cellOf(4, 4);
    expect(sees(OPEN, from, cellOf(6, 5), 2)).toBe(true);
    expect(sees(OPEN, from, cellOf(6, 6), 2)).toBe(false);
    expect(sees(OPEN, from, cellOf(7, 5), 3)).toBe(true);
    const bush = [...OPEN];
    bush[cellOf(4, 6)] = 'B';
    bush[cellOf(4, 5)] = 'B';
    expect(sees(bush.join(''), from, cellOf(4, 6), 3)).toBe(false);
    expect(sees(bush.join(''), from, cellOf(4, 5), 3)).toBe(true);
    const tree = [...OPEN];
    tree[cellOf(4, 5)] = 'T';
    expect(sees(tree.join(''), from, cellOf(4, 5), 3)).toBe(false);
  });
});

describe('Hon v mlze – průběh', () => {
  it('začíná liška, po každém tahu lovec hlásí, po kole se střídá', () => {
    let s = openState();
    expect(logic.toMove(s)).toEqual(['B']);
    expect(logic.legal(s, 'A', { kind: 'move', path: [] })).toBe(false);
    s = play(s, 'B', { kind: 'move', path: [cellOf(7, 6)] });
    expect(logic.toMove(s)).toEqual(['A']);
    expect(logic.legal(s, 'A', { kind: 'move', path: [] })).toBe(false);
    s = play(s, 'A', { kind: 'report', caught: null });
    expect(s).toMatchObject({ turn: 'hunter', round: 1 });
    s = play(s, 'A', { kind: 'move', path: [cellOf(1, 2), cellOf(1, 3)] });
    s = play(s, 'A', { kind: 'report', caught: null });
    expect(s).toMatchObject({ turn: 'fox', round: 2, step: 4 });
    // Liška ujde jen jedno pole, lovec dvě a přes strom nikdo.
    expect(logic.legal(s, 'B', { kind: 'move', path: [1, 2] })).toBe(false);
  });

  it('chycení ukončí poločas, role se prohodí a 2. poločas spustí nová liška', () => {
    let s = openState({ turn: 'hunter', round: 4 });
    s = play(s, 'A', { kind: 'move', path: [] });
    s = play(s, 'A', { kind: 'report', caught: cellOf(3, 3) });
    expect(s).toMatchObject({ half: 1, phase: 'break', round: 1, turn: 'fox' });
    expect(s.halves).toEqual([{ hunter: 'A', caught: 4, cell: cellOf(3, 3) }]);
    expect(roleOf(s, 'A')).toBe('fox');
    expect(logic.toMove(s)).toEqual(['A']);
    s = play(s, 'A', { kind: 'start' });
    expect(s.phase).toBe('play');
    expect(logic.toMove(s)).toEqual(['A']);
  });

  it('po posledním kole liška unikne', () => {
    let s = openState({ turn: 'hunter', round: ROUNDS });
    s = play(s, 'A', { kind: 'move', path: [] });
    s = play(s, 'A', { kind: 'report', caught: null });
    expect(s.halves).toEqual([{ hunter: 'A', caught: null, cell: null }]);
  });

  it('vyhrává rychlejší lovec; stejně rychle nebo nikdo = remíza', () => {
    const half = (hunter: PlayerSlot, caught: number | null) => ({ hunter, caught, cell: null });
    const end = (a: number | null, b: number | null) =>
      logic.outcome(openState({ half: 1, halves: [half('A', a), half('B', b)] }));
    expect(end(5, 7)).toEqual({ kind: 'win', winner: 'A' });
    expect(end(9, 7)).toEqual({ kind: 'win', winner: 'B' });
    expect(end(null, 12)).toEqual({ kind: 'win', winner: 'B' });
    expect(end(3, null)).toEqual({ kind: 'win', winner: 'A' });
    expect(end(6, 6)).toEqual({ kind: 'draw' });
    expect(end(null, null)).toEqual({ kind: 'draw' });
    // 2. poločas skončí, jakmile už jeho lovec nemůže vyrovnat.
    const running = openState({ half: 1, round: 5, halves: [half('A', 4)] });
    expect(logic.outcome(running)).toEqual({ kind: 'win', winner: 'A' });
    expect(logic.outcome({ ...running, round: 4 })).toBeNull();
  });
});

describe('Hon v mlze – mlha', () => {
  it('soukromý krok: liška 1 pole i šikmo, lovec 2 rovně, bez cesty neplatí', () => {
    const s = openState();
    const fox = fog.start(s, 'B');
    expect(fox).toEqual({ half: 0, role: 'fox', path: [cellOf(7, 7)], last: [] });
    expect(fog.advance(s, 'B', fox, { kind: 'move', path: [cellOf(6, 6)] })).not.toBeNull();
    expect(fog.advance(s, 'B', fox, { kind: 'move', path: [cellOf(5, 5)] })).toBeNull();
    expect(fog.advance(s, 'B', fox, { kind: 'move' })).toBeNull();
    const hunter = fog.start(s, 'A');
    const moved = fog.advance(s, 'A', hunter, { kind: 'move', path: [cellOf(1, 2), cellOf(2, 2)] });
    expect(moved && positionOf(moved)).toBe(cellOf(2, 2));
    expect(fog.advance(s, 'A', hunter, { kind: 'move', path: [cellOf(2, 2)] })).toBeNull();
    expect(fog.publicMove({ kind: 'move', path: [1] })).toEqual({ kind: 'move' });
  });

  it('liška prozrazuje polohu a dvě poslední stopy, lovec hledá lišku i stopy', () => {
    const fox = pv('fox', [10, 11, 12, 13]);
    expect(trackCells(fox)).toEqual([11, 12]);
    expect(fog.exposed(openState(), 'B', fox)).toEqual(['F:13', 'T:11', 'T:12']);
    const stayed = pv('fox', [10, 11, 11]);
    expect(trackCells(stayed)).toEqual([10]);
    const queries = fog.queries(openState(), 'A', pv('hunter', [cellOf(4, 4)]));
    expect(queries).toContain(`F:${cellOf(4, 4)}`);
    expect(queries).toContain(`T:${cellOf(6, 5)}`);
    expect(queries.length).toBeLessThanOrEqual(fog.maxQueries);
  });

  it('lovec ohlásí chycení, i když lišku jen minul po cestě; kontrola hlášení sedí', () => {
    const s = openState({ turn: 'hunter', report: true, step: 7 });
    const hunter = pv('hunter', [cellOf(4, 2), cellOf(4, 4)], [cellOf(4, 3), cellOf(4, 4)]);
    const knowledge: FogKnowledge = {
      own: hunter,
      sightings: [{ index: 7, segment: 0, mover: 'A', own: hunter, seen: [`F:${cellOf(4, 3)}`] }],
      revealed: new Map(),
    };
    expect(fog.respond(s, 'A', knowledge)).toEqual({ kind: 'report', caught: cellOf(4, 3) });
    const privates = { A: hunter, B: pv('fox', [cellOf(4, 3)]) };
    expect(fog.check(s, 'A', { kind: 'report', caught: cellOf(4, 3) }, privates)).toBe(true);
    expect(fog.check(s, 'A', { kind: 'report', caught: null }, privates)).toBe(false);
    // Liška dál od cesty: hlášení „nechyceno“ je pravdivé.
    const away = { A: hunter, B: pv('fox', [cellOf(6, 6)]) };
    expect(fog.check(s, 'A', { kind: 'report', caught: null }, away)).toBe(true);
    expect(fog.check(s, 'A', { kind: 'report', caught: cellOf(6, 6) }, away)).toBe(false);
  });
});

/** Celá hra AI proti AI přes lokální mlhu; vrací kola chycení obou poločasů. */
function aiGame(seed: string, hunter: Difficulty, fox: Difficulty): HuntState {
  const rng = createRng(seed);
  let state = logic.setup({ rng, starter: 'A' });
  const keeper = new LocalFog(fog);
  keeper.begin(() => state);
  let index = 0;
  for (let i = 0; i < 300 && !logic.outcome(state); i++) {
    const p = logic.toMove(state)[0] as PlayerSlot;
    const knowledge = keeper.knowledge(p) as FogKnowledge;
    const difficulty = roleOf(state, p) === 'hunter' ? hunter : fox;
    const move =
      fog.respond(state, p, knowledge) ??
      huntAIMove(state, { difficulty, rng, me: p, memory: new AIMemory(), fog: knowledge });
    expect(keeper.stage(p, state, move)).toBe(true);
    // Hlášení lovce musí odpovídat skutečným polohám.
    if (move.kind === 'report') {
      const privates = {
        A: keeper.knowledge('A')?.own as HuntPrivate,
        B: keeper.knowledge('B')?.own as HuntPrivate,
      };
      expect(fog.check(state, p, move, privates)).toBe(true);
    }
    state = play(state, p, move);
    index++;
    keeper.record(index, p, move, () => state);
  }
  return state;
}

describe('Hon v mlze – AI', () => {
  it('hra AI proti AI doběhne a hlášení jsou pravdivá', () => {
    for (let g = 0; g < 6; g++) {
      const s = aiGame(`ai-${g}`, 'hard', 'hard');
      expect(logic.outcome(s)).not.toBeNull();
      expect(s.halves.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('těžký lovec chytá častěji a dřív než lehký', () => {
    const stats = (difficulty: Difficulty) => {
      let caught = 0;
      for (let g = 0; g < 16; g++) {
        const first = aiGame(`sila-${g}`, difficulty, 'medium').halves[0];
        if (first?.caught != null) caught++;
      }
      return caught;
    };
    expect(stats('hard')).toBeGreaterThan(stats('easy'));
  });

  it('po konci poločasu se každý dozví trasu soupeře', () => {
    const rng = createRng('trasy');
    let state = logic.setup({ rng, starter: 'A' });
    const keeper = new LocalFog(fog);
    keeper.begin(() => state);
    const fox = playerOf(state, 'fox');
    state = play(state, fox, { kind: 'move', path: [] });
    keeper.record(1, fox, { kind: 'move', path: [] }, () => state);
    keeper.finish();
    const revealed = keeper.knowledge('A')?.revealed.get(0) as HuntPrivate;
    expect(positionOf(revealed)).toBe(state.starts.fox);
  });
});
