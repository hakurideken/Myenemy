import type { AnyMiniGameModule, GameInfo } from '../core/MiniGame';
import type { GameId } from '../core/types';
import { quickDraw } from './quick-draw';
import { rps } from './rps';

/**
 * Jediný seznam miniher. Nová hra = nový modul ve složce games/ + řádek sem;
 * automaticky se objeví ve vlastním výběru i v losování.
 */
export const GAMES: readonly AnyMiniGameModule[] = [quickDraw, rps];

export const GAME_INFOS: readonly GameInfo[] = GAMES.map(({ id, name, type, length }) => ({
  id,
  name,
  type,
  length,
}));

export function getGame(id: GameId): AnyMiniGameModule {
  const game = GAMES.find((g) => g.id === id);
  if (!game) throw new Error(`Neznámá hra: ${id}`);
  return game;
}
