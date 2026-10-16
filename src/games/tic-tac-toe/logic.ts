import { z } from 'zod';
import type { GameLogic } from '../../core/MiniGame';
import { DRAW, otherPlayer, win, type PlayerSlot } from '../../core/types';

export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export type Cell = PlayerSlot | null;

export interface TttState {
  readonly cells: readonly Cell[];
  readonly turn: PlayerSlot;
  readonly winLine: readonly number[] | null;
  readonly last: number | null;
}

export type TttView = TttState;

export interface TttMove {
  readonly cell: number;
}

const slot = z.enum(['A', 'B']);
const index = z.number().int().min(0).max(8);

export const tttMoveSchema = z.object({ cell: index });
export const tttViewSchema = z.object({
  cells: z.array(slot.nullable()).length(9),
  turn: slot,
  winLine: z.array(index).length(3).nullable(),
  last: index.nullable(),
});

export function findWinLine(cells: readonly Cell[]): readonly number[] | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    const owner = cells[a];
    if (owner && owner === cells[b] && owner === cells[c]) return line;
  }
  return null;
}

export const isFull = (cells: readonly Cell[]): boolean => cells.every((c) => c !== null);

/** Remíza = plná deska bez trojice. */
export const tttLogic: GameLogic<TttState, TttMove, TttView> = {
  setup: ({ starter }) => ({
    cells: Array.from({ length: 9 }, (): Cell => null),
    turn: starter,
    winLine: null,
    last: null,
  }),
  toMove: (s) => (s.winLine || isFull(s.cells) ? [] : [s.turn]),
  legal: (s, player, move) => s.turn === player && !s.winLine && s.cells[move.cell] === null,
  apply: (s, player, move) => {
    const cells = [...s.cells];
    cells[move.cell] = player;
    return { cells, turn: otherPlayer(player), winLine: findWinLine(cells), last: move.cell };
  },
  outcome: (s) => {
    const owner = s.winLine ? s.cells[s.winLine[0] ?? -1] : null;
    if (owner) return win(owner);
    return isFull(s.cells) ? DRAW : null;
  },
  view: (s) => s,
};
