import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
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

const t = translations(
  {
    name: 'Tečky a čtverečky',
    rules: [
      'Mřížka 4×4 políček (5×5 teček). Hráči se střídají v kreslení čar mezi sousedními tečkami.',
      'Kdo nakreslí čtvrtou stranu políčka, získá ho a hraje znovu.',
      'Vyhrává, kdo má po zaplnění mřížky víc políček; 8:8 je remíza.',
      'Na tah máš 45 s, pak se táhne automaticky.',
    ],
    localControls: 'Hráči se u zařízení střídají – mřížka je společná.',
    keys: 'Klik / klepnutí na čáru mezi tečkami, nebo Tab a Enter.',
  },
  {
    name: 'Dots and Boxes',
    rules: [
      'A 4×4 grid of boxes (5×5 dots). Players take turns drawing lines between adjacent dots.',
      'Whoever draws the fourth side of a box claims it and goes again.',
      'When the grid is full, whoever has more boxes wins; 8:8 is a draw.',
      'You have 45 s per move, then a move is played automatically.',
    ],
    localControls: 'Players take turns at the device – the grid is shared.',
    keys: 'Click / tap a line between dots, or use Tab and Enter.',
  },
);

export const dotsAndBoxes = defineGame<DotsState, DotsMove, DotsView>({
  id: 'dots-and-boxes',
  name: t.name,
  type: 'turn',
  length: 'long',
  rules: t.rules,
  controls: (mode) => (mode === 'local' ? [t.localControls, t.keys] : [t.keys]),
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
