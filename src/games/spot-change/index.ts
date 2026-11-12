import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
import { spotAIDelay, spotAIMove } from './ai';
import {
  ROUNDS,
  spotLogic,
  spotMoveSchema,
  spotViewSchema,
  type SpotMove,
  type SpotResult,
  type SpotState,
  type SpotView,
} from './logic';
import { createSpotView } from './view';

const t = translations(
  {
    name: 'Co se změnilo',
    rules: [
      `${ROUNDS} kol. Na chvíli se ukáže deska s obrázky – zapamatuj si ji.`,
      'Po krátké pauze se deska vrátí s jednou změnou: něco zmizí, přibude, nebo se vymění.',
      'Klikni na místo, kde ke změně došlo (na odpověď je 8 s). Kola postupně přitvrzují.',
      'Vyhrává víc správných odpovědí. Při shodě rychlejší (součet časů správných odpovědí).',
    ],
    controls: ['Klikni nebo klepni na políčko.', 'Bez myši: Tab mezi políčky a Enter.'],
    result: (r: SpotResult) => (r.kind === 'invalid' ? 'neplatné' : `${r.correct}/${ROUNDS}`),
  },
  {
    name: 'Spot the Change',
    rules: [
      `${ROUNDS} rounds. A board with pictures shows for a moment – memorise it.`,
      'After a short pause the board comes back with one change: something vanishes, appears or is swapped.',
      'Click the spot where it changed (you have 8 s). The rounds get harder.',
      'More correct answers wins. On a tie, faster wins (sum of the times of correct answers).',
    ],
    controls: ['Click or tap a square.', 'Without a mouse: Tab between squares and Enter.'],
    result: (r: SpotResult) => (r.kind === 'invalid' ? 'invalid' : `${r.correct}/${ROUNDS}`),
  },
);

export const spotChange = defineGame<SpotState, SpotMove, SpotView>({
  id: 'spot-change',
  name: t.name,
  type: 'reaction',
  length: 'quick',
  cognitive: { primary: 'memory', secondary: 'speed' },
  rules: t.rules,
  controls: () => t.controls,
  moveTimeoutMs: null,
  // 7 kol po ~13 s nejvýš + odpočet a rezerva.
  untimedLimitMs: 2 * 60_000,
  // Každý hraje u sebe – divák vidí jen průběh a výsledek.
  spectator: false,
  revealMs: 2500,
  logic: spotLogic,
  moveSchema: spotMoveSchema,
  viewSchema: spotViewSchema,
  getAIMove: spotAIMove,
  aiDelayMs: spotAIDelay,
  inactiveMove: () => ({ kind: 'answers', answers: [] }),
  summarize: (view, names) =>
    view.results
      ? `${names.A}: ${t.result(view.results.A)} · ${names.B}: ${t.result(view.results.B)}`
      : '',
  createView: createSpotView,
});
