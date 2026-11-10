import type { AIContext } from '../../core/MiniGame';
import type { Difficulty } from '../../core/types';
import {
  ANSWER_MS,
  COUNTDOWN_MS,
  FEEDBACK_MS,
  MIN_DIGIT_MS,
  showMs,
  type DigitMove,
  type DigitView,
} from './logic';

/**
 * Rozsah paměti (kolik číslic si AI v kole zapamatuje – průměr, rozptyl) a tempo psaní.
 * Jako u člověka: do rozsahu skoro jistě, delší konec čísla už jen hádá. Člověk mívá
 * rozsah kolem 7 číslic – lehká je pod ním, střední zhruba průměrná, těžká dobrý hráč.
 */
const SKILL: Record<Difficulty, { span: [number, number]; perDigit: [number, number] }> = {
  easy: { span: [5, 1], perDigit: [600, 100] },
  medium: { span: [6.2, 1], perDigit: [480, 80] },
  hard: { span: [7.3, 1], perDigit: [380, 60] },
  impossible: { span: [9.5, 1], perDigit: [150, 25] },
};
/** I v rozsahu paměti se občas splete (překlep, prohozená číslice). */
const IN_SPAN = 0.97;

export function digitAIMove(view: DigitView, ai: AIContext): DigitMove {
  const skill = SKILL[ai.difficulty];
  const answers = view.numbers.map((number) => {
    const span = Math.max(3, Math.round(ai.rng.normal(skill.span[0], skill.span[1])));
    const digits = [...number]
      .map((digit, i) =>
        i < span && ai.rng.chance(IN_SPAN)
          ? digit
          : String((Number(digit) + 1 + ai.rng.int(9)) % 10),
      )
      .join('');
    const ms = Math.round(
      Math.min(
        ANSWER_MS - 100,
        [...digits].reduce(
          (sum) =>
            sum + Math.max(MIN_DIGIT_MS + 20, ai.rng.normal(skill.perDigit[0], skill.perDigit[1])),
          300,
        ),
      ),
    );
    return { digits, ms };
  });
  return { kind: 'answers', answers };
}

export function digitAIDelay(view: DigitView, move: DigitMove): number {
  return move.answers.reduce(
    (total, answer, i) => total + showMs(view.numbers[i]?.length ?? 4) + answer.ms + FEEDBACK_MS,
    COUNTDOWN_MS,
  );
}
