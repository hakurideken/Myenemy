import { describe, expect, it } from 'vitest';
import { AIMemory, type AIContext } from '../../core/MiniGame';
import { DRAW, win, type Difficulty, type PlayerSlot } from '../../core/types';
import { createRng, type Rng } from '../../core/util/rng';
import { bestMoves, tttAIMove, winningCells } from './ai';
import {
  MAX_MARKS,
  MOVE_LIMIT,
  nextToVanish,
  tttLogic as logic,
  tttMoveSchema,
  type TttState,
} from './logic';
import { solution, VALUE } from './solver';

const play = (moves: number[], starter: PlayerSlot = 'A'): TttState => {
  let s = logic.setup({ rng: createRng('x'), starter });
  for (const cell of moves) {
    expect(logic.legal(s, s.turn, { cell }), `tah na ${cell}`).toBe(true);
    s = logic.apply(s, s.turn, { cell });
  }
  return s;
};

describe('Piškvorky – pravidla se 3 značkami', () => {
  it('trojice v řadě vyhrává (řádek, sloupec, úhlopříčka)', () => {
    expect(logic.outcome(play([0, 3, 1, 4, 2]))).toEqual(win('A'));
    expect(logic.outcome(play([0, 1, 3, 2, 6]))).toEqual(win('A'));
    expect(logic.outcome(play([1, 0, 2, 4, 3, 8]))).toEqual(win('B'));
    expect(play([0, 3, 1, 4, 2]).winLine).toEqual([0, 1, 2]);
  });

  it('čtvrtou značkou zmizí hráči jeho nejstarší', () => {
    // A: 0, 8, 6 · B: 4, 2, 1 → A položí 7, zmizí mu 0.
    const s = play([0, 4, 8, 2, 6, 1, 7]);
    expect(s.marks.A).toEqual([8, 6, 7]);
    expect(s.cells[0]).toBeNull();
    expect(s.vanished).toBe(0);
    expect(s.marks.B).toEqual([4, 2, 1]);
    expect(s.marks.A).toHaveLength(MAX_MARKS);
    // A má 6-7-8 – zmizelá nula už se nepočítá, ale trojice je hotová.
    expect(logic.outcome(s)).toEqual(win('A'));
  });

  it('pole, kde nejstarší značka ještě leží, je obsazené', () => {
    const s = play([0, 4, 8, 2, 7]);
    // B: 4, 2 – zatím jen dvě. A: 0, 8, 7 – nejstarší je 0.
    expect(nextToVanish(s, 'A')).toBe(0);
    expect(nextToVanish(s, 'B')).toBeNull();
    const t = play([0, 4, 8, 2, 7, 5]);
    expect(logic.legal(t, 'A', { cell: 0 })).toBe(false);
    expect(logic.legal(t, 'A', { cell: 1 })).toBe(true);
  });

  it('zmizelá značka může soupeři otevřít řadu', () => {
    // A: 4, 0, 2 – nejstarší 4 blokuje řadu 3-4-5 hráče B (8, 3, 5).
    const s = play([4, 8, 0, 3, 2, 5], 'A');
    expect(winningCells(s, 'B')).toEqual([]);
    const after = logic.apply(s, 'A', { cell: 7 });
    expect(after.cells[4]).toBeNull();
    // B položí 4, zmizí mu nejstarší 8 a má 3-4-5.
    expect(winningCells(after, 'B')).toEqual([4]);
  });

  it('pojistka: po limitu tahů bez trojice je kolo nerozhodné', () => {
    const s: TttState = {
      ...logic.setup({ rng: createRng('y'), starter: 'A' }),
      moves: MOVE_LIMIT,
    };
    expect(logic.outcome(s)).toEqual(DRAW);
    expect(logic.toMove(s)).toEqual([]);
  });

  it('hraje jen hráč na tahu a jen do prázdného pole; po výhře už nikdo', () => {
    const s = play([4], 'B');
    expect(s.turn).toBe('A');
    expect(logic.legal(s, 'B', { cell: 0 })).toBe(false);
    expect(logic.legal(s, 'A', { cell: 4 })).toBe(false);
    const won = play([0, 3, 1, 4, 2]);
    expect(logic.legal(won, 'B', { cell: 8 })).toBe(false);
    expect(tttMoveSchema.safeParse({ cell: 9 }).success).toBe(false);
  });
});

function duel(a: Difficulty | 'random', b: Difficulty | 'random', rng: Rng, starter: PlayerSlot) {
  let s = logic.setup({ rng, starter });
  const memory = new AIMemory();
  while (logic.outcome(s) === null) {
    const player = s.turn;
    const level = player === 'A' ? a : b;
    const ctx: AIContext = {
      difficulty: level === 'random' ? 'easy' : level,
      rng,
      me: player,
      memory,
    };
    const free = s.cells.flatMap((c, i) => (c === null ? [i] : []));
    const move =
      level === 'random' ? { cell: rng.pick(free) } : tttAIMove(logic.view(s, player), ctx);
    s = logic.apply(s, player, move);
  }
  return logic.outcome(s);
}

describe('Piškvorky – AI', () => {
  it('výhru vidí i s ohledem na mizející značku', () => {
    // A: 0, 1, 6 (nejstarší 0) – „trojice“ 0-1-2 by po tahu na 2 neplatila.
    expect(winningCells(play([0, 4, 1, 8, 6, 5]), 'A')).toEqual([]);
    // A: 5, 0, 1 (nejstarší 5) – tah na 2 dá 0-1-2.
    expect(winningCells(play([5, 4, 0, 8, 1, 6]), 'A')).toEqual([2]);
  });

  it('vyřešený strom: začínající si může vynutit výhru', () => {
    const start = solution().lookup([], [], true);
    expect(start.value).toBe(VALUE.WIN);
    expect(start.dist).toBe(13);
    expect(bestMoves(play([0, 3, 1, 4]), 'A')).toEqual([2]);
  });

  it('těžká jako začínající vyhraje vždy, i proti sobě', () => {
    const rng = createRng('ttt-hard');
    for (let i = 0; i < 40; i++) {
      for (const opp of ['random', 'easy', 'medium'] as const) {
        expect(duel('hard', opp, rng, 'A')).toEqual(win('A'));
      }
    }
    for (let i = 0; i < 4; i++) expect(duel('hard', 'hard', rng, 'B')).toEqual(win('B'));
  });

  it('střední porazí lehkou ve většině her', () => {
    const rng = createRng('ttt-medium');
    let wins = 0;
    for (let i = 0; i < 100; i++) {
      const o = duel('medium', 'easy', rng, i % 2 === 0 ? 'A' : 'B');
      if (o?.kind === 'win' && o.winner === 'A') wins++;
    }
    expect(wins).toBeGreaterThan(80);
  });
});
