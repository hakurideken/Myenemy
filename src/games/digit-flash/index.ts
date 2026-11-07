import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
import { digitAIDelay, digitAIMove } from './ai';
import {
  digitLogic,
  digitMoveSchema,
  digitViewSchema,
  MAX_POINTS,
  ROUNDS,
  type DigitMove,
  type DigitResult,
  type DigitState,
  type DigitView,
} from './logic';
import { createDigitView } from './view';

const t = translations(
  {
    name: 'Čísla na mžik',
    rules: [
      `${ROUNDS} kol. Na chvíli blikne číslo – v prvním kole 4 číslice, každé kolo o jednu víc.`,
      'Číslo zmizí a ty ho napíšeš (na odpověď je 12 s).',
      'Bod za každou číslici na správném místě. Oba hráči dostanou stejná čísla.',
      `Vyhrává víc bodů (nejvýš ${MAX_POINTS}). Při shodě kratší celkový čas zápisu.`,
    ],
    controls: ['Klávesy 0–9, Backspace maže, Enter potvrdí.', 'Nebo klávesnice na obrazovce.'],
    result: (r: DigitResult) =>
      r.kind === 'invalid' ? 'neplatné' : `${r.points}/${MAX_POINTS} b.`,
  },
  {
    name: 'Flash Digits',
    rules: [
      `${ROUNDS} rounds. A number flashes for a moment – 4 digits in the first round, one more each round.`,
      'The number disappears and you type it (you have 12 s).',
      'A point for every digit in the right place. Both players get the same numbers.',
      `More points wins (at most ${MAX_POINTS}). On a tie, the shorter total typing time wins.`,
    ],
    controls: ['Keys 0–9, Backspace deletes, Enter confirms.', 'Or the on-screen number pad.'],
    result: (r: DigitResult) =>
      r.kind === 'invalid' ? 'invalid' : `${r.points}/${MAX_POINTS} pts`,
  },
);

export const digitFlash = defineGame<DigitState, DigitMove, DigitView>({
  id: 'digit-flash',
  name: t.name,
  type: 'reaction',
  length: 'quick',
  cognitive: { primary: 'memory', secondary: null },
  rules: t.rules,
  controls: () => t.controls,
  moveTimeoutMs: null,
  // 7 kol po nejvýš ~17 s + odpočet a rezerva.
  untimedLimitMs: 3 * 60_000,
  revealMs: 2500,
  logic: digitLogic,
  moveSchema: digitMoveSchema,
  viewSchema: digitViewSchema,
  getAIMove: digitAIMove,
  aiDelayMs: digitAIDelay,
  inactiveMove: () => ({ kind: 'answers', answers: [] }),
  summarize: (view, names) =>
    view.results
      ? `${names.A}: ${t.result(view.results.A)} · ${names.B}: ${t.result(view.results.B)}`
      : '',
  createView: createDigitView,
});
