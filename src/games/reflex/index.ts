import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
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

const t = translations(
  {
    name: 'Postřeh',
    rules: [
      'Před tebou jsou čtyři cíle – každý má jinou barvu i jiný tvar.',
      'Po náhodné prodlevě se objeví výzva, např. „zelený trojúhelník“. Klepni na něj co nejrychleji.',
      'Špatný cíl nebo klepnutí před výzvou (či dřív než 100 ms po ní) znamená prohru kola.',
      'Remíza: oba chybují, oba to nestihnou do 3 s, nebo mají stejný čas.',
    ],
    controlsLocal: [
      'Hráč A: klávesy Q W E R nebo klepnutí na cíle ve své (levé / horní) polovině.',
      'Hráč B: klávesy U I O P nebo klepnutí na cíle ve své (pravé / dolní) polovině.',
    ],
    controlsSolo: ['Klávesy 1–4 (cíle zleva doprava), nebo klik / klepnutí na cíl.'],
  },
  {
    name: 'Reflex',
    rules: [
      'There are four targets in front of you – each has a different color and shape.',
      'After a random delay a prompt appears, e.g. “green triangle”. Tap that target as fast as you can.',
      'Tapping the wrong target, or tapping before the prompt (or less than 100 ms after it), loses the round.',
      'Draw: both make a mistake, both miss the 3 s window, or both have the same time.',
    ],
    controlsLocal: [
      'Player A: keys Q W E R or tap the targets in your own (left / top) half.',
      'Player B: keys U I O P or tap the targets in your own (right / bottom) half.',
    ],
    controlsSolo: ['Keys 1–4 (targets from left to right), or click / tap a target.'],
  },
);

export const reflex = defineGame<ReflexState, ReflexMove, ReflexView>({
  id: 'reflex',
  name: t.name,
  type: 'reaction',
  length: 'quick',
  rules: t.rules,
  controls: (mode) => (mode === 'local' ? t.controlsLocal : t.controlsSolo),
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
