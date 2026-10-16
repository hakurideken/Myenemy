import type { AnyMiniGameModule, GameInfo } from '../core/MiniGame';
import type { GameId } from '../core/types';
import { battleship } from './battleship';
import { clickBattle } from './click-battle';
import { connectFour } from './connect-four';
import { dotsAndBoxes } from './dots-and-boxes';
import { logik } from './logik';
import { nim } from './nim';
import { quickDraw } from './quick-draw';
import { reflex } from './reflex';
import { rps } from './rps';
import { ticTacToe } from './tic-tac-toe';

/**
 * Jediný seznam miniher. Nová hra = nový modul ve složce games/ + řádek sem;
 * automaticky se objeví ve vlastním výběru i v losování.
 */
export const GAMES: readonly AnyMiniGameModule[] = [
  quickDraw,
  clickBattle,
  reflex,
  rps,
  ticTacToe,
  connectFour,
  nim,
  dotsAndBoxes,
  battleship,
  logik,
];

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
