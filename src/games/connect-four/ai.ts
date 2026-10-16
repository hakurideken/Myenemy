import type { AIContext } from '../../core/MiniGame';
import type { Difficulty, PlayerSlot } from '../../core/types';
import { cellIndex, COLS, ROWS, type C4Move, type C4View, type Cell } from './logic';

/** Střed napřed – alfa-beta pak ořezává mnohem víc. */
const ORDER = [3, 2, 4, 1, 5, 0, 6];
const WIN = 1_000_000;
const DEPTH: Record<Difficulty, number> = { easy: 1, medium: 4, hard: 7 };

/** Všechna „okna“ čtyř polí, ve kterých jde vyhrát. */
const WINDOWS: readonly (readonly number[])[] = (() => {
  const out: number[][] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c <= COLS - 4) out.push([0, 1, 2, 3].map((k) => cellIndex(r, c + k)));
      if (r <= ROWS - 4) out.push([0, 1, 2, 3].map((k) => cellIndex(r + k, c)));
      if (r <= ROWS - 4 && c <= COLS - 4)
        out.push([0, 1, 2, 3].map((k) => cellIndex(r + k, c + k)));
      if (r >= 3 && c <= COLS - 4) out.push([0, 1, 2, 3].map((k) => cellIndex(r - k, c + k)));
    }
  }
  return out;
})();

type Code = 1 | 2;

function winsAt(b: Int8Array, index: number, p: Code): boolean {
  const row = Math.floor(index / COLS);
  const col = index % COLS;
  for (const [dr, dc] of [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const) {
    let count = 1;
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && b[cellIndex(r, c)] === p) {
        count++;
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (count >= 4) return true;
  }
  return false;
}

/** Heuristika z pohledu hráče p: otevřené trojice a dvojice, kontrola středu. */
function evaluate(b: Int8Array, p: Code): number {
  const q: Code = p === 1 ? 2 : 1;
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    const v = b[cellIndex(r, 3)];
    if (v === p) score += 3;
    else if (v === q) score -= 3;
  }
  for (const w of WINDOWS) {
    let mine = 0;
    let theirs = 0;
    for (const i of w) {
      const v = b[i];
      if (v === p) mine++;
      else if (v === q) theirs++;
    }
    if (theirs === 0) score += mine === 3 ? 5 : mine === 2 ? 2 : 0;
    else if (mine === 0) score -= theirs === 3 ? 4 : theirs === 2 ? 1 : 0;
  }
  return score;
}

function negamax(
  b: Int8Array,
  h: Int8Array,
  p: Code,
  depth: number,
  alpha: number,
  beta: number,
): number {
  if (depth === 0) return evaluate(b, p);
  let best = -Infinity;
  for (const c of ORDER) {
    const row = h[c] ?? ROWS;
    if (row >= ROWS) continue;
    const index = cellIndex(row, c);
    b[index] = p;
    h[c] = row + 1;
    const score = winsAt(b, index, p)
      ? WIN + depth
      : -negamax(b, h, p === 1 ? 2 : 1, depth - 1, -beta, -alpha);
    h[c] = row;
    b[index] = 0;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best === -Infinity ? 0 : best;
}

/** Ohodnocení všech hratelných sloupců pro hráče `me` (vyšší = lepší). */
export function scoreColumns(
  board: readonly Cell[],
  me: PlayerSlot,
  depth: number,
): { column: number; score: number }[] {
  const code = (p: Cell): number => (p === null ? 0 : p === me ? 1 : 2);
  const b = Int8Array.from(board, code);
  const h = new Int8Array(COLS);
  for (let c = 0; c < COLS; c++) {
    let row = 0;
    while (row < ROWS && b[cellIndex(row, c)] !== 0) row++;
    h[c] = row;
  }
  const out: { column: number; score: number }[] = [];
  for (const c of ORDER) {
    const row = h[c] ?? ROWS;
    if (row >= ROWS) continue;
    const index = cellIndex(row, c);
    b[index] = 1;
    h[c] = row + 1;
    const score = winsAt(b, index, 1)
      ? WIN + depth
      : -negamax(b, h, 2, depth - 1, -Infinity, Infinity);
    h[c] = row;
    b[index] = 0;
    out.push({ column: c, score });
  }
  return out;
}

/**
 * lehká  – mělký pohled (1 tah) a často náhodný sloupec,
 * střední – prohledá 4 tahy dopředu,
 * těžká  – 7 tahů dopředu s alfa-beta ořezáváním.
 */
export function c4AIMove(view: C4View, ai: AIContext): C4Move {
  const scored = scoreColumns(view.board, ai.me, DEPTH[ai.difficulty]);
  if (ai.difficulty === 'easy' && ai.rng.chance(0.35)) {
    return { column: ai.rng.pick(scored).column };
  }
  const best = Math.max(...scored.map((s) => s.score));
  return { column: ai.rng.pick(scored.filter((s) => s.score === best)).column };
}
