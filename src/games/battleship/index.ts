import { defineGame } from '../../core/MiniGame';
import { battleshipAIMove } from './ai';
import {
  battleshipHidden,
  battleshipLogic,
  battleshipMoveSchema,
  battleshipViewSchema,
  FLEET,
  sunkCount,
  type BattleshipMove,
  type BattleshipState,
  type BattleshipView,
  type Fleet,
} from './logic';
import { createBattleshipView } from './view';

export const PLACEMENT_TIMEOUT_MS = 90_000;
export const SHOT_TIMEOUT_MS = 45_000;

export const battleship = defineGame<BattleshipState, BattleshipMove, BattleshipView, Fleet>({
  id: 'battleship',
  name: 'Lodě',
  type: 'hidden',
  length: 'long',
  rules: [
    'Každý tajně rozmístí flotilu na moře 8×8: lodě o délce 4, 3, 3, 2 a 2. Lodě se nesmějí dotýkat ani rohem.',
    'Hráči se střídají ve střelbě do soupeřova moře. Zásah = střílíš znovu, vedle = na tahu je soupeř.',
    'Vyhrává, kdo první potopí celou soupeřovu flotilu.',
    'Na rozmístění máš 90 s a na výstřel 45 s, pak se rozmístí nebo vystřelí automaticky.',
    'Online se rozmístění na začátku zapečetí otiskem a po hře se ověří, že soupeř hlásil zásahy poctivě.',
  ],
  controls: (mode) => {
    const keys = [
      'Rozmístění: vyber loď a klikni na pole (R otočí), nebo zvol Náhodně.',
      'Střelba: klik na pole soupeřova moře, nebo šipky a Enter.',
    ];
    return mode === 'local'
      ? ['Před každým tahem se zařízení předá – soupeř se nedívá na tvoje lodě.', ...keys]
      : keys;
  },
  localLayout: 'hotseat',
  moveTimeoutMs: SHOT_TIMEOUT_MS,
  moveTimeout: (view) => (view.phase === 'placing' ? PLACEMENT_TIMEOUT_MS : SHOT_TIMEOUT_MS),
  handoffDelayMs: 1500,
  revealMs: 2500,
  hidden: battleshipHidden,
  logic: battleshipLogic,
  moveSchema: battleshipMoveSchema,
  viewSchema: battleshipViewSchema,
  getAIMove: battleshipAIMove,
  summarize: (view, names) =>
    `Potopené lodě – ${names.A}: ${sunkCount(view.shots.A)}/${FLEET.length}, ${names.B}: ${sunkCount(view.shots.B)}/${FLEET.length}`,
  createView: createBattleshipView,
});
