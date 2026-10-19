import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
import { tttAIMove } from './ai';
import {
  MAX_MARKS,
  MOVE_LIMIT,
  tttLogic,
  tttMoveSchema,
  tttViewSchema,
  type TttMove,
  type TttState,
  type TttView,
} from './logic';
import { createTttView } from './view';

const t = translations(
  {
    name: 'Piškvorky 3×3',
    rules: [
      `Hráči se střídají v kreslení svých značek (✕ / ○) do mřížky 3×3. Každý smí mít na desce nejvýš ${MAX_MARKS} značky.`,
      'Když položíš čtvrtou, tvoje nejstarší značka zmizí (předem je vybledlá). Její pole v tom tahu obsadit nejde.',
      'Vyhrává, kdo první složí tři značky v řadě – vodorovně, svisle nebo úhlopříčně. Remíza tak nehrozí.',
      `Pojistka: po ${MOVE_LIMIT} tazích bez trojice je kolo nerozhodné. Na tah máš 30 s, pak se táhne automaticky.`,
    ],
    localControls: 'Hráči se u zařízení střídají – deska je společná.',
    keys: 'Klik / klepnutí na pole, nebo klávesy 1–9 (zleva doprava, shora dolů).',
    summaryWin: (name: string) => `${name} složil(a) trojici`,
    summaryLimit: `Po ${MOVE_LIMIT} tazích bez trojice`,
  },
  {
    name: 'Tic-Tac-Toe 3×3',
    rules: [
      `Players take turns drawing their marks (✕ / ○) on a 3×3 grid. Each player may have at most ${MAX_MARKS} marks on the board.`,
      'When you place a fourth, your oldest mark disappears (it is faded beforehand). Its cell cannot be taken on that turn.',
      'The first to get three marks in a row – horizontally, vertically or diagonally – wins. So there are no draws.',
      `Safety net: after ${MOVE_LIMIT} moves without three in a row, the round is a draw. You have 30 s per move, then a move is played automatically.`,
    ],
    localControls: 'Players take turns at the device – the board is shared.',
    keys: 'Click / tap a cell, or press keys 1–9 (left to right, top to bottom).',
    summaryWin: (name: string) => `${name} got three in a row`,
    summaryLimit: `No three in a row after ${MOVE_LIMIT} moves`,
  },
);

export const ticTacToe = defineGame<TttState, TttMove, TttView>({
  id: 'tic-tac-toe',
  name: t.name,
  type: 'turn',
  length: 'quick',
  rules: t.rules,
  controls: (mode) => (mode === 'local' ? [t.localControls, t.keys] : [t.keys]),
  localLayout: 'shared',
  moveTimeoutMs: 30_000,
  revealMs: 1600,
  logic: tttLogic,
  moveSchema: tttMoveSchema,
  viewSchema: tttViewSchema,
  getAIMove: tttAIMove,
  summarize: (view, names) => {
    const owner = view.winLine ? view.cells[view.winLine[0] ?? -1] : null;
    return owner ? t.summaryWin(names[owner]) : t.summaryLimit;
  },
  createView: createTttView,
});
