import { z } from 'zod';
import type { FogKnowledge, FogRules, GameLogic } from '../../core/MiniGame';
import {
  DRAW,
  otherPlayer,
  win,
  type Outcome,
  type PerPlayer,
  type PlayerSlot,
} from '../../core/types';
import type { Rng } from '../../core/util/rng';

/** Les 9 × 9. Lovec ujde až 2 pole rovně, liška 1 pole i šikmo (nebo zůstane). */
export const SIZE = 9;
export const CELLS = SIZE * SIZE;
/** Kol na poločas; kolo = tah lišky + tah lovce. */
export const ROUNDS = 15;
export const HUNTER_STEPS = 2;
/** Stopy lišky: kolik jejích předchozích poloh lovec může zahlédnout. */
export const TRACKS = 2;
const TREES = 12;
const BUSHES = 10;
export const COLUMN_LABELS = 'ABCDEFGHI';

export type Role = 'hunter' | 'fox';
/** Dohled (poloměr kruhu): liška má větší přehled, lovec víc pohybu. */
export const SIGHT: Readonly<Record<Role, number>> = { hunter: 2, fox: 3 };

/**
 * Terén jako řetězec 81 znaků: „.“ tráva, „T“ strom (nejde projít ani přes něj vidět),
 * „B“ keř (kdo v něm stojí, je vidět jen ze sousedního pole).
 */
export type Terrain = '.' | 'T' | 'B';

export const cellOf = (row: number, col: number): number => row * SIZE + col;
export const rowOf = (cell: number): number => Math.floor(cell / SIZE);
export const colOf = (cell: number): number => cell % SIZE;
/** Lidský název pole, např. „C5“. */
export const cellName = (cell: number): string =>
  `${COLUMN_LABELS[colOf(cell)] ?? '?'}${rowOf(cell) + 1}`;

export const chebyshev = (a: number, b: number): number =>
  Math.max(Math.abs(rowOf(a) - rowOf(b)), Math.abs(colOf(a) - colOf(b)));

/** Sousední pole: rovně (lovec), nebo i šikmo (liška). */
export function neighbors(cell: number, diagonal: boolean): number[] {
  const out: number[] = [];
  const r = rowOf(cell);
  const c = colOf(cell);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if ((!dr && !dc) || (!diagonal && dr && dc)) continue;
      if (r + dr >= 0 && r + dr < SIZE && c + dc >= 0 && c + dc < SIZE) {
        out.push(cellOf(r + dr, c + dc));
      }
    }
  }
  return out;
}

/**
 * Výhled mezi středy polí neprotne strom. Body přesně na hraně polí se nepočítají, takže
 * se dá vidět i úzkou mezerou šikmo mezi dvěma stromy. Je souměrný (stejná úsečka).
 */
export function lineOfSight(terrain: string, a: number, b: number): boolean {
  const r1 = rowOf(a);
  const c1 = colOf(a);
  const dr = rowOf(b) - r1;
  const dc = colOf(b) - c1;
  const steps = 16 * Math.max(Math.abs(dr), Math.abs(dc));
  for (let i = 1; i < steps; i++) {
    const y = r1 + (dr * i) / steps;
    const x = c1 + (dc * i) / steps;
    const r = Math.round(y);
    const c = Math.round(x);
    if (Math.abs(y - r) > 0.5 - 1e-9 || Math.abs(x - c) > 0.5 - 1e-9) continue;
    const cell = cellOf(r, c);
    if (cell !== a && cell !== b && terrain[cell] === 'T') return false;
  }
  return true;
}

/** Vidí hráč z pole `from` na pole `to`? Kruh o poloměru r, stromy zakrývají, keř skrývá. */
export function sees(terrain: string, from: number, to: number, radius: number): boolean {
  const dr = rowOf(to) - rowOf(from);
  const dc = colOf(to) - colOf(from);
  if (dr * dr + dc * dc > radius * radius + radius) return false;
  if (terrain[to] === 'T') return false;
  if (terrain[to] === 'B' && chebyshev(from, to) > 1) return false;
  return lineOfSight(terrain, from, to);
}

const visibleCache = new Map<string, readonly number[]>();

