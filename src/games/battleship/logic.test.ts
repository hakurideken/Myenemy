import { describe, expect, it } from 'vitest';
import { AIMemory } from '../../core/MiniGame';
import { DIFFICULTIES, type Difficulty, type PlayerSlot } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { battleshipAIMove, seaKnowledge } from './ai';
import {
  answerFor,
  battleshipHidden,
  battleshipLogic as logic,
  cellOf,
  CELLS,
  fleetCells,
  isValidFleet,
  randomFleet,
  type BattleshipMove,
  type BattleshipState,
  type Fleet,
} from './logic';

/** Flotila v levém sloupci a v rozích – snadno se počítá. */
const FLEET_A: Fleet = [
  { row: 0, col: 0, horizontal: true }, // A1–D1 (4)
  { row: 2, col: 0, horizontal: true }, // A3–C3 (3)
  { row: 4, col: 0, horizontal: true }, // A5–C5 (3)
  { row: 6, col: 0, horizontal: true }, // A7–B7 (2)
  { row: 6, col: 6, horizontal: true }, // G7–H7 (2)
];
const FLEET_B: Fleet = [
  { row: 0, col: 7, horizontal: false }, // H1–H4
  { row: 0, col: 0, horizontal: false }, // A1–A3
  { row: 0, col: 2, horizontal: false }, // C1–C3
  { row: 7, col: 0, horizontal: true }, // A8–B8
  { row: 7, col: 4, horizontal: true }, // E8–F8
];
const FLEETS: Record<PlayerSlot, Fleet> = { A: FLEET_A, B: FLEET_B };

function play(state: BattleshipState, player: PlayerSlot, move: BattleshipMove): BattleshipState {
  expect(logic.legal(state, player, move)).toBe(true);
  return logic.apply(state, player, move);
}

/** Provede automatické odpovědi obou stran podle jejich flotil. */
function respondAll(state: BattleshipState): BattleshipState {
  let s = state;
  for (;;) {
    const player = logic.toMove(s)[0];
    if (!player) return s;
    const move = battleshipHidden.respond(logic.view(s, player), player, FLEETS[player]);
    if (!move) return s;
    s = play(s, player, move);
  }
}

const started = (): BattleshipState =>
  respondAll(logic.setup({ rng: createRng('bs'), starter: 'A' }));

describe('Lodě – rozmístění', () => {
  it('náhodná flotila je vždy platná', () => {
    const rng = createRng('fleet');
    for (let i = 0; i < 200; i++) expect(isValidFleet(randomFleet(rng))).toBe(true);
  });

  it('lodě se nesmějí překrývat, dotýkat (ani rohem) ani přečnívat', () => {
    expect(isValidFleet(FLEET_A)).toBe(true);
    expect(isValidFleet(FLEET_B)).toBe(true);
    const touching = [...FLEET_A];
    touching[1] = { row: 1, col: 4, horizontal: true }; // E2 se dotýká rohem D1
    expect(isValidFleet(touching)).toBe(false);
    const outside = [...FLEET_A];
    outside[0] = { row: 0, col: 5, horizontal: true }; // F1–I1
    expect(isValidFleet(outside)).toBe(false);
    expect(isValidFleet(FLEET_A.slice(0, 4))).toBe(false);
  });

  it('odpověď na výstřel: vedle, zásah, potopeno', () => {
    const cells = fleetCells(FLEET_A) ?? [];
    expect(answerFor(cells, [], cellOf(7, 7))).toEqual({ result: 'miss', ship: null });
    expect(answerFor(cells, [], cellOf(6, 6))).toEqual({ result: 'hit', ship: null });
    expect(answerFor(cells, [cellOf(6, 6)], cellOf(6, 7))).toEqual({ result: 'sunk', ship: 4 });
  });
});

