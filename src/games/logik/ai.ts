import type { AIContext } from '../../core/MiniGame';
import {
  COLORS,
  PEGS,
  randomCode,
  scoreGuess,
  type Code,
  type Guess,
  type LogikMove,
  type LogikView,
} from './logic';

/** Všech 6⁴ = 1296 kódů. */
export const ALL_CODES: readonly Code[] = Array.from({ length: COLORS ** PEGS }, (_, n) =>
  Array.from({ length: PEGS }, (_, i) => Math.floor(n / COLORS ** (PEGS - 1 - i)) % COLORS),
);

/** Kódy, které odpovídají všem dosavadním odpovědím soupeře. */
export function consistentCodes(guesses: readonly Guess[]): Code[] {
  const answered = guesses.filter((g) => g.feedback !== null);
  return ALL_CODES.filter((code) =>
    answered.every((g) => {
      const f = scoreGuess(g.code, code);
      return f.black === g.feedback?.black && f.white === g.feedback.white;
    }),
  );
}

const feedbackKey = (guess: Code, secret: Code): number => {
  const f = scoreGuess(guess, secret);
  return f.black * (PEGS + 1) + f.white;
};

/**
 * Minimax (Knuth): pokus, po kterém v nejhorším případě zbude nejméně kandidátů.
 * Kandidáty na pokus bereme jen z konzistentní množiny – tak to stihne i telefon.
 */
export function minimaxGuess(candidates: readonly Code[]): Code | null {
  let best: Code | null = null;
  let bestWorst = Infinity;
  for (const guess of candidates) {
    const buckets = new Map<number, number>();
    let worst = 0;
    for (const secret of candidates) {
      const key = feedbackKey(guess, secret);
      const size = (buckets.get(key) ?? 0) + 1;
      buckets.set(key, size);
      if (size > worst) worst = size;
      if (worst >= bestWorst) break;
    }
    if (worst < bestWorst) {
      bestWorst = worst;
      best = guess;
    }
  }
  return best;
}

/** Klasický první tah minimaxu – rozdělí 1296 kódů nejlépe. */
const KNUTH_OPENING: Code = [0, 0, 1, 1];

export function logikAIMove(view: LogikView, ai: AIContext): LogikMove {
  const mine = view.guesses[ai.me];
  const { rng } = ai;
  const pickConsistent = (): Code => {
    const options = consistentCodes(mine);
    return options.length > 0 ? rng.pick(options) : randomCode(rng);
  };
  let code: Code;
  switch (ai.difficulty) {
    case 'easy':
      // Polovinu pokusů tipuje naslepo, jinak rozumně.
      code = rng.chance(0.5) ? randomCode(rng) : pickConsistent();
      break;
    case 'medium':
      code = pickConsistent();
      break;
    case 'hard': {
      if (mine.length === 0) {
        // Zamíchané barvy, aby první tah nebyl vždy stejný.
        const colors = rng.shuffle(Array.from({ length: COLORS }, (_, i) => i));
        code = KNUTH_OPENING.map((c) => colors[c] ?? c);
        break;
      }
      const options = consistentCodes(mine);
      code = minimaxGuess(rng.shuffle(options)) ?? randomCode(rng);
      break;
    }
  }
  return { kind: 'guess', code };
}
