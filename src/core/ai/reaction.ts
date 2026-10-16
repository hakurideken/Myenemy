import type { Difficulty } from '../types';
import type { Rng } from '../util/rng';

export interface ReactionProfile {
  readonly meanMs: number;
  readonly sdMs: number;
  /** Lidská spodní hranice – AI nikdy nereaguje „nadlidsky“. */
  readonly minMs: number;
  /** Pravděpodobnost předčasné reakce (chyba). */
  readonly falseStartRate: number;
  /** Pravděpodobnost „zaváhání“ – výrazně pomalejší reakce. */
  readonly lapseRate: number;
}

export const REACTION_PROFILES: Record<Difficulty, ReactionProfile> = {
  easy: { meanMs: 450, sdMs: 70, minMs: 230, falseStartRate: 0.08, lapseRate: 0.06 },
  medium: { meanMs: 330, sdMs: 50, minMs: 200, falseStartRate: 0.05, lapseRate: 0.04 },
  hard: { meanMs: 250, sdMs: 35, minMs: 170, falseStartRate: 0.03, lapseRate: 0.02 },
};

export type ReactionSample =
  { readonly kind: 'reacted'; readonly ms: number } | { readonly kind: 'false-start' };

export function sampleReaction(difficulty: Difficulty, rng: Rng): ReactionSample {
  const p = REACTION_PROFILES[difficulty];
  if (rng.chance(p.falseStartRate)) return { kind: 'false-start' };
  const lapse = rng.chance(p.lapseRate) ? rng.range(150, 350) : 0;
  const ms = Math.max(p.minMs, p.meanMs + rng.normal(0, p.sdMs)) + lapse;
  return { kind: 'reacted', ms: Math.round(ms) };
}
