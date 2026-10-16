import type { AIContext } from '../../core/MiniGame';
import { otherPlayer } from '../../core/types';
import { COUNTER, RPS_CHOICES, type RpsChoice, type RpsMove, type RpsView } from './logic';

const HISTORY_LIMIT = 60;

interface RpsMemory {
  /** Volby soupeře v pořadí, napříč koly i zápasy (během jedné session). */
  readonly opponent: RpsChoice[];
}

const memoryOf = (ai: AIContext): RpsMemory =>
  ai.memory.get<RpsMemory>('rps', () => ({ opponent: [] }));

function argmax(counts: Map<RpsChoice, number>): RpsChoice | null {
  let best: RpsChoice | null = null;
  let bestCount = 0;
  for (const choice of RPS_CHOICES) {
    const count = counts.get(choice) ?? 0;
    if (count > bestCount) {
      best = choice;
      bestCount = count;
    }
  }
  return best;
}

export function predictByFrequency(history: readonly RpsChoice[]): RpsChoice | null {
  const counts = new Map<RpsChoice, number>();
  for (const c of history) counts.set(c, (counts.get(c) ?? 0) + 1);
  return argmax(counts);
}

/** Markovův řetězec 1. řádu: co soupeř obvykle hraje po své poslední volbě. */
export function predictByMarkov(history: readonly RpsChoice[]): RpsChoice | null {
  const last = history.at(-1);
  if (last === undefined || history.length < 4) return null;
  const counts = new Map<RpsChoice, number>();
  let samples = 0;
  for (let i = 0; i < history.length - 1; i++) {
    const next = history[i + 1];
    if (history[i] === last && next !== undefined) {
      counts.set(next, (counts.get(next) ?? 0) + 1);
      samples++;
    }
  }
  return samples >= 2 ? argmax(counts) : null;
}

/**
 * lehká  – náhodně,
 * střední – 60 % kontruje nejčastější volbu soupeře,
 * těžká  – 80 % kontruje predikci Markovova řetězce (jinak nejčastější volbu).
 * Zbytek je náhodný, aby AI nešlo snadno přelstít.
 */
export function rpsAIMove(_view: RpsView, ai: AIContext): RpsMove {
  const { rng, difficulty } = ai;
  const random = (): RpsMove => ({ choice: rng.pick(RPS_CHOICES) });
  if (difficulty === 'easy') return random();
  const history = memoryOf(ai).opponent;
  const prediction =
    difficulty === 'medium'
      ? predictByFrequency(history)
      : (predictByMarkov(history) ?? predictByFrequency(history));
  const exploit = difficulty === 'medium' ? 0.6 : 0.8;
  return prediction && rng.chance(exploit) ? { choice: COUNTER[prediction] } : random();
}

export function rpsAIObserve(view: RpsView, ai: AIContext): void {
  if (!view.revealed) return;
  const history = memoryOf(ai).opponent;
  history.push(view.revealed[otherPlayer(ai.me)]);
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
}
