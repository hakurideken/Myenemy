import type { AIContext } from '../../core/MiniGame';
import { otherPlayer, type PlayerSlot } from '../../core/types';
import type { Rng } from '../../core/util/rng';
import { findWinLine, isFull, LINES, type Cell, type TttMove, type TttView } from './logic';

const empties = (cells: readonly Cell[]): number[] =>
  cells.flatMap((c, i) => (c === null ? [i] : []));

/** Pole, kterým hráč hned dokončí trojici. */
export function winningCell(cells: readonly Cell[], player: PlayerSlot): number | null {
  for (const [a, b, c] of LINES) {
    const line = [a, b, c];
    const mine = line.filter((i) => cells[i] === player).length;
    const free = line.filter((i) => cells[i] === null);
    if (mine === 2 && free.length === 1) return free[0] ?? null;
  }
  return null;
}

/** Negamax: skóre z pohledu hráče na tahu (rychlejší výhra = vyšší skóre). */
function negamax(cells: Cell[], player: PlayerSlot, depth: number): number {
  if (findWinLine(cells)) return -(10 - depth);
  if (isFull(cells)) return 0;
  let best = -Infinity;
  for (const i of empties(cells)) {
    cells[i] = player;
    best = Math.max(best, -negamax(cells, otherPlayer(player), depth + 1));
    cells[i] = null;
  }
  return best;
}

/** Všechny nejlepší tahy (dokonalá hra). */
export function bestMoves(cells: readonly Cell[], player: PlayerSlot): number[] {
  const board = [...cells];
  let best = -Infinity;
  let moves: number[] = [];
  for (const i of empties(board)) {
    board[i] = player;
    const score = -negamax(board, otherPlayer(player), 1);
    board[i] = null;
    if (score > best) {
      best = score;
      moves = [i];
    } else if (score === best) {
      moves.push(i);
    }
  }
  return moves;
}

function preferredCell(cells: readonly Cell[], rng: Rng): number {
  for (const group of [[4], [0, 2, 6, 8], [1, 3, 5, 7]]) {
    const free = group.filter((i) => cells[i] === null);
    if (free.length > 0) return rng.pick(free);
  }
  return rng.pick(empties(cells));
}

/**
 * lehká  – většinou náhodně, někdy si všimne výhry,
 * střední – vyhraje / zablokuje, jinak střed a rohy (občas chybuje),
 * těžká  – dokonalá hra (nikdy neprohraje).
 */
export function tttAIMove(view: TttView, ai: AIContext): TttMove {
  const { cells } = view;
  const { rng, difficulty, me } = ai;
  if (difficulty === 'hard') return { cell: rng.pick(bestMoves(cells, me)) };

  const winNow = winningCell(cells, me);
  if (difficulty === 'easy') {
    if (winNow !== null && rng.chance(0.4)) return { cell: winNow };
    return { cell: rng.pick(empties(cells)) };
  }
  if (winNow !== null) return { cell: winNow };
  const block = winningCell(cells, otherPlayer(me));
  if (block !== null && rng.chance(0.9)) return { cell: block };
  if (rng.chance(0.2)) return { cell: rng.pick(empties(cells)) };
  return { cell: preferredCell(cells, rng) };
}
