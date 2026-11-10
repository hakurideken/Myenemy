import type { AIContext } from '../../core/MiniGame';
import type { Difficulty } from '../../core/types';
import {
  ANSWER_MS,
  BLANK_MS,
  CELLS,
  COUNTDOWN_MS,
  FEEDBACK_MS,
  ITEMS,
  MEMORIZE_MS,
  MIN_ANSWER_MS,
  type SpotMove,
  type SpotView,
} from './logic';

/** Šance na správnou odpověď (při 5 obrázcích a pokles na každý další) a rychlost. */
const SKILL: Record<Difficulty, { base: number; drop: number; ms: [number, number] }> = {
  easy: { base: 0.65, drop: 0.06, ms: [3000, 700] },
  medium: { base: 0.8, drop: 0.05, ms: [2300, 500] },
  hard: { base: 0.92, drop: 0.035, ms: [1700, 400] },
  impossible: { base: 0.98, drop: 0.01, ms: [900, 200] },
};

export function spotAIMove(view: SpotView, ai: AIContext): SpotMove {
  const skill = SKILL[ai.difficulty];
  const answers = view.rounds.map((round, i) => {
    const items = ITEMS[i] ?? 5;
    const ms = Math.round(
      Math.min(ANSWER_MS - 100, Math.max(MIN_ANSWER_MS + 50, ai.rng.normal(...skill.ms))),
    );
    if (ai.rng.chance(skill.base - skill.drop * (items - 5))) return { cell: round.cell, ms };
    // Splete se: jiné políčko.
    return { cell: (round.cell + 1 + ai.rng.int(CELLS - 1)) % CELLS, ms };
  });
  return { kind: 'answers', answers };
}

/** AI odpoví celé kolo naráz ve chvíli, kdy by člověk dohrál všech 7 kol. */
export function spotAIDelay(_view: SpotView, move: SpotMove): number {
  return move.answers.reduce(
    (total, answer, i) => total + (MEMORIZE_MS[i] ?? 3000) + BLANK_MS + answer.ms + FEEDBACK_MS,
    COUNTDOWN_MS,
  );
}
