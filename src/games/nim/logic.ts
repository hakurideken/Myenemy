import { z } from 'zod';
import type { GameLogic } from '../../core/MiniGame';
import { otherPlayer, win, type PlayerSlot } from '../../core/types';

export const MIN_START = 15;
export const MAX_START = 25;
export const MAX_TAKE = 3;

export interface NimState {
  readonly initial: number;
  readonly remaining: number;
  readonly turn: PlayerSlot;
  /** Kdo vzal poslední sirku (prohrál). */
  readonly loser: PlayerSlot | null;
  readonly lastTake: { readonly player: PlayerSlot; readonly take: number } | null;
}

export type NimView = NimState;

export interface NimMove {
  readonly take: number;
}

const slot = z.enum(['A', 'B']);

export const nimMoveSchema = z.object({ take: z.number().int().min(1).max(MAX_TAKE) });
export const nimViewSchema = z.object({
  initial: z.number().int().min(MIN_START).max(MAX_START),
  remaining: z.number().int().min(0).max(MAX_START),
  turn: slot,
  loser: slot.nullable(),
  lastTake: z.object({ player: slot, take: z.number().int().min(1).max(MAX_TAKE) }).nullable(),
});

/** Misère Nim: kdo vezme poslední sirku, prohrál. Remíza nastat nemůže. */
export const nimLogic: GameLogic<NimState, NimMove, NimView> = {
  setup: ({ rng, starter }) => {
    const initial = rng.intRange(MIN_START, MAX_START);
    return { initial, remaining: initial, turn: starter, loser: null, lastTake: null };
  },
  toMove: (s) => (s.loser ? [] : [s.turn]),
  legal: (s, player, move) => s.turn === player && !s.loser && move.take <= s.remaining,
  apply: (s, player, move) => {
    const remaining = s.remaining - move.take;
    return {
      ...s,
      remaining,
      turn: otherPlayer(player),
      loser: remaining === 0 ? player : null,
      lastTake: { player, take: move.take },
    };
  },
  outcome: (s) => (s.loser ? win(otherPlayer(s.loser)) : null),
  view: (s) => s,
};
