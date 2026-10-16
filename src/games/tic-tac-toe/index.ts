import { defineGame } from '../../core/MiniGame';
import { tttAIMove } from './ai';
import {
  tttLogic,
  tttMoveSchema,
  tttViewSchema,
  type TttMove,
  type TttState,
  type TttView,
} from './logic';
import { createTttView } from './view';

const KEYS = 'Klik / klepnutí na pole, nebo klávesy 1–9 (zleva doprava, shora dolů).';

export const ticTacToe = defineGame<TttState, TttMove, TttView>({
  id: 'tic-tac-toe',
  name: 'Piškvorky 3×3',
  type: 'turn',
  length: 'quick',
  rules: [
    'Hráči se střídají v kreslení svých značek (✕ / ○) do mřížky 3×3.',
    'Vyhrává, kdo první složí tři značky v řadě – vodorovně, svisle nebo úhlopříčně.',
    'Plná deska bez trojice je remíza; začínající hráč se v dalším kole střídá.',
    'Na tah máš 30 s, pak se táhne automaticky.',
  ],
  controls: (mode) =>
    mode === 'local' ? ['Hráči se u zařízení střídají – deska je společná.', KEYS] : [KEYS],
  localLayout: 'shared',
  moveTimeoutMs: 30_000,
  revealMs: 1600,
  logic: tttLogic,
  moveSchema: tttMoveSchema,
  viewSchema: tttViewSchema,
  getAIMove: tttAIMove,
  summarize: (view, names) => {
    const owner = view.winLine ? view.cells[view.winLine[0] ?? -1] : null;
    return owner ? `${names[owner]} složil(a) trojici` : 'Plná deska bez trojice';
  },
  createView: createTttView,
});
