import { z } from 'zod';
import type { GameLogic, HiddenInfo } from '../../core/MiniGame';
import { otherPlayer, win, type Outcome, type PerPlayer, type PlayerSlot } from '../../core/types';
import type { Rng } from '../../core/util/rng';

/** Moře 8×8, flotila 4 + 3 + 3 + 2 + 2 = 14 polí; lodě se nedotýkají ani rohem. */
export const SIZE = 8;
export const CELLS = SIZE * SIZE;
export const FLEET: readonly number[] = [4, 3, 3, 2, 2];
export const COLUMN_LABELS = 'ABCDEFGH';

export const cellOf = (row: number, col: number): number => row * SIZE + col;
export const rowOf = (cell: number): number => Math.floor(cell / SIZE);
export const colOf = (cell: number): number => cell % SIZE;
/** Lidský název pole, např. „C5“. */
export const cellName = (cell: number): string =>
  `${COLUMN_LABELS[colOf(cell)] ?? '?'}${rowOf(cell) + 1}`;

/** Sousedé pole (včetně úhlopříček). */
export function neighbors8(cell: number): number[] {
  const out: number[] = [];
  const r = rowOf(cell);
  const c = colOf(cell);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if ((dr || dc) && r + dr >= 0 && r + dr < SIZE && c + dc >= 0 && c + dc < SIZE) {
        out.push(cellOf(r + dr, c + dc));
      }
    }
  }
  return out;
}

/** Sousedé pole v řádku a sloupci. */
export function neighbors4(cell: number): number[] {
  const r = rowOf(cell);
  const c = colOf(cell);
  const out: number[] = [];
  if (r > 0) out.push(cellOf(r - 1, c));
  if (r < SIZE - 1) out.push(cellOf(r + 1, c));
  if (c > 0) out.push(cellOf(r, c - 1));
  if (c < SIZE - 1) out.push(cellOf(r, c + 1));
  return out;
}

// ---------- Tajná data: rozmístění flotily ----------

/** Loď flotily; délka plyne z pořadí (FLEET[i]). */
export interface Ship {
  readonly row: number;
  readonly col: number;
  readonly horizontal: boolean;
}
export type Fleet = readonly Ship[];

const coord = z
  .number()
  .int()
  .min(0)
  .max(SIZE - 1);
export const shipSchema = z.object({ row: coord, col: coord, horizontal: z.boolean() });
export const fleetSchema = z.array(shipSchema).length(FLEET.length);

/** Pole lodi, nebo null, když přečnívá z moře. */
export function shipCells(ship: Ship, length: number): number[] | null {
  const cells: number[] = [];
  for (let k = 0; k < length; k++) {
    const r = ship.horizontal ? ship.row : ship.row + k;
    const c = ship.horizontal ? ship.col + k : ship.col;
    if (r >= SIZE || c >= SIZE) return null;
    cells.push(cellOf(r, c));
  }
  return cells;
}

/** Dá se loď položit k už rozmístěným (v moři, bez překryvu a bez dotyku)? */
export function canPlace(occupied: ReadonlySet<number>, cells: readonly number[] | null): boolean {
  if (!cells) return false;
  return cells.every(
    (cell) => !occupied.has(cell) && neighbors8(cell).every((n) => !occupied.has(n)),
  );
}

/** Pole flotily po lodích; null = neplatné rozmístění. */
export function fleetCells(fleet: Fleet): number[][] | null {
  if (fleet.length !== FLEET.length) return null;
  const occupied = new Set<number>();
  const out: number[][] = [];
  for (const [i, ship] of fleet.entries()) {
    const cells = shipCells(ship, FLEET[i] ?? 0);
    if (!canPlace(occupied, cells) || !cells) return null;
    for (const cell of cells) occupied.add(cell);
    out.push(cells);
  }
  return out;
}

export const isValidFleet = (fleet: Fleet): boolean => fleetCells(fleet) !== null;

export function randomFleet(rng: Rng): Fleet {
  for (;;) {
    const occupied = new Set<number>();
    const fleet: Ship[] = [];
    for (const length of FLEET) {
      let placed = false;
      for (let attempt = 0; attempt < 200 && !placed; attempt++) {
        const ship = { row: rng.int(SIZE), col: rng.int(SIZE), horizontal: rng.chance(0.5) };
        const cells = shipCells(ship, length);
        if (cells && canPlace(occupied, cells)) {
          for (const cell of cells) occupied.add(cell);
          fleet.push(ship);
          placed = true;
        }
      }
      if (!placed) break;
    }
    if (fleet.length === FLEET.length) return fleet;
  }
}

