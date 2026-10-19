import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
import { rpsAIMove, rpsAIObserve } from './ai';
import {
  CHOICE_LABEL,
  describeRps,
  rpsLogic,
  rpsMoveSchema,
  rpsViewSchema,
  type RpsMove,
  type RpsState,
  type RpsView,
} from './logic';
import { createRpsView, RPS_SHAKE_MS } from './view';

const t = translations(
  {
    name: 'Kámen-nůžky-papír',
    rules: [
      'Oba hráči tajně zvolí kámen, nůžky, nebo papír – odhalí se najednou.',
      'Kámen tupí nůžky, nůžky stříhají papír, papír balí kámen.',
      'Stejná volba je remíza.',
      'Na volbu máš 15 s, pak se zvolí náhodně.',
    ],
    keyHelp: 'Klávesy 1 = kámen, 2 = nůžky, 3 = papír, nebo klik / klepnutí.',
    localTurns: 'Hráči volí postupně, mezi volbami si předají zařízení.',
  },
  {
    name: 'Rock-Paper-Scissors',
    rules: [
      'Both players secretly pick rock, scissors or paper – revealed at the same time.',
      'Rock crushes scissors, scissors cut paper, paper covers rock.',
      'The same choice is a draw.',
      'You have 15 s to choose, then a random choice is made for you.',
    ],
    keyHelp: 'Keys 1 = rock, 2 = scissors, 3 = paper, or click / tap.',
    localTurns: 'Players choose one after another, passing the device between picks.',
  },
);

export const rps = defineGame<RpsState, RpsMove, RpsView>({
  id: 'rps',
  name: t.name,
  type: 'turn',
  length: 'quick',
  rules: t.rules,
  controls: (mode) => (mode === 'local' ? [t.localTurns, t.keyHelp] : [t.keyHelp]),
  localLayout: 'hotseat',
  moveTimeoutMs: 15_000,
  revealMs: RPS_SHAKE_MS + 1900,
  logic: rpsLogic,
  moveSchema: rpsMoveSchema,
  viewSchema: rpsViewSchema,
  // Hostitel je zároveň hráč – volba hosta se mu nesmí ukázat dřív, než zvolí sám.
  sealed: {
    moveOf: (view, player) => (view.revealed ? { choice: view.revealed[player] } : null),
  },
  getAIMove: rpsAIMove,
  aiObserve: rpsAIObserve,
  summarize: (view, names) =>
    view.revealed
      ? `${names.A}: ${CHOICE_LABEL[view.revealed.A]} · ${names.B}: ${CHOICE_LABEL[view.revealed.B]} – ${describeRps(view.revealed)}`
      : '',
  createView: createRpsView,
});
