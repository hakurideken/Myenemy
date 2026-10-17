import type { AIContext } from '../../core/MiniGame';
import { otherPlayer } from '../../core/types';
import type { Rng } from '../../core/util/rng';
import { MARIAS_SIZE } from '../shared/marias';
import { handScore, handTotal, isOko, knownHand, type OkoMove, type OkoView } from './logic';

const SAMPLES = 300;

/** Soupeř, který ještě hraje, bude líznout zhruba do 17. */
function finishOpponent(cards: number[], pool: number[], active: boolean): number[] {
  const out = [...cards];
  while (active && handTotal(out) < 17 && pool.length > 0) out.push(pool.pop() ?? 0);
  return out;
}

/** Po líznutí AI pokračuje, dokud nemá aspoň tolik (nebo oko). */
const KEEP_DRAWING_BELOW = 15;

/**
 * Pravděpodobnost výhry (remíza = půl) při „stát“ a při „líznout“ (a pak lízat dál
 * do KEEP_DRAWING_BELOW), odhadnutá simulací neznámých karet.
 */
export function winChances(
  mine: readonly number[],
  opponentCount: number,
  opponentActive: boolean,
  rng: Rng,
): { stand: number; draw: number } {
  const unknown = Array.from({ length: MARIAS_SIZE }, (_, c) => c).filter((c) => !mine.includes(c));
  let stand = 0;
  let draw = 0;
  for (let i = 0; i < SAMPLES; i++) {
    let pool = rng.shuffle(unknown);
    let dealt = pool.slice(-opponentCount);
    // Kdo už stojí, má nejspíš aspoň 14 (nebo přetáhl) – takové ruce bereme.
    for (let tries = 0; !opponentActive && tries < 20; tries++) {
      const score = handScore(dealt);
      if (score < 0 || score >= 14) break;
      pool = rng.shuffle(unknown);
      dealt = pool.slice(-opponentCount);
    }
    pool = pool.slice(0, pool.length - opponentCount);
    const drawn = [...mine, pool.pop() ?? 0];
    while (!isOko(drawn) && handTotal(drawn) < KEEP_DRAWING_BELOW && pool.length > 0) {
      drawn.push(pool.pop() ?? 0);
    }
    const theirs = finishOpponent(dealt, pool, opponentActive);
    const them = handScore(theirs);
    const score = (cards: readonly number[]): number => {
      const me = handScore(cards);
      return me > them ? 1 : me === them ? 0.5 : 0;
    };
    stand += score(mine);
    draw += score(drawn);
  }
  return { stand: stand / SAMPLES, draw: draw / SAMPLES };
}

export function okoAIMove(view: OkoView, ai: AIContext): OkoMove {
  const known = ai.cards ?? new Map<number, number>();
  const hand = knownHand(view, ai.me, known) ?? [];
  const total = handTotal(hand);
  const opp = otherPlayer(ai.me);
  switch (ai.difficulty) {
    case 'easy': {
      // Riskuje nebo se bojí podle nálady (stojí někde mezi 10 a 18).
      const limit = 10 + ai.rng.int(9);
      return { kind: total < limit ? 'draw' : 'stand' };
    }
    case 'medium':
      return { kind: total < 17 ? 'draw' : 'stand' };
    case 'hard': {
      // Do 10 nejde přetáhnout – lízat se vyplatí vždy.
      if (total <= 10 && hand.length > 0) return { kind: 'draw' };
      const chances = winChances(hand, view.hands[opp].length, !view.stood[opp], ai.rng);
      return { kind: chances.draw > chances.stand ? 'draw' : 'stand' };
    }
  }
}
