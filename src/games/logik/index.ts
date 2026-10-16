import { defineGame } from '../../core/MiniGame';
import { logikAIMove } from './ai';
import {
  cracked,
  logikHidden,
  logikLogic,
  logikMoveSchema,
  logikViewSchema,
  type Code,
  type LogikMove,
  type LogikState,
  type LogikView,
} from './logic';
import { createLogikView } from './view';

const KEYS = 'Barvy klávesami 1–6 nebo klepnutím, Backspace maže, Enter potvrdí.';

export const logik = defineGame<LogikState, LogikMove, LogikView, Code>({
  id: 'logik',
  name: 'Logik souboj',
  type: 'hidden',
  length: 'long',
  rules: [
    'Každý tajně zvolí kód ze 4 barev (6 barev, smějí se opakovat). Soupeř ho hádá.',
    'Hádá se současně: oba tipnou a dostanou odpověď – kolik barev je přesně na místě a kolik jen v kódu.',
    'Vyhrává, kdo prolomí kód na méně pokusů. Prolomí-li ho oba ve stejném kole nebo nikdo do 10 pokusů, je remíza.',
    'Na volbu kódu i na každý tip máš 60 s, pak se zvolí automaticky.',
    'Online se kód na začátku zapečetí otiskem a po hře se ověří, že soupeř odpovídal poctivě.',
  ],
  controls: (mode) =>
    mode === 'local'
      ? ['Před každým tipem se zařízení předá – soupeř nevidí tvůj kód.', KEYS]
      : [KEYS],
  localLayout: 'hotseat',
  moveTimeoutMs: 60_000,
  handoffDelayMs: 1500,
  revealMs: 2500,
  hidden: logikHidden,
  logic: logikLogic,
  moveSchema: logikMoveSchema,
  viewSchema: logikViewSchema,
  getAIMove: logikAIMove,
  summarize: (view, names) => {
    const solved = (['A', 'B'] as const).filter((p) => cracked(view.guesses[p].at(-1)));
    if (solved.length === 0) return 'Kód nikdo neprolomil.';
    return solved
      .map((p) => `${names[p]}: kód prolomen na ${view.guesses[p].length}. pokus`)
      .join(' · ');
  },
  createView: createLogikView,
});
