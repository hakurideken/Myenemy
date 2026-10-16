import type { AIContext } from '../../core/MiniGame';
import { MAX_TAKE, type NimMove, type NimView } from './logic';

/**
 * Vítězná strategie misère Nimu (bere se 1–3): nechat soupeři počet ≡ 1 (mod 4).
 * Vrací null, když je pozice prohraná (pak nezáleží, kolik se vezme).
 */
export function optimalTake(remaining: number): number | null {
  const take = (remaining - 1) % (MAX_TAKE + 1);
  return take === 0 ? null : take;
}

/**
 * lehká  – náhodně (jen občas správně),
 * střední – správně v 60 % tahů,
 * těžká  – vždy optimálně; z prohrané pozice bere náhodně a čeká na chybu.
 */
export function nimAIMove(view: NimView, ai: AIContext): NimMove {
  const { rng, difficulty } = ai;
  const maxTake = Math.min(MAX_TAKE, view.remaining);
  const random = (): NimMove => ({ take: rng.intRange(1, maxTake) });
  const optimal = optimalTake(view.remaining);
  const accuracy = difficulty === 'hard' ? 1 : difficulty === 'medium' ? 0.6 : 0.2;
  if (optimal !== null && rng.chance(accuracy)) return { take: optimal };
  return random();
}
