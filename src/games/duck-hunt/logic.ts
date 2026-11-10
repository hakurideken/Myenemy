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
export const MAX_FLYING = 3;
/** Pojistka pro schéma – za minutu jich vyletí kolem třiceti. */
export const MAX_BIRDS = 80;
/** Podíl holubic (nestřílet! −1 bod). */
export const DOVE_CHANCE = 0.18;
/** Rozstřel: zlatá kachna vyletí chvíli po konci minuty, když je nerozhodně. */
export const GOLDEN_DELAY_MS = 900;
/** Jak dlouho po konci minuty se čeká, než se rozhodne o rozstřelu (zpoždění sítě). */
export const TIE_CHECK_MS = 500;
/** Plocha hry v herních jednotkách (poměr 16 : 10); tráva začíná na GROUND_Y. */
export const FIELD_W = 100;
export const FIELD_H = 62.5;
export const GROUND_Y = 52;
/** Poloměr zásahu kolem středu ptáka (kachna je široká asi 8 jednotek). */
export const HIT_RADIUS = 5.5;
/** Po minutí se puška chvíli nabíjí – „kropení“ naslepo se nevyplatí. */
export const RELOAD_MS = 450;
/** Rychlejší „reakce“ není lidská (pták je ještě za okrajem) – takový zásah neplatí. */
export const MIN_REACTION_MS = 150;

/** duck = +1 bod, dove = holubice (−1 bod), golden = zlatá kachna rozstřelu. */
export type BirdKind = 'duck' | 'dove' | 'golden';

/** Bod dráhy: v čase `t` (ms od startu) je pták na [x, y]. */
export interface Waypoint {
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

export interface Duck {
  readonly kind: BirdKind;
  /** Kdy vylétne (ms od startu) – zpoza některého okraje nebo z trávy. */
  readonly spawn: number;
  /** Kdy zmizí za okrajem. */
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
  /** Získané kachny (dřívější zásah). */
  readonly ducks: number;
  /** Trefené holubice (každý zásah −1, i když ji trefil i soupeř). */
  readonly doves: number;
  readonly points: number;
}

export interface DuckView {
  readonly ducks: readonly Duck[];
  readonly shots: PerPlayer<readonly Shot[]>;
  /** Kdo ptáka trefil první (padá v jeho barvě), podle zásahů známých tomuto hráči. */
  readonly owners: readonly (PlayerSlot | null)[];
  readonly score: PerPlayer<DuckScore>;
  readonly done: PerPlayer<boolean>;
}

// ---------- dráhy ----------

const round2 = (n: number): number => Math.round(n * 100) / 100;

type Side = 'bottom' | 'left' | 'right' | 'top';

/** Bod těsně za okrajem plochy (nebo v trávě), odkud pták vylétne / kam odletí. */
function edgePoint(rng: Rng, side: Side): { x: number; y: number } {
  switch (side) {
    case 'bottom':
      return { x: rng.range(12, FIELD_W - 12), y: GROUND_Y + 3 };
    case 'left':
      return { x: -7, y: rng.range(6, GROUND_Y - 12) };
    case 'right':
      return { x: FIELD_W + 7, y: rng.range(6, GROUND_Y - 12) };
    case 'top':
      return { x: rng.range(10, FIELD_W - 10), y: -7 };
  }
}

/** Rychlost v jednotkách za sekundu – čím později v minutě, tím rychleji. */
export function birdSpeed(spawn: number): number {
  return 18 + Math.min(1, spawn / DURATION_MS) * 20;
}

function planBird(rng: Rng, kind: BirdKind, spawn: number, lifetime: number, speed: number): Duck {
  const path: Waypoint[] = [];
  const from = edgePoint(rng, rng.pick(['bottom', 'bottom', 'left', 'right', 'top'] as const));
  let x = from.x;
  let y = from.y;
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
    t += Math.round((distance / speed) * 1000);
    x = tx;
    y = ty;
    path.push({ t, x: round2(x), y: round2(y) });
  }
  // Odlet za některý okraj (ne do trávy), rychleji než běžný let.
  const to = edgePoint(rng, rng.pick(['left', 'right', 'top'] as const));
  const exit = {
    x: to.x < 0 ? to.x - 3 : to.x > FIELD_W ? to.x + 3 : to.x,
    y: to.y < 0 ? -10 : to.y,
  };
  const ms = Math.round((Math.hypot(exit.x - x, exit.y - y) / (speed * 1.6)) * 1000);
  path.push({ t: t + ms, x: round2(exit.x), y: round2(exit.y) });
  return { kind, spawn, gone: t + ms, path };
}

/**
 * Plán ptáků z herní náhody – oba hráči online ho mají stejný. Kachny (a občas holubice)
 * létají celou minutu, najednou nejvýš MAX_FLYING; poslední je zlatá kachna rozstřelu.
 */
export function planDucks(rng: Rng): Duck[] {
  const birds: Duck[] = [];
  let spawn = 700;
  while (spawn < DURATION_MS - 1500 && birds.length < MAX_BIRDS - 1) {
    // Volné místo na obloze: počká, až některý z letících ptáků odletí.
    const flying = birds
      .filter((b) => b.gone > spawn)
      .map((b) => b.gone)
      .sort((a, b) => a - b);
    if (flying.length >= MAX_FLYING) spawn = (flying[flying.length - MAX_FLYING] ?? spawn) + 1;
    if (spawn >= DURATION_MS - 1500) break;
    const progress = spawn / DURATION_MS;
    const kind: BirdKind = birds.length >= 2 && rng.chance(DOVE_CHANCE) ? 'dove' : 'duck';
    // Později kratší let (6 s → 4,2 s) a rychlejší ptáci.
    const lifetime = 6000 - 1800 * progress + rng.range(-400, 400);
    birds.push(planBird(rng, kind, Math.round(spawn), lifetime, birdSpeed(spawn)));
    spawn += rng.range(1300, 2600) * (1 - 0.3 * progress);
  }
  birds.push(planBird(rng, 'golden', DURATION_MS + GOLDEN_DELAY_MS, 4500, 30));
  return birds;
}

