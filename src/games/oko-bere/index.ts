import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
import { okoAIMove } from './ai';
import {
  okoCards,
  okoLogic,
  okoMoveSchema,
  okoViewSchema,
  shownHand,
  handTotal,
  isOko,
  type OkoMove,
  type OkoState,
  type OkoView,
} from './logic';
import { createOkoView } from './view';

const t = translations(
  {
    name: 'Oko bere',
    rules: [
      'Mariášové karty: 7–10 podle čísla, spodek a svršek 1, král 2, eso 11.',
      'Každý dostane jednu kartu. Pak se oba současně rozhodují: líznout další, nebo stát (stát už platí do konce).',
      'Kdo má blíž k 21, vyhrává; přes 21 prohrává. Dvě esa („oko“) vyhrávají vždy. Stejný součet nebo oba přes 21 = remíza.',
      'Soupeř vidí jen počet tvých karet – odhalují se, až oba stojí. Na rozhodnutí máš 30 s.',
      'Online se balíček míchá šifrovaně u obou hráčů (mental poker) – karty nezná ani hostitel.',
    ],
    keys: 'Líznout: L nebo 1 · Stát: S nebo 2 (nebo tlačítka).',
    handoff: 'Před každým rozhodnutím se zařízení předá – soupeř nevidí tvoje karty.',
    oko: 'oko',
  },
  {
    name: 'Twenty-One (Oko bere)',
    rules: [
      'Mariáš (German-suited) cards: 7–10 count their number, Unter and Ober 1, King 2, Ace 11.',
      'Each player gets one card. Then both decide at the same time: draw another or stand (standing is final).',
      'Whoever is closest to 21 wins; over 21 loses. Two aces (“oko”) always win. Equal totals or both over 21 = draw.',
      'Your opponent only sees how many cards you have – they are revealed once both stand. You have 30 s to decide.',
      'Online, both players shuffle the deck with encryption (mental poker) – not even the host knows the cards.',
    ],
    keys: 'Draw: L or 1 · Stand: S or 2 (or the buttons).',
    handoff: 'Pass the device before each decision – your opponent can’t see your cards.',
    oko: 'two aces',
  },
);

const describe = (cards: number[] | null): string =>
  !cards ? '?' : isOko(cards) ? t.oko : String(handTotal(cards));

export const okoBere = defineGame<OkoState, OkoMove, OkoView>({
  id: 'oko-bere',
  name: t.name,
  type: 'card',
  length: 'quick',
  rules: t.rules,
  controls: (mode) => (mode === 'local' ? [t.handoff, t.keys] : [t.keys]),
  localLayout: 'hotseat',
  moveTimeoutMs: 30_000,
  handoffDelayMs: 1200,
  revealMs: 3500,
  cards: okoCards,
  logic: okoLogic,
  moveSchema: okoMoveSchema,
  viewSchema: okoViewSchema,
  getAIMove: okoAIMove,
  summarize: (view, names) =>
    `${names.A}: ${describe(shownHand(view, 'A'))} · ${names.B}: ${describe(shownHand(view, 'B'))}`,
  createView: createOkoView,
});
