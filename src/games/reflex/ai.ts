import { sampleReaction } from '../../core/ai/reaction';
import type { AIContext } from '../../core/MiniGame';
import type { Difficulty } from '../../core/types';
import { TARGET_COUNT, TIMEOUT_MS, type ReflexMove, type ReflexView } from './logic';

/** Výběr ze čtyř cílů trvá déle než prostá reakce (Hickův zákon) a občas se splete. */
export const CHOICE: Record<Difficulty, { readonly extraMs: number; readonly missRate: number }> = {
  easy: { extraMs: 230, missRate: 0.1 },
  medium: { extraMs: 170, missRate: 0.06 },
  hard: { extraMs: 120, missRate: 0.03 },
};

export function reflexAIMove(view: ReflexView, ai: AIContext): ReflexMove {
  const { rng, difficulty } = ai;
  const sample = sampleReaction(difficulty, rng);
  if (sample.kind === 'false-start') return { kind: 'false-start' };
  const { extraMs, missRate } = CHOICE[difficulty];
  const ms = Math.min(TIMEOUT_MS, sample.ms + extraMs);
  const others = Array.from({ length: TARGET_COUNT }, (_, i) => i).filter((i) => i !== view.target);
  const index = rng.chance(missRate) ? rng.pick(others) : view.target;
  return { kind: 'tap', index, ms };
}

export function reflexAIDelay(view: ReflexView, move: ReflexMove, ai: AIContext): number {
  if (move.kind === 'tap') return view.delayMs + move.ms;
  if (move.kind === 'false-start')
    return ai.rng.range(Math.min(400, view.delayMs / 2), view.delayMs - 150);
  return view.delayMs + TIMEOUT_MS;
}
