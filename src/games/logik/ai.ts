import type { AIContext } from '../../core/MiniGame';
import {
  ALL_CODES,
  COLORS,
  randomCode,
  sameFeedback,
  scoreGuess,
  type Code,
  type Guess,
  type LogikMove,
  type LogikView,
} from './logic';

/** Kódy, které odpovídají všem dosavadním odpovědím soupeře. */
export function consistentCodes(guesses: readonly Guess[]): Code[] {
  const answered = guesses.filter((g) => g.feedback !== null);
  return ALL_CODES.filter((code) =>
    answered.every(
      (g) => g.feedback !== null && sameFeedback(scoreGuess(g.code, code), g.feedback),
    ),
  );
}

const MARK_DIGIT = { exact: 0, color: 1, none: 2 } as const;

const feedbackKey = (guess: Code, secret: Code): number =>
  scoreGuess(guess, secret).reduce((key, m) => key * 3 + MARK_DIGIT[m], 0);

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
