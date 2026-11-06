import { z } from 'zod';
import type { GameLogic } from '../../core/MiniGame';
import {
  DRAW,
  otherPlayer,
  PLAYER_SLOTS,
  win,
  type Outcome,
  type PerPlayer,
  type PlayerSlot,
} from '../../core/types';
import type { Rng } from '../../core/util/rng';

export const COUNTDOWN_MS = 3000;
export const DURATION_MS = 60_000;
/** Lichý počet – remíza na počet zásahů je méně častá. */
export const DUCK_COUNT = 15;
export const MAX_FLYING = 3;
/** Plocha hry v herních jednotkách (poměr 16 : 10); tráva začíná na GROUND_Y. */
export const FIELD_W = 100;
export const FIELD_H = 62.5;
export const GROUND_Y = 52;
/** Poloměr zásahu kolem středu kachny (kachna je široká asi 8 jednotek). */
export const HIT_RADIUS = 5.5;
/** Po minutí se puška chvíli nabíjí – „kropení“ naslepo se nevyplatí. */
export const RELOAD_MS = 450;
/** Rychlejší „reakce“ není lidská (kachna je ještě v trávě) – takový zásah neplatí. */
export const MIN_REACTION_MS = 150;

/** Bod dráhy: v čase `t` (ms od startu) je kachna na [x, y]. */
export interface Waypoint {
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

export interface Duck {
  /** Kdy vylétne z trávy (ms od startu). */
  readonly spawn: number;
  /** Kdy zmizí za horním okrajem. */
  readonly gone: number;
  /** Lomená čára letu – každý úsek je jeden směr. */
  readonly path: readonly Waypoint[];
}

export interface Shot {
  readonly duck: number;
  /** Čas zásahu v ms od startu (měří klient střelce). */
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

export type DuckMove = ({ readonly kind: 'shot' } & Shot) | { readonly kind: 'done' };

export interface DuckState {
  readonly ducks: readonly Duck[];
  readonly shots: PerPlayer<readonly Shot[]>;
  readonly done: PerPlayer<boolean>;
}

export interface DuckScore {
  readonly hits: number;
  /** Součet reakcí (zásah − vylétnutí) za získané kachny, ms. */
  readonly reaction: number;
}

export interface DuckView {
  readonly ducks: readonly Duck[];
  readonly shots: PerPlayer<readonly Shot[]>;
  /** Kdo kachnu získal (nejdřívější zásah), podle zásahů známých tomuto hráči. */
  readonly owners: readonly (PlayerSlot | null)[];
  readonly score: PerPlayer<DuckScore>;
  readonly done: PerPlayer<boolean>;
}

// ---------- dráhy ----------

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Rychlost kachny v jednotkách za sekundu – pozdější kachny létají rychleji. */
export function duckSpeed(index: number): number {
  return 18 + index * 1.6;
}

function planDuck(rng: Rng, index: number, spawn: number, lifetime: number): Duck {
  const speed = duckSpeed(index);
  const path: Waypoint[] = [];
  let x = rng.range(12, FIELD_W - 12);
  let y = GROUND_Y + 3;
  let t = spawn;
  path.push({ t, x: round2(x), y: round2(y) });
  const fleeAt = spawn + lifetime;
  // Lomená čára mezi náhodnými body na obloze – každý bod = změna směru.
  while (t < fleeAt) {
    const tx = rng.range(8, FIELD_W - 8);
    const ty = rng.range(6, GROUND_Y - 10);
    const distance = Math.hypot(tx - x, ty - y);
    // Krátké úseky bez změny směru nevypadají jako let – cíl musí být aspoň kus daleko.
    if (distance < 14) continue;
    const ms = Math.round((distance / speed) * 1000);
    x = tx;
    y = ty;
    t += ms;
    path.push({ t, x: round2(x), y: round2(y) });
  }
  // Odlet: šikmo nahoru za okraj, rychleji než běžný let.
  const ex = Math.min(FIELD_W + 8, Math.max(-8, x + rng.range(-30, 30)));
  const ey = -10;
  const ms = Math.round((Math.hypot(ex - x, ey - y) / (speed * 1.6)) * 1000);
  path.push({ t: t + ms, x: round2(ex), y: ey });
  return { spawn, gone: t + ms, path };
}

/**
 * Plán všech kachen z herní náhody – oba hráči online ho mají stejný. Najednou letí
 * nejvýš MAX_FLYING kachen a poslední zmizí před koncem minuty.
 */
export function planDucks(rng: Rng): Duck[] {
  const ducks: Duck[] = [];
  const step = (DURATION_MS - 9000) / (DUCK_COUNT - 1);
  for (let i = 0; i < DUCK_COUNT; i++) {
    let spawn = Math.round(700 + i * step + rng.range(-700, 700));
    const previous = ducks.at(-1);
    if (previous) spawn = Math.max(spawn, previous.spawn + 1200);
    // Volné místo na obloze: počká, až některá z letících kachen odletí.
    const flying = ducks.map((d) => d.gone).filter((gone) => gone > spawn);
    if (flying.length >= MAX_FLYING) {
      flying.sort((a, b) => a - b);
      spawn = (flying[flying.length - MAX_FLYING] ?? spawn) + 1;
    }
    // Pozdější kachny létají kratší dobu (5,5 s → 4 s), ale stihnou zmizet do konce.
    let lifetime = 5500 - (1500 * i) / (DUCK_COUNT - 1);
    let duck = planDuck(rng, i, spawn, lifetime);
    while (duck.gone > DURATION_MS - 300 && lifetime > 800) {
      lifetime -= 600;
      duck = planDuck(rng, i, spawn, lifetime);
    }
    ducks.push(duck);
  }
  return ducks;
}

/** Poloha kachny v čase t, nebo null, když ještě nevylétla / už zmizela. */
export function duckAt(duck: Duck, t: number): { x: number; y: number } | null {
  if (t < duck.spawn || t > duck.gone) return null;
  const path = duck.path;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b || t > b.t) continue;
    const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }
  const last = path.at(-1);
  return last ? { x: last.x, y: last.y } : null;
}

