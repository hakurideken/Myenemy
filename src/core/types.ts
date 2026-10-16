export type PlayerSlot = 'A' | 'B';
export const PLAYER_SLOTS: readonly PlayerSlot[] = ['A', 'B'];

export function otherPlayer(player: PlayerSlot): PlayerSlot {
  return player === 'A' ? 'B' : 'A';
}

export type PerPlayer<T> = Record<PlayerSlot, T>;

export type Outcome =
  { readonly kind: 'win'; readonly winner: PlayerSlot } | { readonly kind: 'draw' };

export const DRAW: Outcome = { kind: 'draw' };

export function win(winner: PlayerSlot): Outcome {
  return { kind: 'win', winner };
}

export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

export type GameType = 'reaction' | 'turn' | 'hidden' | 'card';
export type GameLength = 'quick' | 'long';
export type GameMode = 'pve' | 'local' | 'online';
export type GameId = string;
