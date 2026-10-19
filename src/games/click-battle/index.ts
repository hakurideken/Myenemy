import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
import { clickAIDelay, clickAIMove } from './ai';
import {
  clickLogic,
  clickMoveSchema,
  clickViewSchema,
  formatClicks,
  type ClickMove,
  type ClickState,
  type ClickView,
} from './logic';
import { createClickView } from './view';

const t = translations(
  {
    name: 'Klikací souboj',
    rules: [
      'Po odpočtu 3 – 2 – 1 máš 5 sekund.',
      'Kdo za tu dobu klikne (klepne) víckrát, vyhrává.',
      'Stejný počet je remíza. Víc než 25 kliknutí za sekundu se bere jako neplatný výsledek.',
    ],
    controlsLocal: [
      'Hráč A: klávesa A nebo klepání na svou (levou / horní) polovinu.',
      'Hráč B: klávesa L nebo klepání na svou (pravou / dolní) polovinu.',
    ],
    controlsSolo: [
      'Mezerník, Enter, klik nebo klepání kamkoli do arény (držení klávesy se nepočítá).',
    ],
  },
  {
    name: 'Click Battle',
    rules: [
      'After the 3 – 2 – 1 countdown you have 5 seconds.',
      'Whoever clicks (taps) more times in that time wins.',
      'The same count is a draw. More than 25 clicks per second counts as an invalid result.',
    ],
    controlsLocal: [
      'Player A: key A or tap your own (left / top) half.',
      'Player B: key L or tap your own (right / bottom) half.',
    ],
    controlsSolo: [
      'Space, Enter, click or tap anywhere in the arena (holding a key does not count).',
    ],
  },
);

export const clickBattle = defineGame<ClickState, ClickMove, ClickView>({
  id: 'click-battle',
  name: t.name,
  type: 'reaction',
  length: 'quick',
  rules: t.rules,
  controls: (mode) => (mode === 'local' ? t.controlsLocal : t.controlsSolo),
  localLayout: 'split',
  moveTimeoutMs: null,
  revealMs: 2000,
  logic: clickLogic,
  moveSchema: clickMoveSchema,
  viewSchema: clickViewSchema,
  getAIMove: clickAIMove,
  aiDelayMs: clickAIDelay,
  inactiveMove: () => ({ kind: 'clicks', count: 0 }),
  summarize: (view, names) =>
    view.results
      ? `${names.A}: ${formatClicks(view.results.A)} · ${names.B}: ${formatClicks(view.results.B)}`
      : '',
  createView: createClickView,
});