/** Všechna pole, kam hráč z `from` dohlédne (včetně vlastního). */
export function visibleCells(terrain: string, from: number, radius: number): readonly number[] {
  const key = `${terrain}|${from}|${radius}`;
  const cached = visibleCache.get(key);
  if (cached) return cached;
  const out: number[] = [];
  for (let cell = 0; cell < CELLS; cell++) {
    if (sees(terrain, from, cell, radius)) out.push(cell);
  }
  if (visibleCache.size > 4000) visibleCache.clear();
  visibleCache.set(key, out);
  return out;
}

/** Na volném poli je dohled lovce největší: tolik polí × 2 štítky (liška a stopa). */
const OPEN_FIELD = '.'.repeat(CELLS);
const MAX_HUNTER_VIEW = visibleCells(OPEN_FIELD, cellOf(4, 4), SIGHT.hunter).length;

/** Všechna pole bez stromů jsou propojená (lovec chodí jen rovně). */
function connected(terrain: string): boolean {
  const open = [...terrain].filter((t) => t !== 'T').length;
  const first = terrain.indexOf('.');
  const seen = new Set<number>([first]);
  const stack = [first];
  while (stack.length > 0) {
    const cell = stack.pop() ?? first;
    for (const n of neighbors(cell, false)) {
      if (terrain[n] !== 'T' && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen.size === open;
}

export interface HuntMap {
  readonly terrain: string;
  readonly starts: Readonly<Record<Role, number>>;
}

/** Les ze společné náhody: lovec a liška začínají v protilehlých rozích. */
export function generateMap(rng: Rng): HuntMap {
  const corners = [
    cellOf(1, 1),
    cellOf(1, SIZE - 2),
    cellOf(SIZE - 2, SIZE - 2),
    cellOf(SIZE - 2, 1),
  ];
  for (;;) {
    const corner = rng.int(4);
    const hunter = corners[corner] ?? 0;
    const fox = corners[(corner + 2) % 4] ?? 0;
    const cells: Terrain[] = Array.from({ length: CELLS }, () => '.');
    const free = rng.shuffle(
      Array.from({ length: CELLS }, (_, cell) => cell).filter(
        (cell) => chebyshev(cell, hunter) > 1 && chebyshev(cell, fox) > 1,
      ),
    );
    for (const cell of free.slice(0, TREES)) cells[cell] = 'T';
    for (const cell of free.slice(TREES, TREES + BUSHES)) cells[cell] = 'B';
    const terrain = cells.join('');
    if (connected(terrain)) return { terrain, starts: { hunter, fox } };
  }
}

// ---------- Veřejný stav ----------

export interface HalfResult {
  readonly hunter: PlayerSlot;
  /** Kolo, ve kterém lovec lišku chytil; null = liška unikla. */
  readonly caught: number | null;
  /** Kde ji chytil. */
  readonly cell: number | null;
}

export interface HuntState extends HuntMap {
  /** Lovec 1. poločasu (ve 2. se role prohodí). */
  readonly firstHunter: PlayerSlot;
  readonly half: 0 | 1;
  /** break = přestávka mezi poločasy, 2. poločas spustí jeho liška. */
  readonly phase: 'play' | 'break';
  readonly round: number;
  /** Kdo táhne (při hlášení: kdo táhl naposledy). */
  readonly turn: Role;
  /** Po každém tahu lovec ohlásí, jestli lišku chytil. */
  readonly report: boolean;
  /** Počet veřejných tahů – číslo posledního pozorování. */
  readonly step: number;
  readonly halves: readonly HalfResult[];
}

/** Nic z logiky není tajné – polohy zná jen jejich majitel (frame.fog). */
export type HuntView = HuntState;

export type HuntMove =
  /** Pohyb; cesta (pole, kudy hráč šel) zůstává jen u hráče, soupeř dostane {kind:'move'}. */
  | { readonly kind: 'move'; readonly path?: readonly number[] }
  | { readonly kind: 'report'; readonly caught: number | null }
  | { readonly kind: 'start' };

const slot = z.enum(['A', 'B']);
const cellSchema = z
  .number()
  .int()
  .min(0)
  .max(CELLS - 1);

export const huntMoveSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('move'),
    path: z.array(cellSchema).max(HUNTER_STEPS).optional(),
  }),
  z.object({ kind: z.literal('report'), caught: cellSchema.nullable() }),
  z.object({ kind: z.literal('start') }),
]);

