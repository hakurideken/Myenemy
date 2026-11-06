import type { AIContext } from '../../core/MiniGame';
import type { Difficulty } from '../../core/types';
import { COUNTDOWN_MS, duckAt, DURATION_MS, type DuckMove, type DuckView } from './logic';

interface Skill {
  /** Šance, že kachnu vůbec trefí. */
  readonly accuracy: number;
  /** Reakce od vylétnutí kachny (ms). */
  readonly reaction: readonly [number, number];
  /** Přemíření na další kachnu (ms). */
  readonly retarget: readonly [number, number];
}

export const DUCK_SKILL: Record<Difficulty, Skill> = {
  easy: { accuracy: 0.35, reaction: [1500, 2700], retarget: [800, 1300] },
  medium: { accuracy: 0.6, reaction: [1050, 1800], retarget: [550, 900] },
  hard: { accuracy: 0.85, reaction: [700, 1150], retarget: [350, 600] },
};

/** Kachna musí být ještě kus na obloze – na odlétající za okrajem AI nestřílí. */
const SAFETY_MS = 250;

/** Kdy AI naposledy střílela (nebo začátek kola). */
function lastShotAt(view: DuckView, ai: AIContext): number {
  return view.shots[ai.me].reduce((latest, shot) => Math.max(latest, shot.t), 0);
}

/**
 * AI míří na kachny podle pořadí vylétnutí. Každou buď trefí (po reakční době), nebo
 * mine a nechá být. Tah nese přesný čas a místo zásahu – odehraje se v tu chvíli.
 */
export function duckAIMove(view: DuckView, ai: AIContext): DuckMove {
  const skill = DUCK_SKILL[ai.difficulty];
  // Paměť AI vydrží celý zápas – rozhodnutí „tuhle nechám být“ platí jen pro toto kolo.
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
    const t = Math.round(Math.max(ready, duck.spawn + ai.rng.range(...skill.reaction)));
    if (t > duck.gone - SAFETY_MS || t > DURATION_MS) {
      plan.skipped.add(index);
      continue;
    }
    if (!ai.rng.chance(skill.accuracy)) {
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
 * posledního tahu AI (u prvního od začátku kola).
 */
export function duckAIDelay(view: DuckView, move: DuckMove, ai: AIContext): number {
  const shots = view.shots[ai.me];
  const since = shots.length > 0 ? COUNTDOWN_MS + lastShotAt(view, ai) : 0;
  const at = COUNTDOWN_MS + (move.kind === 'shot' ? move.t : DURATION_MS + ai.rng.range(60, 300));
  return Math.max(0, at - since);
}
