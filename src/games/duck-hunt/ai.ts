import type { AIContext } from '../../core/MiniGame';
import type { Difficulty } from '../../core/types';
import {
  COUNTDOWN_MS,
  duckAt,
  DURATION_MS,
  goldenIndex,
  MIN_REACTION_MS,
  type DuckMove,
  type DuckView,
} from './logic';

interface Skill {
  /** Šance, že kachnu vůbec trefí. */
  readonly accuracy: number;
  /** Šance, že omylem střelí holubici (místo aby ji nechala být). */
  readonly doveMistake: number;
  /** Reakce od vylétnutí ptáka (ms). */
  readonly reaction: readonly [number, number];
  /** Přemíření na dalšího ptáka (ms). */
  readonly retarget: readonly [number, number];
}

export const DUCK_SKILL: Record<Difficulty, Skill> = {
  easy: { accuracy: 0.35, doveMistake: 0.3, reaction: [1500, 2700], retarget: [800, 1300] },
  medium: { accuracy: 0.6, doveMistake: 0.12, reaction: [1050, 1800], retarget: [550, 900] },
  hard: { accuracy: 0.85, doveMistake: 0.03, reaction: [700, 1150], retarget: [350, 600] },
  impossible: { accuracy: 0.97, doveMistake: 0, reaction: [350, 550], retarget: [150, 250] },
};

/** Pták musí být ještě kus na obloze – na odlétajícího za okrajem AI nestřílí. */
const SAFETY_MS = 250;

function lastShotAt(view: DuckView, ai: AIContext): number {
  return view.shots[ai.me].reduce((latest, shot) => Math.max(latest, shot.t), 0);
}

/**
 * AI míří na ptáky podle pořadí vylétnutí. Kachnu buď trefí (po reakční době), nebo mine;
 * holubici nechá být (kromě občasného omylu). Po minutě zkusí zlatou kachnu rozstřelu –
 * když nerozhodně není, výstřel na ni nic nezmění.
 */
export function duckAIMove(view: DuckView, ai: AIContext): DuckMove {
  const skill = DUCK_SKILL[ai.difficulty];
  // Paměť AI vydrží celý zápas – rozhodnutí „tohohle nechám být“ platí jen pro toto kolo.
  const plan = ai.memory.get<{ ducks: unknown; skipped: Set<number> }>('duck-hunt', () => ({
    ducks: null,
    skipped: new Set(),
  }));
  if (plan.ducks !== view.ducks) {
    plan.ducks = view.ducks;
    plan.skipped.clear();
  }
  let ready = lastShotAt(view, ai);
  if (view.shots[ai.me].length > 0) ready += ai.rng.range(...skill.retarget);
  for (const [index, duck] of view.ducks.entries()) {
    if (plan.skipped.has(index)) continue;
    if (view.owners[index] !== null) continue;
    if (view.shots[ai.me].some((s) => s.duck === index)) continue;
    const earliest = duck.kind === 'golden' ? DURATION_MS + 1 : 0;
    const t = Math.round(
      Math.max(
        ready,
        earliest,
        duck.spawn + Math.max(MIN_REACTION_MS, ai.rng.range(...skill.reaction)),
      ),
    );
    const latest = duck.kind === 'golden' ? duck.gone : Math.min(duck.gone, DURATION_MS);
    if (t > latest - SAFETY_MS) {
      plan.skipped.add(index);
      continue;
    }
    const take =
      duck.kind === 'dove' ? ai.rng.chance(skill.doveMistake) : ai.rng.chance(skill.accuracy);
    if (!take) {
      plan.skipped.add(index);
      continue;
    }
    const at = duckAt(duck, t);
    if (!at) continue;
    return {
      kind: 'shot',
      duck: index,
      t,
      x: Math.round(at.x * 100) / 100,
      y: Math.round(at.y * 100) / 100,
    };
  }
  return { kind: 'done' };
}

/**
 * Za jak dlouho tah odehrát: tahy nesou čas od startu (po odpočtu), runner plánuje od
 * posledního tahu AI (u prvního od začátku kola). „Hotovo“ po rozstřelu (nebo hned po
 * zásahu zlaté kachny).
 */
export function duckAIDelay(view: DuckView, move: DuckMove, ai: AIContext): number {
  const shots = view.shots[ai.me];
  const since = shots.length > 0 ? COUNTDOWN_MS + lastShotAt(view, ai) : 0;
  const golden = view.ducks[goldenIndex(view.ducks)];
  const hitGolden = shots.some((s) => s.duck === goldenIndex(view.ducks));
  const doneAt = hitGolden ? lastShotAt(view, ai) + 300 : (golden?.gone ?? DURATION_MS) + 200;
  const at = COUNTDOWN_MS + (move.kind === 'shot' ? move.t : doneAt + ai.rng.range(60, 300));
  return Math.max(0, at - since);
}
