import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
import { pexesoAIMove } from './ai';
import {
  FLIP_LIMIT,
  PAIRS,
  pexesoCards,
  pexesoLogic,
  pexesoMoveSchema,
  pexesoViewSchema,
  type PexesoMove,
  type PexesoState,
  type PexesoView,
} from './logic';
import { createPexesoView } from './view';

const t = translations(
  {
    name: 'Pexeso duel',
    rules: [
      `${PAIRS} dvojic kartiček lícem dolů. Na tahu otočíš dvě – když jsou stejné, bereš je a hraješ znovu.`,
      'Když stejné nejsou, otočí se zpět a hraje soupeř. Pamatuj si, co už bylo vidět!',
      `Vyhrává, kdo má víc dvojic – při ${PAIRS} dvojicích remíza nenastane. Po ${FLIP_LIMIT} otočeních rozhodne dosavadní stav. Na otočení máš 45 s.`,
      'Online se kartičky míchají šifrovaně u obou hráčů – rozložení nezná ani hostitel.',
    ],
    sharedDevice: 'Hráči se u zařízení střídají – deska je společná.',
    keys: 'Klik nebo Tab a Enter na kartičku.',
  },
  {
    name: 'Memory Duel',
    rules: [
      `${PAIRS} pairs of cards lie face down. On your turn, flip two – if they match, you take them and go again.`,
      'If they don’t match, they flip back and your opponent plays. Remember what you’ve seen!',
      `Most pairs wins – with ${PAIRS} pairs there can’t be a draw. After ${FLIP_LIMIT} flips, the current score decides. You have 45 s per flip.`,
      'Online, both players shuffle the cards with encryption – not even the host knows the layout.',
    ],
    sharedDevice: 'Players take turns at the device – the board is shared.',
    keys: 'Click a card, or Tab to it and press Enter.',
  },
);

export const pexeso = defineGame<PexesoState, PexesoMove, PexesoView>({
  id: 'pexeso',
  name: t.name,
  type: 'card',
  length: 'long',
  rules: t.rules,
  controls: (mode) => (mode === 'local' ? [t.sharedDevice, t.keys] : [t.keys]),
  localLayout: 'shared',
  moveTimeoutMs: 45_000,
  revealMs: 2000,
  cards: pexesoCards,
  logic: pexesoLogic,
  moveSchema: pexesoMoveSchema,
  viewSchema: pexesoViewSchema,
  getAIMove: pexesoAIMove,
  summarize: (view, names) => `${names.A} ${view.score.A} : ${view.score.B} ${names.B}`,
  createView: createPexesoView,
});
