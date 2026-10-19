import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
import { quickDrawAIDelay, quickDrawAIMove } from './ai';
import {
  formatResult,
  quickDrawLogic,
  quickDrawMoveSchema,
  quickDrawViewSchema,
  type QuickDrawMove,
  type QuickDrawState,
  type QuickDrawView,
} from './logic';
import { createQuickDrawView } from './view';

const t = translations(
  {
    name: 'Rychlý tasec',
    rules: [
      'Počkej na signál „PAL!“ – přijde po náhodné prodlevě.',
      'Kdo po signálu vystřelí dřív, vyhrává.',
      'Výstřel před signálem (nebo dřív než 100 ms po něm) znamená prohru kola.',
      'Remíza: oba vystřelí předčasně, oba to nestihnou do 2 s, nebo mají stejný čas.',
    ],
    controlsLocal: [
      'Hráč A: klávesa A nebo klepnutí na svou (levou / horní) polovinu.',
      'Hráč B: klávesa L nebo klepnutí na svou (pravou / dolní) polovinu.',
    ],
    controlsSolo: ['Mezerník, Enter, klik nebo klepnutí kamkoli do arény.'],
  },
  {
    name: 'Quick Draw',
    rules: [
      'Wait for the “FIRE!” signal – it comes after a random delay.',
      'Whoever fires first after the signal wins.',
      'Firing before the signal (or less than 100 ms after it) loses the round.',
      'Draw: both fire too early, both miss the 2 s window, or both have the same time.',
    ],
    controlsLocal: [
      'Player A: key A or tap your own (left / top) half.',
      'Player B: key L or tap your own (right / bottom) half.',
    ],
    controlsSolo: ['Space, Enter, click or tap anywhere in the arena.'],
  },
);

export const quickDraw = defineGame<QuickDrawState, QuickDrawMove, QuickDrawView>({
  id: 'quick-draw',
  name: t.name,
  type: 'reaction',
  length: 'quick',
  rules: t.rules,
  controls: (mode) => (mode === 'local' ? t.controlsLocal : t.controlsSolo),
  localLayout: 'split',
  moveTimeoutMs: null,
  revealMs: 1800,
  logic: quickDrawLogic,
  moveSchema: quickDrawMoveSchema,
  viewSchema: quickDrawViewSchema,
  getAIMove: quickDrawAIMove,
  aiDelayMs: quickDrawAIDelay,
  // Kdo nereaguje (odpojený soupeř), prostě nestihl – žádný „AI čas“ za něj.
  inactiveMove: () => ({ kind: 'timeout' }),
  summarize: (view, names) =>
    `${names.A}: ${formatResult(view.results.A)} · ${names.B}: ${formatResult(view.results.B)}`,
  createView: createQuickDrawView,
});