/** Index zlaté kachny (vždy poslední). */
export const goldenIndex = (ducks: readonly Duck[]): number => ducks.length - 1;

/** Poloha ptáka v čase t, nebo null, když ještě nevylétl / už zmizel. */
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

/** Smí se v čase t na tohoto ptáka střílet? Běžní jen v minutě, zlatá kachna jen po ní. */
export function shootable(duck: Duck, t: number): boolean {
  if (t < duck.spawn + MIN_REACTION_MS || t > duck.gone) return false;
  return duck.kind === 'golden' ? t > DURATION_MS : t <= DURATION_MS;
}

/** Trefil výstřel v čase t na [x, y] ptáka? (Stejný výpočet u střelce i u soupeře.) */
export function shotHits(duck: Duck, t: number, x: number, y: number): boolean {
  if (!shootable(duck, t)) return false;
  const at = duckAt(duck, t);
  return at !== null && Math.hypot(at.x - x, at.y - y) <= HIT_RADIUS;
}

// ---------- vyhodnocení ----------

/**
 * Kdo ptáka trefil první. Stejný čas na milisekundu rozhodne pořadí ptáka (sudý A,
 * lichý B) – výsledek tak nezávisí na tom, v jakém pořadí zásahy dorazily.
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
    let won = 0;
    let doves = 0;
    ducks.forEach((duck, index) => {
      if (duck.kind === 'duck' && owners[index] === player) won += 1;
      if (duck.kind === 'dove' && shots[player].some((s) => s.duck === index)) doves += 1;
    });
    return { ducks: won, doves, points: won - doves };
  };
  return { A: score('A'), B: score('B') };
}

/** Víc bodů vyhrává; při shodě rozstřel – kdo dřív trefil zlatou kachnu; jinak remíza. */
export function judgeDucks(ducks: readonly Duck[], shots: PerPlayer<readonly Shot[]>): Outcome {
  const { A, B } = scoreOf(ducks, shots);
  if (A.points !== B.points) return win(A.points > B.points ? 'A' : 'B');
  const golden = duckOwners(ducks, shots)[goldenIndex(ducks)] ?? null;
  return golden ? win(golden) : DRAW;
}

/** Je po minutě nerozhodně (podle zásahů známých tomuto pohledu)? */
export function isTie(view: Pick<DuckView, 'score'>): boolean {
  return view.score.A.points === view.score.B.points;
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
    if (!duck || !Number.isInteger(move.duck) || move.t < 0) return false;
    // Každého ptáka trefí hráč nejvýš jednou; zásahy soupeře platnost neovlivní
    // (online dorazí v libovolném pořadí – výsledek rozhodne čas).
    if (s.shots[player].some((shot) => shot.duck === move.duck)) return false;
    return shotHits(duck, move.t, move.x, move.y);
  },
  apply: (s, player, move) => {
    if (move.kind === 'done') return { ...s, done: { ...s.done, [player]: true } };
    const shot: Shot = { duck: move.duck, t: move.t, x: move.x, y: move.y };
    return { ...s, shots: { ...s.shots, [player]: [...s.shots[player], shot] } };
  },
  outcome: (s) => (s.done.A && s.done.B ? judgeDucks(s.ducks, s.shots) : null),
  view: (s) => ({
    ducks: s.ducks,
    shots: s.shots,
    owners: duckOwners(s.ducks, s.shots),
    score: scoreOf(s.ducks, s.shots),
    done: s.done,
  }),
};

/**
 * Trefa, kterou by hráč teď mohl získat: nejbližší letící pták (i holubice – trefit ji
 * jde, jen se to nevyplatí), kterého ještě nemá a který ještě nepadá.
 */
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
/** Minuta + rozstřel (zlatá kachna). */
const time = z
  .number()
  .int()
  .min(0)
  .max(DURATION_MS + 20_000);
const birdIndex = z
  .number()
  .int()
  .min(0)
  .max(MAX_BIRDS - 1);

export const duckMoveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shot'), duck: birdIndex, t: time, x: coordinate, y: coordinate }),
  z.object({ kind: z.literal('done') }),
]);

const shotSchema = z.object({ duck: birdIndex, t: time, x: coordinate, y: coordinate });
const duckSchema = z.object({
  kind: z.enum(['duck', 'dove', 'golden']),
  spawn: z.number().finite(),
  gone: z.number().finite(),
  path: z
    .array(z.object({ t: z.number().finite(), x: coordinate, y: coordinate }))
    .min(2)
    .max(200),
});
const slot = z.enum(['A', 'B']);
const scoreSchema = z.object({
  ducks: z.number().int().min(0).max(MAX_BIRDS),
  doves: z.number().int().min(0).max(MAX_BIRDS),
  points: z.number().int().min(-MAX_BIRDS).max(MAX_BIRDS),
});

export const duckViewSchema = z.object({
  ducks: z.array(duckSchema).min(2).max(MAX_BIRDS),
  shots: z.object({
    A: z.array(shotSchema).max(MAX_BIRDS),
    B: z.array(shotSchema).max(MAX_BIRDS),
  }),
  owners: z.array(slot.nullable()).max(MAX_BIRDS),
  score: z.object({ A: scoreSchema, B: scoreSchema }),
  done: z.object({ A: z.boolean(), B: z.boolean() }),
});
