import { defineGame } from '../../core/MiniGame';
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

export const clickBattle = defineGame<ClickState, ClickMove, ClickView>({
  id: 'click-battle',
  name: 'Klikací souboj',
  type: 'reaction',
  length: 'quick',
  rules: [
    'Po odpočtu 3 – 2 – 1 máš 5 sekund.',
    'Kdo za tu dobu klikne (klepne) víckrát, vyhrává.',
    'Stejný počet je remíza. Víc než 25 kliknutí za sekundu se bere jako neplatný výsledek.',
  ],
  controls: (mode) =>
    mode === 'local'
      ? [
          'Hráč A: klávesa A nebo klepání na svou (levou / horní) polovinu.',
          'Hráč B: klávesa L nebo klepání na svou (pravou / dolní) polovinu.',
        ]
      : ['Mezerník, Enter, klik nebo klepání kamkoli do arény (držení klávesy se nepočítá).'],
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