// ---------- Veřejný stav: výstřely a odpovědi ----------

export type ShotResult = 'miss' | 'hit' | 'sunk';

export interface Shot {
  readonly cell: number;
  readonly result: ShotResult;
  /** Index potopené lodi ve FLEET (jen u „sunk“). */
  readonly ship: number | null;
}

export type BattlePhase = 'placing' | 'battle';

export interface BattleshipState {
  readonly phase: BattlePhase;
  readonly ready: PerPlayer<boolean>;
  readonly starter: PlayerSlot;
  /** Kdo střílí. */
  readonly turn: PlayerSlot;
  /** Pole, na které se střílí a čeká se na odpověď soupeře. */
  readonly pending: number | null;
  /** Výstřely hráče do soupeřova moře (s odpověďmi soupeře). */
  readonly shots: PerPlayer<readonly Shot[]>;
  /** Kdo naposledy dostal odpověď na výstřel (pro zvýraznění a hlášku). */
  readonly lastShooter: PlayerSlot | null;
}

/** Nic z logiky není tajné – lodě zná jen klient vlastníka (frame.secret). */
export type BattleshipView = BattleshipState;

export type BattleshipMove =
  | { readonly kind: 'ready' }
  | { readonly kind: 'shot'; readonly cell: number }
  | { readonly kind: 'answer'; readonly result: ShotResult; readonly ship: number | null };

const slot = z.enum(['A', 'B']);
const cellSchema = z
  .number()
  .int()
  .min(0)
  .max(CELLS - 1);
const resultSchema = z.enum(['miss', 'hit', 'sunk']);
const shipIndex = z
  .number()
  .int()
  .min(0)
  .max(FLEET.length - 1);

export const battleshipMoveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready') }),
  z.object({ kind: z.literal('shot'), cell: cellSchema }),
  z.object({ kind: z.literal('answer'), result: resultSchema, ship: shipIndex.nullable() }),
]);

const shotSchema = z.object({ cell: cellSchema, result: resultSchema, ship: shipIndex.nullable() });
const shotsSchema = z.array(shotSchema).max(CELLS);

export const battleshipViewSchema = z.object({
  phase: z.enum(['placing', 'battle']),
  ready: z.object({ A: z.boolean(), B: z.boolean() }),
  starter: slot,
  turn: slot,
  pending: cellSchema.nullable(),
  shots: z.object({ A: shotsSchema, B: shotsSchema }),
  lastShooter: slot.nullable(),
});

export const sunkCount = (shots: readonly Shot[]): number =>
  shots.filter((s) => s.result === 'sunk').length;

/** Kdo má odpovídat na čekající výstřel. */
export const answerer = (s: BattleshipState): PlayerSlot | null =>
  s.phase === 'battle' && s.pending !== null ? otherPlayer(s.turn) : null;

/**
 * Pole potopené lodi = souvislá skupina zásahů kolem pole, kde byla potopena (lodě se
 * nedotýkají, takže jiná loď do skupiny patřit nemůže).
 */
