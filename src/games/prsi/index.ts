import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
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

const t = translations(
  {
    name: 'Prší',
    rules: [
      'Mariášové karty, každý dostane 4. Na vrchní kartu dáš kartu stejné barvy nebo hodnoty, jinak si lízneš.',
      'Sedma: soupeř líže 2, pokud nepřebije sedmou (pak se líže 4, 6…). Eso: soupeř stojí, pokud nedá eso.',
      'Svršek jde na cokoli a určíš jím barvu. Kdo se první zbaví karet, vyhrává.',
      `Když po ${MOVE_LIMIT} tazích nikdo nevyhraje, vyhrává ten s méně kartami (stejně = remíza). Na tah máš 45 s.`,
      'Soupeř vidí jen počet tvých karet. Online se balíček míchá šifrovaně u obou (mental poker).',
    ],
    keys: 'Klik na kartu ji zahraje · L = líznout · S = stojím (eso) · barvu svrškem 1–4.',
    handoff: 'Před každým tahem se zařízení předá – soupeř nevidí tvoje karty.',
    emptied: (name: string) => `${name} se zbavil(a) všech karet.`,
    afterMoves: (moves: number, nameA: string, a: number, nameB: string, b: number) =>
      `Po ${moves} tazích – ${nameA}: ${a} karet, ${nameB}: ${b} karet.`,
  },
  {
    name: 'Prší (Crazy Eights)',
    rules: [
      'Mariáš (German-suited) cards, 4 each. Play a card matching the top card’s suit or rank, otherwise draw.',
      'Seven: your opponent draws 2 unless they play another seven (then 4, 6… are drawn). Ace: your opponent must stand unless they play an ace.',
      'An Ober goes on anything and lets you choose the suit. First to get rid of all cards wins.',
      `If nobody wins within ${MOVE_LIMIT} moves, fewer cards wins (equal = draw). You have 45 s per move.`,
      'Your opponent only sees how many cards you have. Online, both players shuffle the deck with encryption (mental poker).',
    ],
    keys: 'Click a card to play it · L = draw · S = stand (ace) · Ober suit 1–4.',
    handoff: 'Pass the device before each move – your opponent can’t see your cards.',
    emptied: (name) => `${name} got rid of all cards.`,
    afterMoves: (moves, nameA, a, nameB, b) =>
      `After ${moves} moves – ${nameA}: ${a} ${a === 1 ? 'card' : 'cards'}, ${nameB}: ${b} ${b === 1 ? 'card' : 'cards'}.`,
  },
);

export const prsi = defineGame<PrsiState, PrsiMove, PrsiView>({
  id: 'prsi',
  name: t.name,
  type: 'card',
  length: 'long',
  rules: t.rules,
  controls: (mode) => (mode === 'local' ? [t.handoff, t.keys] : [t.keys]),
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
      ? t.emptied(names[view.hands.A.length === 0 ? 'A' : 'B'])
      : t.afterMoves(view.moves, names.A, view.hands.A.length, names.B, view.hands.B.length),
  createView: createPrsiView,
});
