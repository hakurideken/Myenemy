import type { AIContext, FogKnowledge } from '../../core/MiniGame';
import type { Difficulty, PlayerSlot } from '../../core/types';
import {
  CELLS,
  chebyshev,
  huntFog,
  neighbors,
  parseLabel,
  playerOf,
  positionOf,
  reachablePaths,
  roleOf,
  SIGHT,
  visibleCells,
  type HuntMove,
  type HuntPrivate,
  type HuntView,
  type Role,
} from './logic';

/** Rozložení pravděpodobnosti, kde soupeř stojí (81 polí). */
type Belief = Float64Array;

const cacheKey = (terrain: string, from: number, role: Role): string =>
  `${terrain}|${from}|${role}`;

const destCache = new Map<string, readonly number[]>();
/** Kam se soupeř jedním tahem dostane (cílová pole, bez polí po cestě). */
function destinations(terrain: string, from: number, role: Role): readonly number[] {
  const key = cacheKey(terrain, from, role);
  let out = destCache.get(key);
  if (!out) {
    out = [...new Set(reachablePaths(terrain, from, role).map((p) => p.at(-1) ?? from))];
    if (destCache.size > 4000) destCache.clear();
    destCache.set(key, out);
  }
  return out;
}

const reachCache = new Map<string, ReadonlySet<number>>();
/** Kde lovec z pole může lišku chytit (cíl i pole po cestě). */
function catchRange(terrain: string, from: number): ReadonlySet<number> {
  const key = cacheKey(terrain, from, 'hunter');
  let out = reachCache.get(key);
  if (!out) {
    const set = new Set<number>([from]);
    for (const path of reachablePaths(terrain, from, 'hunter')) for (const c of path) set.add(c);
    if (reachCache.size > 4000) reachCache.clear();
    reachCache.set(key, set);
    out = set;
  }
  return out;
}

const distCache = new Map<string, readonly number[]>();
/** Vzdálenost chůzí lovce (jen rovně, kolem stromů) ke všem polím. */
function walkDistances(terrain: string, from: number): readonly number[] {
  const key = `${terrain}|${from}`;
  const cached = distCache.get(key);
  if (cached) return cached;
  const dist = Array.from({ length: CELLS }, () => -1);
  dist[from] = 0;
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i] ?? from;
    for (const n of neighbors(cell, false)) {
      if (terrain[n] !== 'T' && dist[n] === -1) {
        dist[n] = (dist[cell] ?? 0) + 1;
        queue.push(n);
      }
    }
  }
  // Nedostupná pole (stromy) jako „hodně daleko“.
  const out = dist.map((d) => (d < 0 ? 20 : d));
  if (distCache.size > 2000) distCache.clear();
  distCache.set(key, out);
  return out;
}

function normalize(belief: Belief, terrain: string, exclude: readonly number[]): Belief {
  let sum = 0;
  for (const p of belief) sum += p;
  if (sum > 0) {
    for (let i = 0; i < CELLS; i++) belief[i] = (belief[i] ?? 0) / sum;
    return belief;
  }
  // Pozorování si odporují (nemělo by nastat) – soupeř může být kdekoli mimo dohled.
  const hidden = new Set(exclude);
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (terrain[i] !== 'T' && !hidden.has(i)) n++;
  for (let i = 0; i < CELLS; i++) {
    belief[i] = terrain[i] !== 'T' && !hidden.has(i) ? 1 / n : 0;
  }
  return belief;
}

/**
 * Soupeř táhl: pravděpodobnost se rozteče do jeho dosahu. `toward` = pole, ke kterému
 * (bias > 0) nebo od kterého (bias < 0) soupeř nejspíš míří.
 */
