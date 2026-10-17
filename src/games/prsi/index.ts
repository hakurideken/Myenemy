import { defineGame } from '../../core/MiniGame';
import { prsiAIMove } from './ai';
import {
  MOVE_LIMIT,
  prsiCards,
  prsiLogic,
  prsiMoveSchema,
  prsiViewSchema,
  type PrsiMove,
  type PrsiState,
  type PrsiView,
} from './logic';
import { createPrsiView } from './view';

export const prsi = defineGame<PrsiState, PrsiMove, PrsiView>({
  id: 'prsi',
  name: 'Prší',
  type: 'card',
  length: 'long',
  rules: [
    'Mariášové karty, každý dostane 4. Na vrchní kartu dáš kartu stejné barvy nebo hodnoty, jinak si lízneš.',
    'Sedma: soupeř líže 2, pokud nepřebije sedmou (pak se líže 4, 6…). Eso: soupeř stojí, pokud nedá eso.',
    'Svršek jde na cokoli a určíš jím barvu. Kdo se první zbaví karet, vyhrává.',
    `Když po ${MOVE_LIMIT} tazích nikdo nevyhraje, vyhrává ten s méně kartami (stejně = remíza). Na tah máš 45 s.`,
    'Soupeř vidí jen počet tvých karet. Online se balíček míchá šifrovaně u obou (mental poker).',
  ],
  controls: (mode) => {
    const keys = 'Klik na kartu ji zahraje · L = líznout · S = stojím (eso) · barvu svrškem 1–4.';
    return mode === 'local'
      ? ['Před každým tahem se zařízení předá – soupeř nevidí tvoje karty.', keys]
      : [keys];
  },
  localLayout: 'hotseat',
  moveTimeoutMs: 45_000,
  handoffDelayMs: 1200,
  revealMs: 2500,
  cards: prsiCards,
  logic: prsiLogic,
  moveSchema: prsiMoveSchema,
  viewSchema: prsiViewSchema,
  getAIMove: prsiAIMove,
  summarize: (view, names) =>
    view.hands.A.length === 0 || view.hands.B.length === 0
      ? `${names[view.hands.A.length === 0 ? 'A' : 'B']} se zbavil(a) všech karet.`
      : `Po ${view.moves} tazích – ${names.A}: ${view.hands.A.length} karet, ${names.B}: ${view.hands.B.length} karet.`,
  createView: createPrsiView,
});