export const huntViewSchema = z.object({
  terrain: z.string().regex(/^[.TB]{81}$/),
  starts: z.object({ hunter: cellSchema, fox: cellSchema }),
  firstHunter: slot,
  half: z.union([z.literal(0), z.literal(1)]),
  phase: z.enum(['play', 'break']),
  round: z.number().int().min(1).max(ROUNDS),
  turn: z.enum(['hunter', 'fox']),
  report: z.boolean(),
  step: z.number().int().min(0).max(10_000),
  halves: z
    .array(
      z.object({
        hunter: slot,
        caught: z.number().int().min(1).max(ROUNDS).nullable(),
        cell: cellSchema.nullable(),
      }),
    )
    .max(2),
});

export const roleOf = (s: HuntState, player: PlayerSlot): Role =>
  (s.half === 0) === (player === s.firstHunter) ? 'hunter' : 'fox';

export function playerOf(s: HuntState, role: Role): PlayerSlot {
  const hunter = s.half === 0 ? s.firstHunter : otherPlayer(s.firstHunter);
  return role === 'hunter' ? hunter : otherPlayer(hunter);
}

/**
 * Vyhrává, kdo jako lovec chytil lišku dřív (v nižším kole). Chytí-li oba ve stejném
 * kole nebo nikdo, je remíza. 2. poločas končí, jakmile už jeho lovec nemůže vyrovnat.
 */
export function huntOutcome(s: HuntState): Outcome | null {
  const [first, second] = s.halves;
  if (!first) return null;
  const firstHunter = first.hunter;
  if (!second) {
    if (first.caught !== null && s.half === 1 && s.round > first.caught) return win(firstHunter);
    return null;
  }
  const a = first.caught;
  const b = second.caught;
  if (a === null && b === null) return DRAW;
  if (a === null) return win(second.hunter);
  if (b === null || a < b) return win(firstHunter);
  return b < a ? win(second.hunter) : DRAW;
}

function toMove(s: HuntState): PlayerSlot[] {
  if (huntOutcome(s)) return [];
  if (s.phase === 'break') return [playerOf(s, 'fox')];
  return [playerOf(s, s.report ? 'hunter' : s.turn)];
}

function endHalf(s: HuntState, result: HalfResult): HuntState {
  const halves = [...s.halves, result];
  if (s.half === 1) return { ...s, halves, report: false };
  return { ...s, halves, half: 1, phase: 'break', round: 1, turn: 'fox', report: false };
}

export const huntLogic: GameLogic<HuntState, HuntMove, HuntView> = {
  setup: ({ rng, starter }) => ({
    ...generateMap(rng),
    firstHunter: starter,
    half: 0,
    phase: 'play',
    round: 1,
    turn: 'fox',
    report: false,
    step: 0,
    halves: [],
  }),

  toMove,

  legal(s, player, move) {
    if (!toMove(s).includes(player)) return false;
    switch (move.kind) {
      case 'start':
        return s.phase === 'break';
      case 'report':
        return s.phase === 'play' && s.report;
      case 'move': {
        if (s.phase !== 'play' || s.report) return false;
        // Veřejná podoba tahu cestu nemá – tu ověří soupeř po odhalení.
        if (!move.path) return true;
        const max = roleOf(s, player) === 'hunter' ? HUNTER_STEPS : 1;
        return move.path.length <= max && move.path.every((cell) => s.terrain[cell] !== 'T');
      }
    }
  },

  apply(s, _player, move) {
    const step = s.step + 1;
    switch (move.kind) {
      case 'start':
        return { ...s, step, phase: 'play' };
      case 'move':
        return { ...s, step, report: true };
      case 'report': {
        const next = { ...s, step, report: false };
        const hunter = playerOf(s, 'hunter');
        if (move.caught !== null) {
          return endHalf(next, { hunter, caught: s.round, cell: move.caught });
        }
        if (s.turn === 'fox') return { ...next, turn: 'hunter' };
        if (s.round >= ROUNDS) return endHalf(next, { hunter, caught: null, cell: null });
        return { ...next, turn: 'fox', round: s.round + 1 };
      }
    }
  },

  outcome: huntOutcome,
  view: (s) => s,
};

// ---------- Soukromý stav a mlha ----------

export interface HuntPrivate {
  readonly half: number;
  readonly role: Role;
  /** Poloha na začátku a po každém vlastním tahu (poločasu). */
  readonly path: readonly number[];
  /** Pole, kudy vedl poslední vlastní tah. */
  readonly last: readonly number[];
}