function predict(
  belief: Belief,
  terrain: string,
  role: Role,
  toward: number | null,
  bias: number,
): Belief {
  const out = new Float64Array(CELLS);
  const dist = toward === null ? null : walkDistances(terrain, toward);
  for (let cell = 0; cell < CELLS; cell++) {
    const p = belief[cell] ?? 0;
    if (p === 0) continue;
    const dests = destinations(terrain, cell, role);
    const weights = dests.map((d) => (dist ? Math.exp(-bias * (dist[d] ?? 0)) : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    dests.forEach((d, i) => (out[d] = (out[d] ?? 0) + (p * (weights[i] ?? 0)) / total));
  }
  return out;
}

/** Jak moc AI soupeře modeluje: lehká skoro vůbec, těžká se stopami i úmysly. */
interface Model {
  readonly tracks: boolean;
  readonly bias: number;
}

/**
 * Kde soupeř nejspíš je: od jeho startu se po každém jeho tahu pravděpodobnost rozteče,
 * pozorování ji zúží (viděn = jisté pole, neviděn = není nikde, kam hráč dohlédl).
 * Lovec navíc ví, že liška je nejvýš dva skoky od zahlédnuté stopy.
 */
export function opponentBelief(
  view: HuntView,
  me: PlayerSlot,
  fog: FogKnowledge,
  model: Model = { tracks: true, bias: 0.4 },
): Belief {
  const myRole = roleOf(view, me);
  const theirRole: Role = myRole === 'hunter' ? 'fox' : 'hunter';
  const them = playerOf(view, theirRole);
  const { terrain } = view;
  const seenKind = theirRole === 'fox' ? 'F' : 'H';
  let belief: Belief = new Float64Array(CELLS);
  belief[view.starts[theirRole]] = 1;
  for (const s of fog.sightings) {
    if (s.segment !== view.half) continue;
    const myPos = positionOf(s.own as HuntPrivate);
    // Lovec míří k lišce, liška od lovce.
    if (s.mover === them) {
      const bias = theirRole === 'hunter' ? model.bias : -model.bias;
      belief = predict(belief, terrain, theirRole, myPos, bias);
    }
    const labels = s.seen.map(parseLabel);
    const spotted = labels.find((l) => l.kind === seenKind);
    if (spotted && spotted.cell !== null) {
      belief = new Float64Array(CELLS);
      belief[spotted.cell] = 1;
      continue;
    }
    const visible = visibleCells(terrain, myPos, SIGHT[myRole]);
    for (const cell of visible) belief[cell] = 0;
    if (model.tracks) {
      for (const track of labels) {
        if (track.kind !== 'T' || track.cell === null) continue;
        const near = new Float64Array(CELLS);
        let any = false;
        for (let cell = 0; cell < CELLS; cell++) {
          if (chebyshev(cell, track.cell) <= 2 && (belief[cell] ?? 0) > 0) {
            near[cell] = belief[cell] ?? 0;
            any = true;
          }
        }
        if (any) belief = near;
      }
    }
    belief = normalize(belief, terrain, visible);
  }
  return belief;
}

const sum = (belief: Belief, cells: Iterable<number>): number => {
  let total = 0;
  for (const cell of cells) total += belief[cell] ?? 0;
  return total;
};

/** Míra náhody podle obtížnosti (lehká AI často táhne bez rozmyslu). */
const NOISE: Record<Difficulty, number> = { easy: 30, medium: 3, hard: 1 };
/** Penále za návrat na pole, kde lovec nedávno stál. */
const REVISIT = 3;

const MODEL: Record<Difficulty, Model> = {
  easy: { tracks: false, bias: 0 },
  medium: { tracks: false, bias: 0.2 },
  hard: { tracks: true, bias: 0.4 },
};

function hunterMove(view: HuntView, own: HuntPrivate, fog: FogKnowledge, ai: AIContext): number[] {
  const { terrain } = view;
  const pos = positionOf(own);
  const belief = opponentBelief(view, ai.me, fog, MODEL[ai.difficulty]);
  let best: number[] = [];
  let bestScore = -Infinity;
  for (const path of reachablePaths(terrain, pos, 'hunter')) {
    const dest = path.at(-1) ?? pos;
    const visible = visibleCells(terrain, dest, SIGHT.hunter);
    const caught = sum(belief, new Set([dest, ...path]));
    const seenNow = sum(belief, visible) - caught;
    // Liška tam nebyla – kam nejspíš uteče a uvidím ji pak?
    const rest = Float64Array.from(belief);
    for (const cell of [dest, ...path, ...visible]) rest[cell] = 0;
    const next = predict(
      normalize(rest, terrain, visible),
      terrain,
      'fox',
      dest,
      -MODEL[ai.difficulty].bias,
    );
    const seenNext = sum(next, visible);
    const dist = walkDistances(terrain, dest);
    let far = 0;
    for (let cell = 0; cell < CELLS; cell++) far += (next[cell] ?? 0) * (dist[cell] ?? 20);
    // Nevracet se tam, kde jsem právě byl (jinak přešlapuje tam a zpět).
    const revisit = own.path.slice(-4).filter((cell) => cell === dest).length;
    const score =
      100 * caught +
      15 * seenNow +
      8 * seenNext -
      far -
      REVISIT * revisit +
      ai.rng.next() * NOISE[ai.difficulty];
    if (score > bestScore) {
      bestScore = score;
      best = path;
    }
  }
  return best;
}

function foxMove(view: HuntView, own: HuntPrivate, fog: FogKnowledge, ai: AIContext): number[] {
  const { terrain } = view;
  const pos = positionOf(own);
  const hunters = opponentBelief(view, ai.me, fog, MODEL[ai.difficulty]);
  const careful = ai.difficulty === 'easy' ? 0.25 : 1;
  let best: number[] = [];
  let bestScore = -Infinity;
  for (const path of reachablePaths(terrain, pos, 'fox')) {
    const dest = path.at(-1) ?? pos;
    let caught = 0;
    let seenNow = 0;
    let seenNext = 0;
    let far = 0;
    for (let h = 0; h < CELLS; h++) {
      const p = hunters[h] ?? 0;
      if (p === 0) continue;
      const range = catchRange(terrain, h);
      if (range.has(dest)) caught += p;
      else if (visibleCells(terrain, h, SIGHT.hunter).includes(dest)) seenNow += p;
      else if ([...range].some((d) => visibleCells(terrain, d, SIGHT.hunter).includes(dest))) {
        seenNext += p;
      }
      far += p * Math.min(walkDistances(terrain, h)[dest] ?? 20, 8);
    }
    const score =
      careful * (-100 * caught - 30 * seenNow - 8 * seenNext) +
      2 * far +
      (terrain[dest] === 'B' ? 2 : 0) +
      ai.rng.next() * NOISE[ai.difficulty];
    if (score > bestScore) {
      bestScore = score;
      best = path;
    }
  }
  return best;
}

export function huntAIMove(view: HuntView, ai: AIContext): HuntMove {
  if (view.phase === 'break') return { kind: 'start' };
  const fog = ai.fog;
  if (view.report)
    return (fog && huntFog.respond(view, ai.me, fog)) ?? { kind: 'report', caught: null };
  const own = fog?.own as HuntPrivate | undefined;
  // Bez znalosti (nemělo by nastat) – zůstat stát je vždy platné.
  if (!fog || !own || own.half !== view.half) return { kind: 'move', path: [] };
  const path =
    roleOf(view, ai.me) === 'hunter' ? hunterMove(view, own, fog, ai) : foxMove(view, own, fog, ai);
  return { kind: 'move', path };
}
