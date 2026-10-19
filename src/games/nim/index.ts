import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
import { nimAIMove } from './ai';
import {
  MAX_START,
  MIN_START,
  nimLogic,
  nimMoveSchema,
  nimViewSchema,
  type NimMove,
  type NimState,
  type NimView,
} from './logic';
import { createNimView } from './view';

const t = translations(
  {
    name: 'Sirky',
    rules: [
      `Na stole je ${MIN_START}–${MAX_START} sirek (náhodně).`,
      'Hráči se střídají a berou 1, 2, nebo 3 sirky.',
      'Kdo vezme poslední sirku, prohrál. Remíza tu nastat nemůže.',
      'Na tah máš 30 s, pak se táhne automaticky.',
    ],
    localControls: 'Hráči se u zařízení střídají.',
    keys: 'Tlačítka „Vzít 1 / 2 / 3“, nebo klávesy 1, 2, 3.',
    summary: (name: string) => `${name} vzal(a) poslední sirku`,
  },
  {
    name: 'Nim',
    rules: [
      `There are ${MIN_START}–${MAX_START} matches on the table (chosen at random).`,
      'Players take turns taking 1, 2 or 3 matches.',
      'Whoever takes the last match loses. There are no draws.',
      'You have 30 s per move, then a move is played automatically.',
    ],
    localControls: 'Players take turns at the device.',
    keys: 'Buttons “Take 1 / 2 / 3”, or keys 1, 2, 3.',
    summary: (name: string) => `${name} took the last match`,
  },
);

export const nim = defineGame<NimState, NimMove, NimView>({
  id: 'nim',
  name: t.name,
  type: 'turn',
  length: 'quick',
  rules: t.rules,
  controls: (mode) => (mode === 'local' ? [t.localControls, t.keys] : [t.keys]),
  localLayout: 'shared',
  moveTimeoutMs: 30_000,
  revealMs: 1600,
  logic: nimLogic,
  moveSchema: nimMoveSchema,
  viewSchema: nimViewSchema,
  getAIMove: nimAIMove,
  summarize: (view, names) => (view.loser ? t.summary(names[view.loser]) : ''),
  createView: createNimView,
});