export const positionOf = (own: HuntPrivate): number => own.path[own.path.length - 1] ?? 0;

/** Předchozí polohy lišky, které ještě nesmazal vítr (bez té současné). */
export function trackCells(own: HuntPrivate): number[] {
  const pos = positionOf(own);
  return [...new Set(own.path.slice(-1 - TRACKS, -1))].filter((cell) => cell !== pos);
}

/** Kam se hráč z pole dostane jedním tahem: cesty (bez výchozího pole), včetně stání. */
export function reachablePaths(terrain: string, from: number, role: Role): number[][] {
  const paths: number[][] = [[]];
  const steps = role === 'hunter' ? HUNTER_STEPS : 1;
  let frontier: number[][] = [[]];
  for (let k = 0; k < steps; k++) {
    const next: number[][] = [];
    for (const path of frontier) {
      const at = path.at(-1) ?? from;
      for (const n of neighbors(at, role === 'fox')) {
        if (terrain[n] !== 'T') next.push([...path, n]);
      }
    }
    paths.push(...next);
    frontier = next;
  }
  return paths;
}

export type Label =
  | { readonly kind: 'F' | 'T' | 'H'; readonly cell: number }
  | { readonly kind: 'X'; readonly cell: null };

/** „F:23“ = liška, „T:23“ = stopa, „H:23“ = lovec. */
export function parseLabel(label: string): Label {
  const [kind, cell] = label.split(':');
  const value = Number(cell);
  if ((kind === 'F' || kind === 'T' || kind === 'H') && Number.isInteger(value)) {
    return { kind, cell: value };
  }
  return { kind: 'X', cell: null };
}

/** Kde mohl lovec lišku chytit: kam došel, a pokud táhl on, i kudy šel. */
function catchCells(s: HuntState, hunter: HuntPrivate): number[] {
  const pos = positionOf(hunter);
  return s.turn === 'hunter' ? [pos, ...hunter.last] : [pos];
}

export const huntFog: FogRules<HuntMove, HuntView, HuntPrivate> = {
  maxQueries: 2 * MAX_HUNTER_VIEW,
  maxExposed: 1 + TRACKS,

  segment: (view) => view.half,

  start(view, player) {
    const role = roleOf(view, player);
    return { half: view.half, role, path: [view.starts[role]], last: [] };
  },

  advance(view, _player, own, move) {
    if (move.kind !== 'move') return own;
    const path = move.path;
    if (!path) return null;
    const diagonal = own.role === 'fox';
    if (path.length > (diagonal ? 1 : HUNTER_STEPS)) return null;
    let at = positionOf(own);
    for (const next of path) {
      if (!neighbors(at, diagonal).includes(next) || view.terrain[next] === 'T') return null;
      at = next;
    }
    return { ...own, path: [...own.path, at], last: [...path] };
  },

  publicMove: (move) => (move.kind === 'move' ? { kind: 'move' } : move),

  observes: (move) => move.kind === 'move' || move.kind === 'start',

  exposed(_view, _player, own) {
    const pos = positionOf(own);
    if (own.role === 'hunter') return [`H:${pos}`];
    return [`F:${pos}`, ...trackCells(own).map((cell) => `T:${cell}`)];
  },

  queries(view, _player, own) {
    const cells = visibleCells(view.terrain, positionOf(own), SIGHT[own.role]);
    return own.role === 'hunter'
      ? cells.flatMap((cell) => [`F:${cell}`, `T:${cell}`])
      : cells.map((cell) => `H:${cell}`);
  },

  respond(view, player, knowledge: FogKnowledge) {
    if (view.phase !== 'play' || !view.report || roleOf(view, player) !== 'hunter') return null;
    const latest = knowledge.sightings.at(-1);
    if (!latest || latest.index !== view.step) return null;
    const reach = catchCells(view, knowledge.own as HuntPrivate);
    const fox = latest.seen.map(parseLabel).find((l) => l.kind === 'F' && reach.includes(l.cell));
    return { kind: 'report', caught: fox?.cell ?? null };
  },

  check(view, _player, move, privates: PerPlayer<HuntPrivate>) {
    if (move.kind !== 'report') return true;
    const fox = positionOf(privates[playerOf(view, 'fox')]);
    const caught = catchCells(view, privates[playerOf(view, 'hunter')]).includes(fox);
    return move.caught === (caught ? fox : null);
  },
};
