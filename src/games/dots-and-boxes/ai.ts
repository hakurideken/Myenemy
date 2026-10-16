import type { AIContext } from '../../core/MiniGame';
import {
  BOX_LINES,
  boxesClosedBy,
  LINE_BOXES,
  LINE_COUNT,
  type DotsMove,
  type DotsView,
  type Owner,
} from './logic';

/** Od kolika zbývajících čar těžká AI koncovku propočítá přesně (2^16 pozic). */
export const ENDGAME_LINES = 16;

const freeLines = (lines: readonly Owner[]): number[] =>
  Array.from({ length: LINE_COUNT }, (_, i) => i).filter((i) => lines[i] === null);

const sides = (lines: readonly Owner[], box: number): number =>
  (BOX_LINES[box] ?? []).filter((l) => lines[l] !== null).length;

/** Čáry, které hned uzavřou aspoň jedno políčko. */
export function capturingLines(lines: readonly Owner[]): number[] {
  return freeLines(lines).filter((l) => boxesClosedBy(lines, l).length > 0);
}

/** Bezpečná čára: nic neuzavře a nevytvoří políčko se třemi stranami. */
export function isSafe(lines: readonly Owner[], line: number): boolean {
  return lines[line] === null && (LINE_BOXES[line] ?? []).every((b) => sides(lines, b) <= 1);
}

/** Kolik políček soupeř sebere (hladově), když nakreslím tuto čáru. */
export function giveaway(lines: readonly Owner[], line: number): number {
  const board: Owner[] = [...lines];
  board[line] = 'A';
  let taken = 0;
  for (;;) {
    const capture = capturingLines(board)[0];
    if (capture === undefined) return taken;
    taken += boxesClosedBy(board, capture).length;
    board[capture] = 'B';
  }
}

/**
 * Přesné řešení koncovky: pro každou volnou čáru čistý zisk políček hráče na tahu
 * (jeho budoucí políčka − soupeřova) při dokonalé hře obou. Paměť přes bitové masky.
 */
export function solveEndgame(lines: readonly Owner[]): { line: number; value: number }[] {
  const free = freeLines(lines);
  const k = free.length;
  if (k > 20) throw new Error('solveEndgame: příliš mnoho volných čar');
  const bitOf = new Map(free.map((line, i) => [line, i]));
  // Pro každé neuzavřené políčko: maska volných čar, které mu chybí.
  const need = new Map<number, number>();
  for (let b = 0; b < BOX_LINES.length; b++) {
    let mask = 0;
    for (const l of BOX_LINES[b] ?? []) {
      const bit = bitOf.get(l);
      if (bit !== undefined) mask |= 1 << bit;
    }
    if (mask !== 0) need.set(b, mask);
  }
  const adjacent = free.map((line) =>
    (LINE_BOXES[line] ?? []).flatMap((b) => {
      const mask = need.get(b);
      return mask === undefined ? [] : [mask];
    }),
  );
  const full = (1 << k) - 1;
  const memo = new Int8Array(1 << k).fill(-128);

  const gained = (i: number, after: number): number =>
    (adjacent[i] ?? []).filter((mask) => (mask & after) === mask).length;

  const solve = (mask: number): number => {
    if (mask === full) return 0;
    const cached = memo[mask] ?? -128;
    if (cached !== -128) return cached;
    let best = -Infinity;
    for (let i = 0; i < k; i++) {
      const bit = 1 << i;
      if (mask & bit) continue;
      const next = mask | bit;
      const g = gained(i, next);
      const value = g > 0 ? g + solve(next) : -solve(next);
      if (value > best) best = value;
    }
    memo[mask] = best;
    return best;
  };

  return free.map((line, i) => {
    const next = 1 << i;
    const g = gained(i, next);
    return { line, value: g > 0 ? g + solve(next) : -solve(next) };
  });
}

/**
 * lehká  – často si nevšimne uzavíratelného políčka, jinak náhodně,
 * střední – bere políčka, hraje bezpečné čáry, obětuje nejkratší řetězec (občas chybuje),
 * těžká  – totéž bez chyb a koncovku (≤ 16 čar) propočítá přesně.
 */
export function dotsAIMove(view: DotsView, ai: AIContext): DotsMove {
  const { lines } = view;
  const { rng, difficulty } = ai;
  const free = freeLines(lines);

  if (difficulty === 'hard' && free.length <= ENDGAME_LINES) {
    const scored = solveEndgame(lines);
    const best = Math.max(...scored.map((s) => s.value));
    return { line: rng.pick(scored.filter((s) => s.value === best)).line };
  }

  const captures = capturingLines(lines);
  if (difficulty === 'easy') {
    if (captures.length > 0 && rng.chance(0.6)) return { line: rng.pick(captures) };
    return { line: rng.pick(free) };
  }
  if (captures.length > 0) return { line: rng.pick(captures) };
  if (difficulty === 'medium' && rng.chance(0.12)) return { line: rng.pick(free) };

  const safe = free.filter((l) => isSafe(lines, l));
  if (safe.length > 0) return { line: rng.pick(safe) };

  const costs = free.map((line) => ({ line, cost: giveaway(lines, line) }));
  const cheapest = Math.min(...costs.map((c) => c.cost));
  return { line: rng.pick(costs.filter((c) => c.cost === cheapest)).line };
}
