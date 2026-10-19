import { LINES, MAX_MARKS } from './logic';

/**
 * Úplné vyřešení piškvorek se 3 mizejícími značkami (retrográdní analýza).
 * Stav = pořadí značek obou hráčů + kdo je na tahu; všech dosažitelných stavů je asi
 * 147 tisíc, takže se dají spočítat jednou (zhruba čtvrt vteřiny) a pak hrát dokonale.
 * Hodnota je z pohledu hráče na tahu: výhra, prohra, nebo nekonečná hra (bez vítěze).
 */
export const VALUE = { DRAW: 0, WIN: 1, LOSS: -1 } as const;
export type Value = (typeof VALUE)[keyof typeof VALUE];

export interface Solution {
  /** Hodnota a vzdálenost (v tazích) do konce pro stav. */
  lookup(
    a: readonly number[],
    b: readonly number[],
    turnA: boolean,
  ): { value: Value; dist: number };
}

/** Seznam polí (nejvýš 3) → číslo 0–999 (každé pole +1, ať se liší i délka). */
const encode = (cells: readonly number[]): number => cells.reduce((v, c) => v * 10 + c + 1, 0);
const keyOf = (a: number, b: number, turnA: boolean): number =>
  (a * 1000 + b) * 2 + (turnA ? 0 : 1);

const isLine = (cells: readonly number[]): boolean =>
  cells.length === MAX_MARKS && LINES.some((line) => line.every((c) => cells.includes(c)));

function solve(): Solution {
  // 1) Všechny dosažitelné stavy a jejich následníci.
  const ids = new Map<number, number>();
  const marksA: (readonly number[])[] = [];
  const marksB: (readonly number[])[] = [];
  const turnA: boolean[] = [];
  const succ: number[][] = [];
  const stack: number[] = [];
  const add = (a: readonly number[], b: readonly number[], ta: boolean): number => {
    const key = keyOf(encode(a), encode(b), ta);
    let id = ids.get(key);
    if (id === undefined) {
      id = marksA.length;
      ids.set(key, id);
      marksA.push(a);
      marksB.push(b);
      turnA.push(ta);
      succ.push([]);
      stack.push(id);
    }
    return id;
  };
  add([], [], true);
  add([], [], false);
  while (stack.length > 0) {
    const id = stack.pop() ?? 0;
    const a = marksA[id] ?? [];
    const b = marksB[id] ?? [];
    const ta = turnA[id] ?? true;
    // Soupeř právě složil trojici – konec.
    if (isLine(ta ? b : a)) continue;
    const mover = ta ? a : b;
    const out = succ[id] ?? [];
    for (let c = 0; c < 9; c++) {
      if (a.includes(c) || b.includes(c)) continue;
      let next = [...mover, c];
      if (next.length > MAX_MARKS) next = next.slice(1);
      out.push(ta ? add(next, b, false) : add(a, next, true));
    }
  }

  // 2) Předchůdci (pro zpětný průchod).
  const count = marksA.length;
  const preds: number[][] = Array.from({ length: count }, () => []);
  succ.forEach((list, id) => {
    for (const s of list) preds[s]?.push(id);
  });

  // 3) Retrográdní analýza od koncových stavů.
  const value = new Int8Array(count);
  const dist = new Uint8Array(count);
  const left = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  for (let id = 0; id < count; id++) {
    const ta = turnA[id] ?? true;
    if (isLine(ta ? (marksB[id] ?? []) : (marksA[id] ?? []))) {
      value[id] = VALUE.LOSS;
      queue[tail++] = id;
    } else {
      left[id] = succ[id]?.length ?? 0;
    }
  }
  while (head < tail) {
    const id = queue[head++] ?? 0;
    const lost = value[id] === VALUE.LOSS;
    for (const p of preds[id] ?? []) {
      if (value[p] !== VALUE.DRAW) continue;
      if (lost) {
        value[p] = VALUE.WIN;
        dist[p] = (dist[id] ?? 0) + 1;
        queue[tail++] = p;
      } else if ((left[p] = (left[p] ?? 1) - 1) === 0) {
        value[p] = VALUE.LOSS;
        dist[p] = (dist[id] ?? 0) + 1;
        queue[tail++] = p;
      }
    }
  }

  return {
    lookup(a, b, ta) {
      const id = ids.get(keyOf(encode(a), encode(b), ta));
      if (id === undefined) return { value: VALUE.DRAW, dist: 0 };
      return { value: (value[id] ?? 0) as Value, dist: dist[id] ?? 0 };
    },
  };
}

let cached: Solution | null = null;

/** Řešení se spočítá při prvním použití (těžká AI) a pak se drží v paměti. */
export function solution(): Solution {
  cached ??= solve();
  return cached;
}
