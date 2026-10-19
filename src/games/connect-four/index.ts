import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
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

const t = translations(
  {
    name: 'Čtyři v řadě',
    rules: [
      'Hráči se střídají v pouštění kamenů do sloupců desky 7×6 – kámen spadne na nejnižší volné místo.',
      'Vyhrává, kdo první složí čtyři kameny v řadě – vodorovně, svisle nebo úhlopříčně.',
      'Plná deska bez čtveřice je remíza.',
      'Na tah máš 45 s, pak se táhne automaticky.',
    ],
    localControls: 'Hráči se u zařízení střídají – deska je společná.',
    keys: 'Klik / klepnutí na sloupec, nebo klávesy 1–7.',
    summaryWin: (name: string) => `${name} složil(a) čtyři v řadě`,
    summaryFull: 'Plná deska bez čtveřice',
  },
  {
    name: 'Connect Four',
    rules: [
      'Players take turns dropping discs into the columns of a 7×6 board – a disc falls to the lowest free spot.',
      'The first to get four discs in a row – horizontally, vertically or diagonally – wins.',
      'A full board with no four in a row is a draw.',
      'You have 45 s per move, then a move is played automatically.',
    ],
    localControls: 'Players take turns at the device – the board is shared.',
    keys: 'Click / tap a column, or press keys 1–7.',
    summaryWin: (name: string) => `${name} got four in a row`,
    summaryFull: 'Full board, no four in a row',
  },
);

export const connectFour = defineGame<C4State, C4Move, C4View>({
  id: 'connect-four',
  name: t.name,
  type: 'turn',
  length: 'long',
  rules: t.rules,
  controls: (mode) => (mode === 'local' ? [t.localControls, t.keys] : [t.keys]),
  localLayout: 'shared',
  moveTimeoutMs: 45_000,
  revealMs: 1800,
  logic: c4Logic,
  moveSchema: c4MoveSchema,
  viewSchema: c4ViewSchema,
  getAIMove: c4AIMove,
  summarize: (view, names) => {
    const owner = view.winLine ? view.board[view.winLine[0] ?? -1] : null;
    return owner ? t.summaryWin(names[owner]) : t.summaryFull;
  },
  createView: createC4View,
});
