import { describe, expect, it } from 'vitest';
import { AIMemory, type AIContext } from '../../core/MiniGame';
import { DRAW, win, type Difficulty, type PlayerSlot } from '../../core/types';
import { createRng, type Rng } from '../../core/util/rng';
import { c4AIMove, scoreColumns } from './ai';
import { c4Logic as logic, c4MoveSchema, cellIndex, COLS, dropRow, type C4State } from './logic';

const play = (columns: number[], starter: PlayerSlot = 'A'): C4State => {
  let s = logic.setup({ rng: createRng('x'), starter });
  for (const column of columns) s = logic.apply(s, s.turn, { column });
  return s;
};

describe('Čtyři v řadě – pravidla', () => {
  it('kámen spadne na nejnižší volné místo', () => {
    const s = play([3, 3, 3]);
    expect(s.board[cellIndex(0, 3)]).toBe('A');
    expect(s.board[cellIndex(1, 3)]).toBe('B');
    expect(s.board[cellIndex(2, 3)]).toBe('A');
    expect(dropRow(s.board, 3)).toBe(3);
  });

  it('čtveřice vodorovně, svisle i úhlopříčně vyhrává', () => {
    expect(logic.outcome(play([0, 0, 1, 1, 2, 2, 3]))).toEqual(win('A'));
    expect(logic.outcome(play([0, 1, 0, 1, 0, 1, 0]))).toEqual(win('A'));
    // A: (0,0) (1,1) (2,2) (3,3)
    expect(logic.outcome(play([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]))).toEqual(win('A'));
    expect(play([0, 0, 1, 1, 2, 2, 3]).winLine).toEqual([0, 1, 2, 3]);
  });

  it('plný sloupec nejde hrát; tah mimo pořadí také ne', () => {
    const s = play([0, 0, 0, 0, 0, 0]);
    expect(logic.legal(s, s.turn, { column: 0 })).toBe(false);
    expect(logic.legal(s, s.turn === 'A' ? 'B' : 'A', { column: 1 })).toBe(false);
    expect(c4MoveSchema.safeParse({ column: 7 }).success).toBe(false);
  });

  it('plná deska bez čtveřice je remíza', () => {
    // Sloupce plněné po dvojicích tak, aby nikdo nesložil čtyři.
    const order = [
      0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 4, 5, 4, 5, 4, 5, 5,
      4, 5, 4, 5, 4, 6, 6, 6, 6, 6, 6,
    ];
    const s = play(order);
    expect(s.board.every((c) => c !== null)).toBe(true);
    expect(logic.outcome(s)).toEqual(DRAW);
  });
});

function duel(a: Difficulty | 'random', b: Difficulty | 'random', rng: Rng, starter: PlayerSlot) {
  let s = logic.setup({ rng, starter });
  const memory = new AIMemory();
  while (logic.outcome(s) === null) {
    const player = s.turn;
    const level = player === 'A' ? a : b;
    let column: number;
    if (level === 'random') {
      const free = Array.from({ length: COLS }, (_, c) => c).filter(
        (c) => dropRow(s.board, c) >= 0,
      );
      column = rng.pick(free);
    } else {
      const ctx: AIContext = { difficulty: level, rng, me: player, memory };
      column = c4AIMove(logic.view(s, player), ctx).column;
    }
    s = logic.apply(s, player, { column });
  }
  return logic.outcome(s);
}

describe('Čtyři v řadě – AI', () => {
  it('vezme okamžitou výhru a zablokuje soupeřovu', () => {
    const threat = play([0, 6, 1, 6, 2]); // A hrozí ve sloupci 3, na tahu je B
    const best = (s: C4State, depth: number) => {
      const scored = scoreColumns(s.board, s.turn, depth);
      const top = Math.max(...scored.map((x) => x.score));
      return scored.filter((x) => x.score === top).map((x) => x.column);
    };
    expect(best(threat, 4)).toEqual([3]);
    const winNow = play([0, 6, 1, 6, 2, 5]); // A může vyhrát sloupcem 3
    expect(best(winNow, 1)).toEqual([3]);
  });

  it('těžká porazí náhodného hráče skoro vždy', () => {
    const rng = createRng('c4-hard');
    let wins = 0;
    for (let i = 0; i < 6; i++) {
      const o = duel('hard', 'random', rng, i % 2 === 0 ? 'A' : 'B');
      if (o?.kind === 'win' && o.winner === 'A') wins++;
    }
    expect(wins).toBe(6);
  });

  it('střední porazí lehkou většinou', () => {
    const rng = createRng('c4-medium');
    let wins = 0;
    for (let i = 0; i < 8; i++) {
      const o = duel('medium', 'easy', rng, i % 2 === 0 ? 'A' : 'B');
      if (o?.kind === 'win' && o.winner === 'A') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(5);
  });

  it('tah těžké AI je rychlý i na prázdné desce', () => {
    const s = logic.setup({ rng: createRng('t'), starter: 'A' });
    const start = performance.now();
    c4AIMove(logic.view(s, 'A'), {
      difficulty: 'hard',
      rng: createRng('t'),
      me: 'A',
      memory: new AIMemory(),
    });
    expect(performance.now() - start).toBeLessThan(1500);
  });
});
