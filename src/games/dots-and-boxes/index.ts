import { defineGame } from '../../core/MiniGame';
import { dotsAIMove } from './ai';
import {
  dotsLogic,
  dotsMoveSchema,
  dotsViewSchema,
  type DotsMove,
  type DotsState,
  type DotsView,
} from './logic';
import { createDotsView } from './view';

const KEYS = 'Klik / klepnutí na čáru mezi tečkami, nebo Tab a Enter.';

export const dotsAndBoxes = defineGame<DotsState, DotsMove, DotsView>({
  id: 'dots-and-boxes',
  name: 'Tečky a čtverečky',
  type: 'turn',
  length: 'long',
  rules: [
    'Mřížka 4×4 políček (5×5 teček). Hráči se střídají v kreslení čar mezi sousedními tečkami.',
    'Kdo nakreslí čtvrtou stranu políčka, získá ho a hraje znovu.',
    'Vyhrává, kdo má po zaplnění mřížky víc políček; 8:8 je remíza.',
    'Na tah máš 45 s, pak se táhne automaticky.',
  ],
  controls: (mode) =>
    mode === 'local' ? ['Hráči se u zařízení střídají – mřížka je společná.', KEYS] : [KEYS],
  localLayout: 'shared',
  moveTimeoutMs: 45_000,
  revealMs: 1800,
  logic: dotsLogic,
  moveSchema: dotsMoveSchema,
  viewSchema: dotsViewSchema,
  getAIMove: dotsAIMove,
  summarize: (view, names) => `${names.A} ${view.score.A} : ${view.score.B} ${names.B}`,
  createView: createDotsView,
});
