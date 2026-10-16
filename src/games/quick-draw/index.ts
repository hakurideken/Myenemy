import { defineGame } from '../../core/MiniGame';
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

export const quickDraw = defineGame<QuickDrawState, QuickDrawMove, QuickDrawView>({
  id: 'quick-draw',
  name: 'Rychlý tasec',
  type: 'reaction',
  length: 'quick',
  rules: [
    'Počkej na signál „PAL!“ – přijde po náhodné prodlevě.',
    'Kdo po signálu vystřelí dřív, vyhrává.',
    'Výstřel před signálem (nebo dřív než 100 ms po něm) znamená prohru kola.',
    'Remíza: oba vystřelí předčasně, oba to nestihnou do 2 s, nebo mají stejný čas.',
  ],
  controls: (mode) =>
    mode === 'local'
      ? [
          'Hráč A: klávesa A nebo klepnutí na svou (levou / horní) polovinu.',
          'Hráč B: klávesa L nebo klepnutí na svou (pravou / dolní) polovinu.',
        ]
      : ['Mezerník, Enter, klik nebo klepnutí kamkoli do arény.'],
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
