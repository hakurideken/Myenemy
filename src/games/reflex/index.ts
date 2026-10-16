import { defineGame } from '../../core/MiniGame';
import { reflexAIDelay, reflexAIMove } from './ai';
import {
  formatReflex,
  reflexLogic,
  reflexMoveSchema,
  reflexViewSchema,
  type ReflexMove,
  type ReflexState,
  type ReflexView,
} from './logic';
import { createReflexView } from './view';

export const reflex = defineGame<ReflexState, ReflexMove, ReflexView>({
  id: 'reflex',
  name: 'Postřeh',
  type: 'reaction',
  length: 'quick',
  rules: [
    'Před tebou jsou čtyři cíle – každý má jinou barvu i jiný tvar.',
    'Po náhodné prodlevě se objeví výzva, např. „zelený trojúhelník“. Klepni na něj co nejrychleji.',
    'Špatný cíl nebo klepnutí před výzvou (či dřív než 100 ms po ní) znamená prohru kola.',
    'Remíza: oba chybují, oba to nestihnou do 3 s, nebo mají stejný čas.',
  ],
  controls: (mode) =>
    mode === 'local'
      ? [
          'Hráč A: klávesy Q W E R nebo klepnutí na cíle ve své (levé / horní) polovině.',
          'Hráč B: klávesy U I O P nebo klepnutí na cíle ve své (pravé / dolní) polovině.',
        ]
      : ['Klávesy 1–4 (cíle zleva doprava), nebo klik / klepnutí na cíl.'],
  localLayout: 'split',
  moveTimeoutMs: null,
  revealMs: 2000,
  logic: reflexLogic,
  moveSchema: reflexMoveSchema,
  viewSchema: reflexViewSchema,
  getAIMove: reflexAIMove,
  aiDelayMs: reflexAIDelay,
  inactiveMove: () => ({ kind: 'timeout' }),
  summarize: (view, names) =>
    view.results
      ? `${names.A}: ${formatReflex(view.results.A)} · ${names.B}: ${formatReflex(view.results.B)}`
      : '',
  createView: createReflexView,
});