/** Směr letu v čase t (kvůli otočení obrázku): 1 = doprava, -1 = doleva. */
export function duckHeading(duck: Duck, t: number): 1 | -1 {
  const path = duck.path;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a && b && t <= b.t) return b.x >= a.x ? 1 : -1;
  }
  return 1;
}

/** Trefil výstřel v čase t na [x, y] kachnu? (Stejný výpočet u střelce i u soupeře.) */
export function shotHits(duck: Duck, t: number, x: number, y: number): boolean {
  if (t < duck.spawn + MIN_REACTION_MS) return false;
  const at = duckAt(duck, t);
  return at !== null && Math.hypot(at.x - x, at.y - y) <= HIT_RADIUS;
}

// ---------- vyhodnocení ----------

/**
 * Kachnu získá dřívější zásah. Stejný čas na milisekundu rozhodne pořadí kachny
 * (sudé A, liché B) – výsledek tak nezávisí na tom, v jakém pořadí zásahy dorazily.
 */
export function duckOwners(
  ducks: readonly Duck[],
  shots: PerPlayer<readonly Shot[]>,
): (PlayerSlot | null)[] {
  return ducks.map((_, index) => {
    const a = shots.A.find((s) => s.duck === index);
    const b = shots.B.find((s) => s.duck === index);
    if (!a || !b) return a ? 'A' : b ? 'B' : null;
    if (a.t !== b.t) return a.t < b.t ? 'A' : 'B';
    return index % 2 === 0 ? 'A' : 'B';
  });
}

export function scoreOf(
  ducks: readonly Duck[],
  shots: PerPlayer<readonly Shot[]>,
): PerPlayer<DuckScore> {
  const owners = duckOwners(ducks, shots);
  const score = (player: PlayerSlot): DuckScore => {
    let hits = 0;
    let reaction = 0;
    owners.forEach((owner, index) => {
      if (owner !== player) return;
      const shot = shots[player].find((s) => s.duck === index);
      const duck = ducks[index];
      if (!shot || !duck) return;
      hits += 1;
      reaction += shot.t - duck.spawn;
    });
    return { hits, reaction };
  };
  return { A: score('A'), B: score('B') };
}

