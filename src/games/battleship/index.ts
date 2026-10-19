import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
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

const t = translations(
  {
    name: 'Lodě',
    rules: [
      'Každý tajně rozmístí flotilu na moře 8×8: lodě o délce 4, 3, 3, 2 a 2. Lodě se nesmějí dotýkat ani rohem.',
      'Hráči se střídají ve střelbě do soupeřova moře. Zásah = střílíš znovu, vedle = na tahu je soupeř.',
      'Vyhrává, kdo první potopí celou soupeřovu flotilu.',
      'Na rozmístění máš 90 s a na výstřel 45 s, pak se rozmístí nebo vystřelí automaticky.',
      'Online se rozmístění na začátku zapečetí otiskem a po hře se ověří, že soupeř hlásil zásahy poctivě.',
    ],
    keys: [
      'Rozmístění: vyber loď a klikni na pole (R otočí), nebo zvol Náhodně.',
      'Střelba: klik na pole soupeřova moře, nebo šipky a Enter.',
    ],
    handoff: 'Před každým tahem se zařízení předá – soupeř se nedívá na tvoje lodě.',
    summary: (a: string, sunkA: number, b: string, sunkB: number, total: number) =>
      `Potopené lodě – ${a}: ${sunkA}/${total}, ${b}: ${sunkB}/${total}`,
  },
  {
    name: 'Battleships',
    rules: [
      'Each player secretly places a fleet on an 8×8 sea: ships of length 4, 3, 3, 2 and 2. Ships may not touch, not even diagonally.',
      "Players take turns firing into the opponent's sea. A hit lets you fire again; a miss passes the turn to the opponent.",
      "The first to sink the opponent's entire fleet wins.",
      'You have 90 s for placement and 45 s per shot; after that, the fleet is placed or a shot is fired automatically.',
      'Online, each placement is sealed with a hash at the start, and after the game it is checked that the opponent reported hits honestly.',
    ],
    keys: [
      'Placement: pick a ship and click a cell (R rotates), or choose Random.',
      "Firing: click a cell in the opponent's sea, or use the arrow keys and Enter.",
    ],
    handoff:
      "The device is handed over before every turn – the opponent doesn't look at your ships.",
    summary: (a: string, sunkA: number, b: string, sunkB: number, total: number) =>
      `Ships sunk – ${a}: ${sunkA}/${total}, ${b}: ${sunkB}/${total}`,
  },
);

export const battleship = defineGame<BattleshipState, BattleshipMove, BattleshipView, Fleet>({
  id: 'battleship',
  name: t.name,
  type: 'hidden',
  length: 'long',
  rules: t.rules,
  controls: (mode) => (mode === 'local' ? [t.handoff, ...t.keys] : t.keys),
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
    t.summary(names.A, sunkCount(view.shots.A), names.B, sunkCount(view.shots.B), FLEET.length),
  createView: createBattleshipView,
});
