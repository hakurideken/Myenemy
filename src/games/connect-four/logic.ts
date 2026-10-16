import { z } from 'zod';
import type { GameLogic } from '../../core/MiniGame';
import { DRAW, otherPlayer, win, type PlayerSlot } from '../../core/types';

export const COLS = 7;
export const ROWS = 6;
export const CELLS = COLS * ROWS;

/** Řádek 0 je dole. */
export const cellIndex = (row: number, col: number): number => row * COLS + col;

export type Cell = PlayerSlot | null;

export interface C4State {
  readonly board: readonly Cell[];
  readonly turn: PlayerSlot;
  readonly winLine: readonly number[] | null;
  readonly last: number | null;
}

export type C4View = C4State;

export interface C4Move {
  readonly column: number;
}

const slot = z.enum(['A', 'B']);
const index = z
  .number()
  .int()
  .min(0)
  .max(CELLS - 1);

export const c4MoveSchema = z.object({
  column: z
    .number()
    .int()
    .min(0)
    .max(COLS - 1),
});
export const c4ViewSchema = z.object({
  board: z.array(slot.nullable()).length(CELLS),
  turn: slot,
  winLine: z.array(index).min(4).max(7).nullable(),
  last: index.nullable(),
});

/** Nejnižší volný řádek ve sloupci, −1 = plný. */
export function dropRow(board: readonly Cell[], column: number): number {
  for (let row = 0; row < ROWS; row++) if (board[cellIndex(row, column)] === null) return row;
  return -1;
}

const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** Řada 4+ stejných kamenů procházející polem, nebo null. */
export function winningRun(board: readonly Cell[], index: number): number[] | null {
  const owner = board[index];
  if (!owner) return null;
  const row = Math.floor(index / COLS);
  const col = index % COLS;
  for (const [dr, dc] of DIRECTIONS) {
    const run = [index];
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[cellIndex(r, c)] === owner) {
        run.push(cellIndex(r, c));
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (run.length >= 4) return run.sort((a, b) => a - b);
  }
  return null;
}

export const isFull = (board: readonly Cell[]): boolean => board.every((c) => c !== null);

/** Remíza = plná deska bez čtveřice. */
export const c4Logic: GameLogic<C4State, C4Move, C4View> = {
  setup: ({ starter }) => ({
    board: Array.from({ length: CELLS }, (): Cell => null),
    turn: starter,
    winLine: null,
    last: null,
  }),
  toMove: (s) => (s.winLine || isFull(s.board) ? [] : [s.turn]),
  legal: (s, player, move) => s.turn === player && !s.winLine && dropRow(s.board, move.column) >= 0,
  apply: (s, player, move) => {
    const board = [...s.board];
    const index = cellIndex(dropRow(board, move.column), move.column);
    board[index] = player;
    return { board, turn: otherPlayer(player), winLine: winningRun(board, index), last: index };
  },
  outcome: (s) => {
    const owner = s.winLine ? s.board[s.winLine[0] ?? -1] : null;
    if (owner) return win(owner);
    return isFull(s.board) ? DRAW : null;
  },
  view: (s) => s,
};
