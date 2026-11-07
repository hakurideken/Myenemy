import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
import { plural } from '../../ui/labels';
import { sequenceAIDelay, sequenceAIMove } from './ai';
import {
  MAX_LEVEL,
  sequenceLogic,
  sequenceMoveSchema,
  sequenceViewSchema,
  type SequenceMove,
  type SequenceResult,
  type SequenceState,
  type SequenceView,
} from './logic';
import { createSequenceView } from './view';

const t = translations(
  {
    name: 'Sekvence',
    rules: [
      'Čtyři pole se rozsvěcují v řadě – zapamatuj si pořadí a zopakuj ho.',
      'První kolo má 3 položky, každé další o jednu víc (stejná řada, jen delší).',
      'Po první chybě (nebo 6 s bez stisku) je konec. Oba hráči mají stejnou řadu.',
      `Vyhrává víc zvládnutých kol (nejvýš ${MAX_LEVEL}). Při shodě rychlejší zadávání.`,
    ],
    controls: ['Klikni nebo klepni na pole.', 'Klávesy 1–4.'],
    result: (r: SequenceResult) =>
      r.kind === 'invalid' ? 'neplatné' : `${r.level} ${plural(r.level, 'kolo', 'kola', 'kol')}`,
  },
  {
    name: 'Sequence',
    rules: [
      'Four pads light up in a row – remember the order and repeat it.',
      'The first round has 3 items, each next one one more (the same row, just longer).',
      'The first mistake (or 6 s without a press) ends it. Both players get the same row.',
      `More rounds cleared wins (at most ${MAX_LEVEL}). On a tie, faster input wins.`,
    ],
    controls: ['Click or tap a pad.', 'Keys 1–4.'],
    result: (r: SequenceResult) =>
      r.kind === 'invalid' ? 'invalid' : `${r.level} ${r.level === 1 ? 'round' : 'rounds'}`,
  },
);

export const sequence = defineGame<SequenceState, SequenceMove, SequenceView>({
  id: 'sequence',
  name: t.name,
  type: 'reaction',
  length: 'long',
  cognitive: { primary: 'memory', secondary: null },
  rules: t.rules,
  controls: () => t.controls,
  moveTimeoutMs: null,
  // Dlouhý běh (až 15 kol) – soupeř smí mlčet, dokud hraje.
  untimedLimitMs: 6 * 60_000,
  revealMs: 2500,
  logic: sequenceLogic,
  moveSchema: sequenceMoveSchema,
  viewSchema: sequenceViewSchema,
  getAIMove: sequenceAIMove,
  aiDelayMs: sequenceAIDelay,
  inactiveMove: () => ({ kind: 'run', presses: [], ms: 0 }),
  summarize: (view, names) =>
    view.results
      ? `${names.A}: ${t.result(view.results.A)} · ${names.B}: ${t.result(view.results.B)}`
      : '',
  createView: createSequenceView,
});
