import type { AIContext } from '../../core/MiniGame';
import type { Rng } from '../../core/util/rng';
import {
  CELLS,
  FLEET,
  colOf,
  neighbors4,
  neighbors8,
  rowOf,
  shipCells,
  sunkShipCells,
  type BattleshipMove,
  type BattleshipView,
  type Shot,
} from './logic';

/** Co střelec ví o soupeřově moři. */
export interface SeaKnowledge {
  /** Už vystřeleno. */
  readonly shot: ReadonlySet<number>;
  /** Zásahy lodí, které ještě nejsou potopené. */
  readonly openHits: readonly number[];
  /** Jistě voda: výstřely vedle a okolí potopených lodí. */
  readonly water: ReadonlySet<number>;
  /** Pole potopených lodí. */
  readonly sunk: ReadonlySet<number>;
  /** Délky lodí, které ještě plavou. */
  readonly remaining: readonly number[];
}

export function seaKnowledge(shots: readonly Shot[]): SeaKnowledge {
  const shot = new Set(shots.map((s) => s.cell));
  const water = new Set(shots.filter((s) => s.result === 'miss').map((s) => s.cell));
  const sunk = new Set<number>();
  const sunkShips = new Set<number>();
  for (const s of shots) {
    if (s.result !== 'sunk' || s.ship === null) continue;
    sunkShips.add(s.ship);
    for (const cell of sunkShipCells(shots, s.cell)) {
      sunk.add(cell);
      for (const n of neighbors8(cell)) water.add(n);
    }
  }
  for (const cell of sunk) water.delete(cell);
  const openHits = shots.filter((s) => s.result !== 'miss' && !sunk.has(s.cell)).map((s) => s.cell);
  const remaining = FLEET.filter((_, i) => !sunkShips.has(i));
  return { shot, openHits, water, sunk, remaining };
}

const unknownCells = (k: SeaKnowledge): number[] =>
  Array.from({ length: CELLS }, (_, i) => i).filter((c) => !k.shot.has(c) && !k.water.has(c));

/** Kandidáti kolem otevřených zásahů: v řadě, pokud už jsou zásahy dva. */
function targetCells(k: SeaKnowledge): number[] {
  const hits = new Set(k.openHits);
  const free = (c: number): boolean => !k.shot.has(c) && !k.water.has(c);
  const out = new Set<number>();
  for (const hit of k.openHits) {
    const lineMates = neighbors4(hit).filter((n) => hits.has(n));
    for (const n of neighbors4(hit)) {
      if (!free(n)) continue;
      const mate = lineMates[0];
      // Se sousedním zásahem pokračovat jen ve stejném směru.
      if (mate !== undefined && rowOf(mate) === rowOf(hit) && rowOf(n) !== rowOf(hit)) continue;
      if (mate !== undefined && colOf(mate) === colOf(hit) && colOf(n) !== colOf(hit)) continue;
      out.add(n);
    }
  }
  return [...out];
}

/**
 * Hustota pravděpodobnosti: kolikrát pole pokryje možné umístění zbývající lodi.
 * Umístění přes otevřené zásahy mají velkou váhu; umístění, které se otevřeného zásahu
 * jen dotýká, je nemožné (lodě se nedotýkají).
 */
export function densityMap(k: SeaKnowledge): number[] {
  const score = new Array<number>(CELLS).fill(0);
  const hits = new Set(k.openHits);
  const blocked = (c: number): boolean =>
    k.water.has(c) || k.sunk.has(c) || (k.shot.has(c) && !hits.has(c));
  for (const length of k.remaining) {
    for (let cell = 0; cell < CELLS; cell++) {
      for (const horizontal of [true, false]) {
        const cells = shipCells({ row: rowOf(cell), col: colOf(cell), horizontal }, length);
        if (!cells || cells.some(blocked)) continue;
        const covered = cells.filter((c) => hits.has(c)).length;
        const inside = new Set(cells);
        const touchesOther = cells.some((c) =>
          neighbors8(c).some((n) => hits.has(n) && !inside.has(n)),
        );
        if (touchesOther) continue;
        const weight = covered > 0 ? 50 * covered : 1;
        for (const c of cells) if (!k.shot.has(c)) score[c] = (score[c] ?? 0) + weight;
      }
    }
  }
  return score;
}

function best(cells: readonly number[], score: readonly number[], rng: Rng): number | null {
  let top = -1;
  let choices: number[] = [];
  for (const c of cells) {
    const s = score[c] ?? 0;
    if (s > top) {
      top = s;
      choices = [c];
    } else if (s === top) choices.push(c);
  }
  return choices.length > 0 ? rng.pick(choices) : null;
}

function chooseCell(view: BattleshipView, ai: AIContext): number {
  const k = seaKnowledge(view.shots[ai.me]);
  const { rng } = ai;
  const unknown = unknownCells(k);
  const targets = targetCells(k);
  let cell: number | null = null;

  switch (ai.difficulty) {
    case 'easy':
      // Občas dorazí zasaženou loď, jinak střílí naslepo (i do jisté vody).
      if (targets.length > 0 && rng.chance(0.4)) cell = rng.pick(targets);
      break;
    case 'medium': {
      // Lov a dorážení: po zásahu okolí, jinak šachovnice (nejkratší loď má 2 pole).
      if (targets.length > 0) cell = rng.pick(targets);
      else {
        const parity = unknown.filter((c) => (rowOf(c) + colOf(c)) % 2 === 0);
        const pool = parity.length > 0 ? parity : unknown;
        if (pool.length > 0) cell = rng.pick(pool);
      }
      break;
    }
    case 'hard':
      cell = best(unknown, densityMap(k), rng);
      break;
  }
  if (cell !== null) return cell;
  // Pojistka: jakékoli dosud nevystřelené pole (tah musí být vždy platný).
  const free = Array.from({ length: CELLS }, (_, i) => i).filter((c) => !k.shot.has(c));
  return free.length > 0 ? rng.pick(free) : 0;
}

export function battleshipAIMove(view: BattleshipView, ai: AIContext): BattleshipMove {
  return { kind: 'shot', cell: chooseCell(view, ai) };
}
