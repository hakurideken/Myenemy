import { describe, expect, it } from 'vitest';
import { AIMemory, type AIContext } from '../../core/MiniGame';
import { DRAW, win, type Difficulty, type PlayerSlot } from '../../core/types';
import { createRng, type Rng } from '../../core/util/rng';
import { bestMoves, tttAIMove, winningCell } from './ai';
import { tttLogic as logic, tttMoveSchema, type Cell, type TttState } from './logic';

const board = (spec: string): Cell[] =>
  [...spec.replace(/\s/g, '')].map((ch) => (ch === 'X' ? 'A' : ch === 'O' ? 'B' : null));

const play = (moves: number[], starter: PlayerSlot = 'A'): TttState => {
  let s = logic.setup({ rng: createRng('x'), starter });
  for (const cell of moves) s = logic.apply(s, s.turn, { cell });
  return s;
};

describe('Piškvorky – pravidla', () => {
  it('trojice v řadě vyhrává (řádek, sloupec, úhlopříčka)', () => {
    expect(logic.outcome(play([0, 3, 1, 4, 2]))).toEqual(win('A'));
    expect(logic.outcome(play([0, 1, 3, 2, 6]))).toEqual(win('A'));
    expect(logic.outcome(play([1, 0, 2, 4, 3, 8]))).toEqual(win('B'));
    expect(play([0, 3, 1, 4, 2]).winLine).toEqual([0, 1, 2]);
  });

  it('plná deska bez trojice je remíza', () => {
    const s = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(logic.outcome(s)).toEqual(DRAW);
    expect(logic.toMove(s)).toEqual([]);
  });

  it('hraje jen hráč na tahu a jen do prázdného pole; po výhře už nikdo', () => {
    const s = play([4], 'B');
    expect(s.turn).toBe('A');
    expect(logic.legal(s, 'B', { cell: 0 })).toBe(false);
    expect(logic.legal(s, 'A', { cell: 4 })).toBe(false);
    expect(logic.legal(s, 'A', { cell: 0 })).toBe(true);
    const won = play([0, 3, 1, 4, 2]);
    expect(logic.legal(won, 'B', { cell: 8 })).toBe(false);
  });

  it('schéma tahu', () => {
    expect(tttMoveSchema.safeParse({ cell: 8 }).success).toBe(true);
    expect(tttMoveSchema.safeParse({ cell: 9 }).success).toBe(false);
    expect(tttMoveSchema.safeParse({ cell: 1.5 }).success).toBe(false);
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
    const empty = s.cells.flatMap((c, i) => (c === null ? [i] : []));
    const move =
      level === 'random' ? { cell: rng.pick(empty) } : tttAIMove(logic.view(s, player), ctx);
    s = logic.apply(s, player, move);
  }
  return logic.outcome(s);
}

describe('Piškvorky – AI', () => {
  it('najde výhru i hrozbu soupeře', () => {
    expect(winningCell(board('XX. O.. O..'), 'A')).toBe(2);
    expect(winningCell(board('XX. O.. O..'), 'B')).toBeNull();
    expect(bestMoves(board('XX. OO. ...'), 'B')).toEqual([5]);
    expect(bestMoves(board('XX. OO. ...'), 'A')).toEqual([2]);
  });

  it('těžká nikdy neprohraje (proti náhodě ani proti sobě)', () => {
    const rng = createRng('ttt-hard');
    for (let i = 0; i < 60; i++) {
      const starter: PlayerSlot = i % 2 === 0 ? 'A' : 'B';
      expect(duel('hard', 'random', rng, starter)).not.toEqual(win('B'));
    }
    for (let i = 0; i < 6; i++) expect(duel('hard', 'hard', rng, 'A')).toEqual(DRAW);
  });

  it('střední porazí náhodného hráče většinou a skoro nikdy neprohraje', () => {
    const rng = createRng('ttt-medium');
    let wins = 0;
    let losses = 0;
    for (let i = 0; i < 100; i++) {
      const o = duel('medium', 'random', rng, i % 2 === 0 ? 'A' : 'B');
      if (o?.kind === 'win') {
        if (o.winner === 'A') wins++;
        else losses++;
      }
    }
    expect(wins).toBeGreaterThan(60);
    expect(losses).toBeLessThan(15);
  });
});
