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

/**
 * Kognitivní skupiny her (podklad pro statistiky hráče): rychlost a postřeh, paměť,
 * logika a dedukce, strategie a plánování, odhad a čtení soupeře.
 */
export type CognitiveGroup = 'speed' | 'memory' | 'logic' | 'strategy' | 'chance';
export const COGNITIVE_GROUPS: readonly CognitiveGroup[] = [
  'speed',
  'memory',
  'logic',
  'strategy',
  'chance',
];

export interface CognitiveProfile {
  /** Do ní se počítají statistiky – jedna na hru, ať se nic nepočítá dvakrát. */
  readonly primary: CognitiveGroup;
  /** Jen pro informaci (co hra procvičuje navíc). */
  readonly secondary: CognitiveGroup | null;
}
export type GameLength = 'quick' | 'long';
export type GameMode = 'pve' | 'online';
export type GameId = string;
