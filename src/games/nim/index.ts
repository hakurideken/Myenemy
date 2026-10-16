import { defineGame } from '../../core/MiniGame';
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

const KEYS = 'Tlačítka „Vzít 1 / 2 / 3“, nebo klávesy 1, 2, 3.';

export const nim = defineGame<NimState, NimMove, NimView>({
  id: 'nim',
  name: 'Sirky',
  type: 'turn',
  length: 'quick',
  rules: [
    `Na stole je ${MIN_START}–${MAX_START} sirek (náhodně).`,
    'Hráči se střídají a berou 1, 2, nebo 3 sirky.',
    'Kdo vezme poslední sirku, prohrál. Remíza tu nastat nemůže.',
    'Na tah máš 30 s, pak se táhne automaticky.',
  ],
  controls: (mode) => (mode === 'local' ? ['Hráči se u zařízení střídají.', KEYS] : [KEYS]),
  localLayout: 'shared',
  moveTimeoutMs: 30_000,
  revealMs: 1600,
  logic: nimLogic,
  moveSchema: nimMoveSchema,
  viewSchema: nimViewSchema,
  getAIMove: nimAIMove,
  summarize: (view, names) => (view.loser ? `${names[view.loser]} vzal(a) poslední sirku` : ''),
  createView: createNimView,
});
