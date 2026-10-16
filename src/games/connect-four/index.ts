import { defineGame } from '../../core/MiniGame';
import { c4AIMove } from './ai';
import {
  c4Logic,
  c4MoveSchema,
  c4ViewSchema,
  type C4Move,
  type C4State,
  type C4View,
} from './logic';
import { createC4View } from './view';

const KEYS = 'Klik / klepnutí na sloupec, nebo klávesy 1–7.';

export const connectFour = defineGame<C4State, C4Move, C4View>({
  id: 'connect-four',
  name: 'Čtyři v řadě',
  type: 'turn',
  length: 'long',
  rules: [
    'Hráči se střídají v pouštění kamenů do sloupců desky 7×6 – kámen spadne na nejnižší volné místo.',
    'Vyhrává, kdo první složí čtyři kameny v řadě – vodorovně, svisle nebo úhlopříčně.',
    'Plná deska bez čtveřice je remíza.',
    'Na tah máš 45 s, pak se táhne automaticky.',
  ],
  controls: (mode) =>
    mode === 'local' ? ['Hráči se u zařízení střídají – deska je společná.', KEYS] : [KEYS],
  localLayout: 'shared',
  moveTimeoutMs: 45_000,
  revealMs: 1800,
  logic: c4Logic,
  moveSchema: c4MoveSchema,
  viewSchema: c4ViewSchema,
  getAIMove: c4AIMove,
  summarize: (view, names) => {
    const owner = view.winLine ? view.board[view.winLine[0] ?? -1] : null;
    return owner ? `${names[owner]} složil(a) čtyři v řadě` : 'Plná deska bez čtveřice';
  },
  createView: createC4View,
});
