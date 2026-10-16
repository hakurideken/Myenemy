import { defineGame } from '../../core/MiniGame';
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

const KEY_HELP = 'Klávesy 1 = kámen, 2 = nůžky, 3 = papír, nebo klik / klepnutí.';

export const rps = defineGame<RpsState, RpsMove, RpsView>({
  id: 'rps',
  name: 'Kámen-nůžky-papír',
  type: 'turn',
  length: 'quick',
  rules: [
    'Oba hráči tajně zvolí kámen, nůžky, nebo papír – odhalí se najednou.',
    'Kámen tupí nůžky, nůžky stříhají papír, papír balí kámen.',
    'Stejná volba je remíza.',
    'Na volbu máš 15 s, pak se zvolí náhodně.',
  ],
  controls: (mode) =>
    mode === 'local'
      ? ['Hráči volí postupně, mezi volbami si předají zařízení.', KEY_HELP]
      : [KEY_HELP],
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