export function sunkShipCells(shots: readonly Shot[], cell: number): number[] {
  const hits = new Set(shots.filter((s) => s.result !== 'miss').map((s) => s.cell));
  hits.add(cell);
  const seen = new Set<number>([cell]);
  const stack = [cell];
  while (stack.length > 0) {
    const current = stack.pop() ?? cell;
    for (const n of neighbors4(current)) {
      if (hits.has(n) && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return [...seen];
}

/** Správná odpověď na výstřel podle skutečných lodí (a dosavadních zásahů). */
export function answerFor(
  cells: readonly (readonly number[])[],
  previous: readonly number[],
  cell: number,
): { result: ShotResult; ship: number | null } {
  const index = cells.findIndex((ship) => ship.includes(cell));
  const ship = cells[index];
  if (!ship) return { result: 'miss', ship: null };
  const before = new Set(previous);
  return ship.every((c) => c === cell || before.has(c))
    ? { result: 'sunk', ship: index }
    : { result: 'hit', ship: null };
}

function outcome(s: BattleshipState): Outcome | null {
  if (s.phase !== 'battle' || s.pending !== null) return null;
  for (const p of [s.turn, otherPlayer(s.turn)]) {
    // Celé moře prostřílené = soupeř musel lhát (poctivá hra skončí dřív).
    if (sunkCount(s.shots[p]) === FLEET.length || s.shots[p].length === CELLS) return win(p);
  }
  return null;
}

function answerLegal(
  s: BattleshipState,
  move: Extract<BattleshipMove, { kind: 'answer' }>,
): boolean {
  if (s.pending === null) return false;
  if (move.result !== 'sunk') return move.ship === null;
  if (move.ship === null) return false;
  const shots = s.shots[s.turn];
  if (shots.some((shot) => shot.ship === move.ship)) return false;
  // Potopená loď musí mít správnou délku a ležet v řadě.
  const cells = sunkShipCells(shots, s.pending);
  if (cells.length !== FLEET[move.ship]) return false;
  const rows = new Set(cells.map(rowOf));
  const cols = new Set(cells.map(colOf));
  return rows.size === 1 || cols.size === 1;
}

function toMove(s: BattleshipState): PlayerSlot[] {
  if (outcome(s)) return [];
  if (s.phase === 'placing') {
    return [s.starter, otherPlayer(s.starter)].filter((p) => !s.ready[p]);
  }
  return [answerer(s) ?? s.turn];
}

export const battleshipLogic: GameLogic<BattleshipState, BattleshipMove, BattleshipView> = {
  setup: ({ starter }) => ({
    phase: 'placing',
    ready: { A: false, B: false },
    starter,
    turn: starter,
    pending: null,
    shots: { A: [], B: [] },
    lastShooter: null,
  }),

  toMove,

  legal(s, player, move) {
    if (!toMove(s).includes(player)) return false;
    switch (move.kind) {
      case 'ready':
        return s.phase === 'placing' && !s.ready[player];
      case 'shot':
        return (
          s.phase === 'battle' &&
          s.pending === null &&
          player === s.turn &&
          !s.shots[player].some((shot) => shot.cell === move.cell)
        );
      case 'answer':
        return answerer(s) === player && answerLegal(s, move);
    }
  },

  apply(s, player, move) {
    switch (move.kind) {
      case 'ready': {
        const ready = { ...s.ready, [player]: true };
        return { ...s, ready, phase: ready.A && ready.B ? 'battle' : 'placing' };
      }
      case 'shot':
        return { ...s, pending: move.cell };
      case 'answer': {
        if (s.pending === null) return s;
        const shot: Shot = { cell: s.pending, result: move.result, ship: move.ship };
        const shots = { ...s.shots, [s.turn]: [...s.shots[s.turn], shot] };
        // Zásah = střílí znovu, vedle = střídání.
        const turn = move.result === 'miss' ? otherPlayer(s.turn) : s.turn;
        return { ...s, shots, pending: null, turn, lastShooter: s.turn };
      }
    }
  },

  outcome,
  view: (s) => s,
};

export const battleshipHidden: HiddenInfo<Fleet, BattleshipMove, BattleshipView> = {
  secretSchema: fleetSchema,
  isValidSecret: isValidFleet,
  randomSecret: randomFleet,

  respond(view, player, fleet) {
    if (view.phase === 'placing') return view.ready[player] ? null : { kind: 'ready' };
    if (answerer(view) !== player || view.pending === null) return null;
    const cells = fleetCells(fleet);
    if (!cells) return null;
    const previous = view.shots[otherPlayer(player)].map((s) => s.cell);
    return { kind: 'answer', ...answerFor(cells, previous, view.pending) };
  },

  awaitsSecret: (view, player) =>
    view.phase === 'placing' ? !view.ready[player] : answerer(view) === player,

  locked: (view) => view.phase === 'battle',

  consistent(view, player, fleet) {
    const cells = fleetCells(fleet);
    if (!cells) return false;
    const shots = view.shots[otherPlayer(player)];
    return shots.every((shot, i) => {
      const expected = answerFor(
        cells,
        shots.slice(0, i).map((s) => s.cell),
        shot.cell,
      );
      return expected.result === shot.result && expected.ship === shot.ship;
    });
  },

  outcome,
};
