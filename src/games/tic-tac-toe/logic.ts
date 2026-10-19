import { z } from 'zod';
import type { GameLogic } from '../../core/MiniGame';
import { DRAW, otherPlayer, win, type PerPlayer, type PlayerSlot } from '../../core/types';

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

/** Kolik značek smí mít hráč na desce; s další mu ta nejstarší zmizí. */
export const MAX_MARKS = 3;
/** Pojistka proti nekonečné hře: po tolika tazích bez trojice je kolo nerozhodné. */
export const MOVE_LIMIT = 60;

export type Cell = PlayerSlot | null;

export interface TttState {
  readonly cells: readonly Cell[];
  /** Pole se značkami hráče od nejstarší po nejnovější. */
  readonly marks: PerPlayer<readonly number[]>;
  readonly turn: PlayerSlot;
  readonly winLine: readonly number[] | null;
  readonly last: number | null;
  /** Pole, odkud v posledním tahu zmizela nejstarší značka. */
  readonly vanished: number | null;
  readonly moves: number;
}

export type TttView = TttState;

export interface TttMove {
  readonly cell: number;
}

const slot = z.enum(['A', 'B']);
const index = z.number().int().min(0).max(8);
const marks = z.array(index).max(MAX_MARKS);

export const tttMoveSchema = z.object({ cell: index });
export const tttViewSchema = z.object({
  cells: z.array(slot.nullable()).length(9),
  marks: z.object({ A: marks, B: marks }),
  turn: slot,
  winLine: z.array(index).length(3).nullable(),
  last: index.nullable(),
  vanished: index.nullable(),
  moves: z.number().int().min(0).max(MOVE_LIMIT),
});

export function findWinLine(cells: readonly Cell[]): readonly number[] | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    const owner = cells[a];
    if (owner && owner === cells[b] && owner === cells[c]) return line;
  }
  return null;
}

/** Značka, která hráči zmizí při jeho dalším tahu (null, dokud jich nemá plný počet). */
export const nextToVanish = (s: TttState, player: PlayerSlot): number | null =>
  s.marks[player].length >= MAX_MARKS ? (s.marks[player][0] ?? null) : null;

const finished = (s: TttState): boolean => s.winLine !== null || s.moves >= MOVE_LIMIT;

/**
 * Piškvorky bez remízy: každý má na desce nejvýš 3 značky – čtvrtou položí a jeho
 * nejstarší zmizí. Pole, kde nejstarší značka ještě leží, je v tom tahu obsazené.
 */
export const tttLogic: GameLogic<TttState, TttMove, TttView> = {
  setup: ({ starter }) => ({
    cells: Array.from({ length: 9 }, (): Cell => null),
    marks: { A: [], B: [] },
    turn: starter,
    winLine: null,
    last: null,
    vanished: null,
    moves: 0,
  }),
  toMove: (s) => (finished(s) ? [] : [s.turn]),
  legal: (s, player, move) => s.turn === player && !finished(s) && s.cells[move.cell] === null,
  apply: (s, player, move) => {
    const cells = [...s.cells];
    let own = [...s.marks[player], move.cell];
    let vanished: number | null = null;
    if (own.length > MAX_MARKS) {
      vanished = own[0] ?? null;
      own = own.slice(1);
      if (vanished !== null) cells[vanished] = null;
    }
    cells[move.cell] = player;
    return {
      cells,
      marks: { ...s.marks, [player]: own },
      turn: otherPlayer(player),
      winLine: findWinLine(cells),
      last: move.cell,
      vanished,
      moves: s.moves + 1,
    };
  },
  outcome: (s) => {
    const owner = s.winLine ? s.cells[s.winLine[0] ?? -1] : null;
    if (owner) return win(owner);
    return s.moves >= MOVE_LIMIT ? DRAW : null;
  },
  view: (s) => s,
};
