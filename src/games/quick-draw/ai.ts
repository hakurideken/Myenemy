import { sampleReaction } from '../../core/ai/reaction';
import type { AIContext } from '../../core/MiniGame';
import { REACTION_TIMEOUT_MS, type QuickDrawMove, type QuickDrawView } from './logic';

export function quickDrawAIMove(_view: QuickDrawView, ai: AIContext): QuickDrawMove {
  const sample = sampleReaction(ai.difficulty, ai.rng);
  return sample.kind === 'reacted' ? { kind: 'reacted', ms: sample.ms } : { kind: 'false-start' };
}

/** AI „vystřelí“ ve skutečném čase, aby to na obrazovce působilo jako souboj. */
export function quickDrawAIDelay(view: QuickDrawView, move: QuickDrawMove, ai: AIContext): number {
  switch (move.kind) {
    case 'reacted':
      return view.delayMs + move.ms;
    case 'false-start':
      return ai.rng.range(Math.min(400, view.delayMs / 2), view.delayMs - 150);
    case 'timeout':
      return view.delayMs + REACTION_TIMEOUT_MS;
  }
}
