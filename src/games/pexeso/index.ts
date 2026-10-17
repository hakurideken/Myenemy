import { defineGame } from '../../core/MiniGame';
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

export const pexeso = defineGame<PexesoState, PexesoMove, PexesoView>({
  id: 'pexeso',
  name: 'Pexeso duel',
  type: 'card',
  length: 'long',
  rules: [
    `${PAIRS} dvojic kartiček lícem dolů. Na tahu otočíš dvě – když jsou stejné, bereš je a hraješ znovu.`,
    'Když stejné nejsou, otočí se zpět a hraje soupeř. Pamatuj si, co už bylo vidět!',
    `Vyhrává, kdo má víc dvojic; ${PAIRS / 2}:${PAIRS / 2} je remíza. Po ${FLIP_LIMIT} otočeních rozhodne dosavadní stav. Na otočení máš 45 s.`,
    'Online se kartičky míchají šifrovaně u obou hráčů – rozložení nezná ani hostitel.',
  ],
  controls: (mode) =>
    mode === 'local'
      ? ['Hráči se u zařízení střídají – deska je společná.', 'Klik nebo Tab a Enter na kartičku.']
      : ['Klik nebo Tab a Enter na kartičku.'],
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
