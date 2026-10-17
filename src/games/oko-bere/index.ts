import { defineGame } from '../../core/MiniGame';
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

const describe = (cards: number[] | null): string =>
  !cards ? '?' : isOko(cards) ? 'oko' : String(handTotal(cards));

export const okoBere = defineGame<OkoState, OkoMove, OkoView>({
  id: 'oko-bere',
  name: 'Oko bere',
  type: 'card',
  length: 'quick',
  rules: [
    'Mariášové karty: 7–10 podle čísla, spodek a svršek 1, král 2, eso 11.',
    'Každý dostane jednu kartu. Pak se oba současně rozhodují: líznout další, nebo stát (stát už platí do konce).',
    'Kdo má blíž k 21, vyhrává; přes 21 prohrává. Dvě esa („oko“) vyhrávají vždy. Stejný součet nebo oba přes 21 = remíza.',
    'Soupeř vidí jen počet tvých karet – odhalují se, až oba stojí. Na rozhodnutí máš 30 s.',
    'Online se balíček míchá šifrovaně u obou hráčů (mental poker) – karty nezná ani hostitel.',
  ],
  controls: (mode) => {
    const keys = 'Líznout: L nebo 1 · Stát: S nebo 2 (nebo tlačítka).';
    return mode === 'local'
      ? ['Před každým rozhodnutím se zařízení předá – soupeř nevidí tvoje karty.', keys]
      : [keys];
  },
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