/** Víc kachen vyhrává; při shodě kratší součet reakcí; úplná shoda = remíza. */
export function judgeDucks(score: PerPlayer<DuckScore>): Outcome {
  const { A, B } = score;
  if (A.hits !== B.hits) return win(A.hits > B.hits ? 'A' : 'B');
  if (A.hits === 0 || A.reaction === B.reaction) return DRAW;
  return win(A.reaction < B.reaction ? 'A' : 'B');
}

// ---------- logika ----------

export const duckLogic: GameLogic<DuckState, DuckMove, DuckView> = {
  setup: ({ rng }) => ({
    ducks: planDucks(rng),
    shots: { A: [], B: [] },
    done: { A: false, B: false },
  }),
  toMove: (s) => PLAYER_SLOTS.filter((p) => !s.done[p]),
  legal: (s, player, move) => {
    if (s.done[player]) return false;
    if (move.kind === 'done') return true;
    const duck = s.ducks[move.duck];
    if (!duck || !Number.isInteger(move.duck) || move.t < 0 || move.t > DURATION_MS) return false;
    // Každou kachnu trefí hráč nejvýš jednou; zásahy soupeře platnost neovlivní
    // (online dorazí v libovolném pořadí – výsledek rozhodne čas).
    if (s.shots[player].some((shot) => shot.duck === move.duck)) return false;
    return shotHits(duck, move.t, move.x, move.y);
  },
  apply: (s, player, move) => {
    if (move.kind === 'done') return { ...s, done: { ...s.done, [player]: true } };
    const shot: Shot = { duck: move.duck, t: move.t, x: move.x, y: move.y };
    return { ...s, shots: { ...s.shots, [player]: [...s.shots[player], shot] } };
  },
  outcome: (s) => (s.done.A && s.done.B ? judgeDucks(scoreOf(s.ducks, s.shots)) : null),
  view: (s) => ({
    ducks: s.ducks,
    shots: s.shots,
    owners: duckOwners(s.ducks, s.shots),
    score: scoreOf(s.ducks, s.shots),
    done: s.done,
  }),
};

/** Trefa, kterou by hráč teď mohl získat: nejbližší letící kachna, kterou ještě nemá. */
export function findTarget(
  view: DuckView,
  player: PlayerSlot,
  t: number,
  x: number,
  y: number,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  view.ducks.forEach((duck, index) => {
    if (view.owners[index] === otherPlayer(player)) return;
    if (view.shots[player].some((s) => s.duck === index)) return;
    const at = duckAt(duck, t);
    if (!at || !shotHits(duck, t, x, y)) return;
    const distance = Math.hypot(at.x - x, at.y - y);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

// ---------- schémata ----------

const coordinate = z.number().finite().min(-50).max(200);
const time = z.number().int().min(0).max(DURATION_MS);

export const duckMoveSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('shot'),
    duck: z
      .number()
      .int()
      .min(0)
      .max(DUCK_COUNT - 1),
    t: time,
    x: coordinate,
    y: coordinate,
  }),
  z.object({ kind: z.literal('done') }),
]);

const shotSchema = z.object({
  duck: z
    .number()
    .int()
    .min(0)
    .max(DUCK_COUNT - 1),
  t: time,
  x: coordinate,
  y: coordinate,
});
const duckSchema = z.object({
  spawn: z.number().finite(),
  gone: z.number().finite(),
  path: z
    .array(z.object({ t: z.number().finite(), x: coordinate, y: coordinate }))
    .min(2)
    .max(200),
});
const slot = z.enum(['A', 'B']);
const scoreSchema = z.object({
  hits: z.number().int().min(0).max(DUCK_COUNT),
  reaction: z.number().finite(),
});

export const duckViewSchema = z.object({
  ducks: z.array(duckSchema).length(DUCK_COUNT),
  shots: z.object({
    A: z.array(shotSchema).max(DUCK_COUNT),
    B: z.array(shotSchema).max(DUCK_COUNT),
  }),
  owners: z.array(slot.nullable()).length(DUCK_COUNT),
  score: z.object({ A: scoreSchema, B: scoreSchema }),
  done: z.object({ A: z.boolean(), B: z.boolean() }),
});