describe('Lodě – průběh', () => {
  it('bitva začne, až jsou připravení oba; střílí začínající', () => {
    const s = logic.setup({ rng: createRng('x'), starter: 'B' });
    expect(logic.toMove(s)).toEqual(['B', 'A']);
    expect(logic.legal(s, 'B', { kind: 'shot', cell: 0 })).toBe(false);
    const ready = respondAll(s);
    expect(ready.phase).toBe('battle');
    expect(logic.toMove(ready)).toEqual(['B']);
  });

  it('zásah = střílí znovu, vedle = střídání; stejné pole dvakrát nejde', () => {
    let s = started();
    s = respondAll(play(s, 'A', { kind: 'shot', cell: cellOf(0, 7) })); // H1 – zásah
    expect(s.shots.A).toEqual([{ cell: cellOf(0, 7), result: 'hit', ship: null }]);
    expect(logic.toMove(s)).toEqual(['A']);
    expect(logic.legal(s, 'A', { kind: 'shot', cell: cellOf(0, 7) })).toBe(false);
    s = respondAll(play(s, 'A', { kind: 'shot', cell: cellOf(5, 5) })); // vedle
    expect(logic.toMove(s)).toEqual(['B']);
    expect(s.lastShooter).toBe('A');
  });

  it('kdo potopí celou flotilu, vyhrává', () => {
    let s = started();
    for (const cell of (fleetCells(FLEET_B) ?? []).flat()) {
      s = respondAll(play(s, 'A', { kind: 'shot', cell }));
    }
    expect(logic.outcome(s)).toEqual({ kind: 'win', winner: 'A' });
    expect(logic.toMove(s)).toEqual([]);
    expect(battleshipHidden.outcome(logic.view(s, 'B'))).toEqual({ kind: 'win', winner: 'A' });
  });

  it('nemožné „potopeno“ (špatná délka nebo už potopená loď) je neplatné', () => {
    let s = play(started(), 'A', { kind: 'shot', cell: cellOf(0, 7) });
    expect(logic.legal(s, 'B', { kind: 'answer', result: 'sunk', ship: 3 })).toBe(false);
    expect(logic.legal(s, 'B', { kind: 'answer', result: 'hit', ship: 2 })).toBe(false);
    s = respondAll(s);
    for (const cell of [cellOf(7, 0), cellOf(7, 1)]) {
      s = respondAll(play(s, 'A', { kind: 'shot', cell }));
    }
    expect(s.shots.A.at(-1)).toMatchObject({ result: 'sunk', ship: 3 });
    s = play(s, 'A', { kind: 'shot', cell: cellOf(7, 4) });
    s = play(s, 'B', { kind: 'answer', result: 'hit', ship: null });
    s = play(s, 'A', { kind: 'shot', cell: cellOf(7, 5) });
    // Loď 3 už je potopená – musí to být loď 4.
    expect(logic.legal(s, 'B', { kind: 'answer', result: 'sunk', ship: 3 })).toBe(false);
    expect(logic.legal(s, 'B', { kind: 'answer', result: 'sunk', ship: 4 })).toBe(true);
  });

  it('kontrola poctivosti: lež o zásahu se po odhalení flotily pozná', () => {
    let s = started();
    s = respondAll(play(s, 'A', { kind: 'shot', cell: cellOf(0, 7) }));
    expect(battleshipHidden.consistent(s, 'B', FLEET_B)).toBe(true);
    s = play(s, 'A', { kind: 'shot', cell: cellOf(1, 7) });
    s = play(s, 'B', { kind: 'answer', result: 'miss', ship: null }); // lež: H2 je loď
    expect(battleshipHidden.consistent(s, 'B', FLEET_B)).toBe(false);
    expect(battleshipHidden.consistent(s, 'A', FLEET_A)).toBe(true);
  });

  it('respond / awaitsSecret: rozmístění a odpověď plynou z tajných dat, výstřel ne', () => {
    const s0 = logic.setup({ rng: createRng('y'), starter: 'A' });
    expect(battleshipHidden.awaitsSecret(s0, 'A')).toBe(true);
    const s = started();
    expect(battleshipHidden.awaitsSecret(s, 'A')).toBe(false);
    expect(battleshipHidden.respond(s, 'A', FLEET_A)).toBeNull();
    const pending = play(s, 'A', { kind: 'shot', cell: 5 });
    expect(battleshipHidden.awaitsSecret(pending, 'B')).toBe(true);
    expect(battleshipHidden.locked(s0)).toBe(false);
    expect(battleshipHidden.locked(s)).toBe(true);
  });
});

describe('Lodě – AI', () => {
  /** Kolik výstřelů AI potřebuje na potopení flotily. */
  function shotsToWin(difficulty: Difficulty, seed: string): number {
    const rng = createRng(seed);
    const target = randomFleet(rng);
    const fleets: Record<PlayerSlot, Fleet> = { A: FLEET_A, B: target };
    let s = logic.setup({ rng, starter: 'A' });
    for (let step = 0; step < 500 && !logic.outcome(s); step++) {
      const player = logic.toMove(s)[0];
      if (!player) break;
      const view = logic.view(s, player);
      const move =
        battleshipHidden.respond(view, player, fleets[player]) ??
        battleshipAIMove(view, { difficulty, rng, me: player, memory: new AIMemory() });
      s = play(s, player, move);
      // Měříme jen střelbu A: B nikdy nestřílí, tah se vrací A.
      if (s.phase === 'battle' && s.pending === null) s = { ...s, turn: 'A' };
    }
    expect(logic.outcome(s)?.kind).toBe('win');
    return s.shots.A.length;
  }

  it.each(DIFFICULTIES)('%s vždy dohraje a nikdy nestřílí dvakrát na stejné pole', (d) => {
    for (let i = 0; i < 5; i++) expect(shotsToWin(d, `ai-${d}-${i}`)).toBeLessThanOrEqual(CELLS);
  });

  it('těžká AI potřebuje v průměru výrazně méně výstřelů než lehká', () => {
    const avg = (d: Difficulty): number => {
      let total = 0;
      for (let i = 0; i < 12; i++) total += shotsToWin(d, `avg-${i}`);
      return total / 12;
    };
    const easy = avg('easy');
    const hard = avg('hard');
    expect(hard).toBeLessThan(easy - 8);
    expect(hard).toBeLessThan(42);
  });

  it('střední a těžká AI nestřílí do jisté vody kolem potopené lodi', () => {
    let s = started();
    for (const cell of [cellOf(7, 0), cellOf(7, 1)]) {
      s = respondAll(play(s, 'A', { kind: 'shot', cell }));
    }
    const water = seaKnowledge(s.shots.A).water;
    expect(water.has(cellOf(6, 0))).toBe(true);
    for (const difficulty of ['medium', 'hard'] as const) {
      const rng = createRng(`water-${difficulty}`);
      for (let i = 0; i < 30; i++) {
        const move = battleshipAIMove(logic.view(s, 'A'), {
          difficulty,
          rng,
          me: 'A',
          memory: new AIMemory(),
        });
        expect(move.kind === 'shot' && water.has(move.cell)).toBe(false);
      }
    }
  });
});
