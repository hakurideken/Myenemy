import type { AIContext } from '../../core/MiniGame';
import type { Difficulty } from '../../core/types';
import {
  COUNTDOWN_MS,
  levelLength,
  MAX_LEVEL,
  MIN_PRESS_MS,
  PADS,
  type SequenceMove,
  type SequenceView,
} from './logic';

/**
 * Kolik kol AI zvládne (průměr, rozptyl) a jak rychle mačká (ms na položku). Člověk si
 * zapamatuje zhruba 7 ± 2 položek (≈ 5. kolo) – lehká je pod tím, střední zhruba
 * průměrný hráč, těžká dobrý hráč (řada kolem 11 položek), ne nepřekonatelná zeď.
 */
const SKILL: Record<Difficulty, { level: [number, number]; press: [number, number] }> = {
  easy: { level: [4.5, 1.3], press: [600, 90] },
  medium: { level: [6.5, 1.5], press: [480, 70] },
  hard: { level: [9, 1.6], press: [400, 60] },
  impossible: { level: [13, 1.5], press: [150, 20] },
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

/**
 * Kdy AI odešle výsledek: hned po odpočtu (pár sekund). Celý běh by trval jako u člověka
 * (u těžké AI i minuty) a hráč, který skončí brzy, by na ni zbytečně čekal. Výsledek AI
 * je stejně schovaný, dokud nedohraje i hráč.
 */
export function sequenceAIDelay(_view: SequenceView, _move: SequenceMove, ai: AIContext): number {
  return COUNTDOWN_MS + ai.rng.range(1500, 3000);
}
