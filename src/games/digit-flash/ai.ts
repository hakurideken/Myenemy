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

/** Šance zapamatovat si číslici (u 4 číslic a pokles na každou další) a tempo psaní. */
const SKILL: Record<Difficulty, { base: number; drop: number; perDigit: [number, number] }> = {
  easy: { base: 0.93, drop: 0.07, perDigit: [520, 90] },
  medium: { base: 0.97, drop: 0.045, perDigit: [400, 70] },
  hard: { base: 0.995, drop: 0.022, perDigit: [300, 50] },
};

export function digitAIMove(view: DigitView, ai: AIContext): DigitMove {
  const skill = SKILL[ai.difficulty];
  const answers = view.numbers.map((number) => {
    const chance = Math.max(0.3, skill.base - skill.drop * (number.length - 4));
    const digits = [...number]
      .map((digit) =>
        ai.rng.chance(chance) ? digit : String((Number(digit) + 1 + ai.rng.int(9)) % 10),
      )
      .join('');
    const ms = Math.round(
      Math.min(
        ANSWER_MS - 100,
        [...digits].reduce(
          (sum) =>
            sum + Math.max(MIN_DIGIT_MS * 2, ai.rng.normal(skill.perDigit[0], skill.perDigit[1])),
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
