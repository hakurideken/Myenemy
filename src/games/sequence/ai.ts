import type { AIContext } from '../../core/MiniGame';
import type { Difficulty } from '../../core/types';
import {
  COUNTDOWN_MS,
  LEVEL_PAUSE_MS,
  levelLength,
  MAX_LEVEL,
  MIN_PRESS_MS,
  PADS,
  SHOW_GAP_MS,
  showOnMs,
  type SequenceMove,
  type SequenceView,
} from './logic';

/** Kolik kol AI zvládne (průměr, rozptyl) a jak rychle mačká (ms na položku). */
const SKILL: Record<Difficulty, { level: [number, number]; press: [number, number] }> = {
  easy: { level: [5.5, 1.5], press: [520, 80] },
  medium: { level: [8.5, 1.8], press: [420, 60] },
  hard: { level: [12, 1.8], press: [330, 50] },
};

/** AI „zahraje“ celý běh najednou: správně do kola, kde udělá chybu. */
export function sequenceAIMove(view: SequenceView, ai: AIContext): SequenceMove {
  const skill = SKILL[ai.difficulty];
  const reached = Math.round(ai.rng.normal(skill.level[0], skill.level[1]));
  const level = Math.max(1, Math.min(MAX_LEVEL, reached));
  const presses: number[] = [];
  let ms = 0;
  for (let l = 1; l <= level; l++) {
    const length = levelLength(l);
    presses.push(...view.sequence.slice(0, length));
    for (let i = 0; i < length; i++) {
      ms += Math.max(MIN_PRESS_MS * 2, Math.round(ai.rng.normal(skill.press[0], skill.press[1])));
    }
  }
  if (level < MAX_LEVEL) {
    // V dalším kole se splete: kus správně, pak jiné pole.
    const length = levelLength(level + 1);
    const correct = ai.rng.int(length);
    presses.push(...view.sequence.slice(0, correct));
    const right = view.sequence[correct] ?? 0;
    presses.push((right + 1 + ai.rng.int(PADS - 1)) % PADS);
  }
  return { kind: 'run', presses, ms };
}

/** Kdy AI „dohraje“ – zhruba jako člověk: ukázky, zadávání a pauzy mezi koly. */
export function sequenceAIDelay(_view: SequenceView, move: SequenceMove): number {
  let total = COUNTDOWN_MS + move.ms;
  let remaining = move.presses.length;
  for (let l = 1; remaining > 0 && l <= MAX_LEVEL; l++) {
    const length = levelLength(l);
    total += length * (showOnMs(l) + SHOW_GAP_MS) + LEVEL_PAUSE_MS;
    remaining -= length;
  }
  return total;
}
