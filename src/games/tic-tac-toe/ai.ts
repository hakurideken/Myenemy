import type { AIContext } from '../../core/MiniGame';
import { otherPlayer, type PlayerSlot } from '../../core/types';
import type { Rng } from '../../core/util/rng';
import { tttLogic, type TttMove, type TttState, type TttView } from './logic';
import { solution, VALUE } from './solver';

const freeCells = (s: TttState): number[] => s.cells.flatMap((c, i) => (c === null ? [i] : []));

/** Stav, jako by byl na tahu daný hráč (pro „co kdyby“ úvahy). */
const asTurn = (s: TttState, player: PlayerSlot): TttState => ({ ...s, turn: player });

/** Pole, kterými hráč hned vyhraje – s ohledem na to, že mu zmizí nejstarší značka. */
export function winningCells(s: TttState, player: PlayerSlot): number[] {
  const state = asTurn(s, player);
  return freeCells(state).filter((cell) => tttLogic.apply(state, player, { cell }).winLine);
}

/** Tahy, po kterých soupeř nemůže hned vyhrát (zmizelá značka může otevřít řadu). */
function safeCells(s: TttState, player: PlayerSlot): number[] {
  const opp = otherPlayer(player);
  return freeCells(s).filter(
    (cell) => winningCells(tttLogic.apply(asTurn(s, player), player, { cell }), opp).length === 0,
  );
}

/** Dokonalá hra podle vyřešeného stromu: vyhrát co nejdřív, prohrávat co nejpozději. */
export function bestMoves(s: TttState, player: PlayerSlot): number[] {
  const solved = solution();
  let best: number[] = [];
  let bestScore = -Infinity;
  for (const cell of freeCells(s)) {
    const next = tttLogic.apply(asTurn(s, player), player, { cell });
    // Hodnota je z pohledu soupeře (ten je po tahu na řadě).
    const { value, dist } = next.winLine
      ? { value: VALUE.LOSS, dist: 0 }
      : solved.lookup(next.marks.A, next.marks.B, next.turn === 'A');
    const score = value === VALUE.LOSS ? 1000 - dist : value === VALUE.WIN ? -1000 + dist : 0;
    if (score > bestScore) {
      bestScore = score;
      best = [cell];
    } else if (score === bestScore) {
      best.push(cell);
    }
  }
  return best;
}

function preferredCell(cells: readonly number[], rng: Rng): number {
  for (const group of [[4], [0, 2, 6, 8], [1, 3, 5, 7]]) {
    const free = group.filter((i) => cells.includes(i));
    if (free.length > 0) return rng.pick(free);
  }
  return rng.pick(cells);
}

/**
 * lehká  – většinou náhodně, někdy si všimne výhry,
 * střední – vyhraje / zablokuje a hlídá, aby zmizelá značka neotevřela soupeři řadu,
 * těžká  – dokonalá hra podle vyřešeného stromu (kdo začíná, může si vynutit výhru).
 */
export function tttAIMove(view: TttView, ai: AIContext): TttMove {
  const { rng, difficulty, me } = ai;
  const free = freeCells(view);
  if (difficulty === 'hard') return { cell: rng.pick(bestMoves(view, me)) };

  const winNow = winningCells(view, me);
  if (difficulty === 'easy') {
    if (winNow.length > 0 && rng.chance(0.4)) return { cell: rng.pick(winNow) };
    return { cell: rng.pick(free) };
  }
  if (winNow.length > 0) return { cell: rng.pick(winNow) };
  const safe = safeCells(view, me);
  const pool = safe.length > 0 && rng.chance(0.9) ? safe : free;
  if (rng.chance(0.15)) return { cell: rng.pick(pool) };
  return { cell: preferredCell(pool, rng) };
}
