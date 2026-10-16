import { z } from 'zod';
import type { GameLogic } from '../../core/MiniGame';
import { DRAW, otherPlayer, win, type PerPlayer, type PlayerSlot } from '../../core/types';

/** 4×4 políčka = 5×5 teček, 40 čar, 16 čtverečků (remíza 8:8 je možná). */
export const SIZE = 4;
export const DOTS = SIZE + 1;
export const H_LINES = DOTS * SIZE;
export const LINE_COUNT = 2 * DOTS * SIZE;
export const BOX_COUNT = SIZE * SIZE;

/** Vodorovná čára: řádek teček 0–4, mezera 0–3. */
export const hLine = (row: number, col: number): number => row * SIZE + col;
/** Svislá čára: řádek políček 0–3, sloupec teček 0–4. */
export const vLine = (row: number, col: number): number => H_LINES + row * DOTS + col;
export const boxIndex = (row: number, col: number): number => row * SIZE + col;

/** Čáry kolem políčka: nahoře, dole, vlevo, vpravo. */
export const BOX_LINES: readonly (readonly number[])[] = Array.from(
  { length: BOX_COUNT },
  (_, b) => {
    const row = Math.floor(b / SIZE);
    const col = b % SIZE;
    return [hLine(row, col), hLine(row + 1, col), vLine(row, col), vLine(row, col + 1)];
  },
);

/** Políčka sousedící s čarou (1 nebo 2). */
export const LINE_BOXES: readonly (readonly number[])[] = Array.from(
  { length: LINE_COUNT },
  (_, line) => BOX_LINES.flatMap((lines, b) => (lines.includes(line) ? [b] : [])),
);

export type Owner = PlayerSlot | null;

export interface DotsState {
  readonly lines: readonly Owner[];
  readonly boxes: readonly Owner[];
  readonly turn: PlayerSlot;
  readonly score: PerPlayer<number>;
  readonly last: number | null;
}

export type DotsView = DotsState;

export interface DotsMove {
  readonly line: number;
}

const slot = z.enum(['A', 'B']);

export const dotsMoveSchema = z.object({
  line: z
    .number()
    .int()
    .min(0)
    .max(LINE_COUNT - 1),
});
export const dotsViewSchema = z.object({
  lines: z.array(slot.nullable()).length(LINE_COUNT),
  boxes: z.array(slot.nullable()).length(BOX_COUNT),
  turn: slot,
  score: z.object({
    A: z.number().int().min(0).max(BOX_COUNT),
    B: z.number().int().min(0).max(BOX_COUNT),
  }),
  last: z
    .number()
    .int()
    .min(0)
    .max(LINE_COUNT - 1)
    .nullable(),
});

export const isOver = (s: DotsState): boolean => s.boxes.every((b) => b !== null);

/** Políčka, která čára uzavře (ještě nevlastněná, ostatní tři strany už nakreslené). */
export function boxesClosedBy(lines: readonly Owner[], line: number): number[] {
  return (LINE_BOXES[line] ?? []).filter((b) =>
    (BOX_LINES[b] ?? []).every((l) => l === line || lines[l] !== null),
  );
}

/**
 * Kdo uzavře políčko, získá bod a hraje znovu.
 * Remíza = stejný počet políček (8:8).
 */
export const dotsLogic: GameLogic<DotsState, DotsMove, DotsView> = {
  setup: ({ starter }) => ({
    lines: Array.from({ length: LINE_COUNT }, (): Owner => null),
    boxes: Array.from({ length: BOX_COUNT }, (): Owner => null),
    turn: starter,
    score: { A: 0, B: 0 },
    last: null,
  }),
  toMove: (s) => (isOver(s) ? [] : [s.turn]),
  legal: (s, player, move) => s.turn === player && !isOver(s) && s.lines[move.line] === null,
  apply: (s, player, move) => {
    const closed = boxesClosedBy(s.lines, move.line);
    const lines = [...s.lines];
    lines[move.line] = player;
    const boxes = [...s.boxes];
    for (const b of closed) boxes[b] = player;
    return {
      lines,
      boxes,
      turn: closed.length > 0 ? player : otherPlayer(player),
      score: { ...s.score, [player]: s.score[player] + closed.length },
      last: move.line,
    };
  },
  outcome: (s) => {
    if (!isOver(s)) return null;
    if (s.score.A === s.score.B) return DRAW;
    return win(s.score.A > s.score.B ? 'A' : 'B');
  },
  view: (s) => s,
};
