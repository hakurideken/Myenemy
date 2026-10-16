import type { AIContext } from '../../core/MiniGame';
import type { Difficulty } from '../../core/types';
import { COUNTDOWN_MS, DURATION_MS, type ClickMove, type ClickView } from './logic';

/** Kliknutí za sekundu – lidské tempo podle obtížnosti. */
export const CLICK_RATE: Record<Difficulty, { readonly mean: number; readonly sd: number }> = {
  easy: { mean: 5.5, sd: 0.7 },
  medium: { mean: 7.2, sd: 0.7 },
  hard: { mean: 9, sd: 0.6 },
};

export function clickAIMove(_view: ClickView, ai: AIContext): ClickMove {
  const { mean, sd } = CLICK_RATE[ai.difficulty];
  const perSecond = Math.max(3, ai.rng.normal(mean, sd));
  return { kind: 'clicks', count: Math.round((perSecond * DURATION_MS) / 1000) };
}

/** AI „dokliká“ ve stejnou chvíli jako hráč – po odpočtu a 5 s klikání. */
export function clickAIDelay(_view: ClickView, _move: ClickMove, ai: AIContext): number {
  return COUNTDOWN_MS + DURATION_MS + ai.rng.range(80, 400);
}
