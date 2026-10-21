import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
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

const t = translations(
  {
    name: 'Logik souboj',
    rules: [
      'Každý tajně zvolí kód ze 4 barev (6 barev, smějí se opakovat). Soupeř ho hádá.',
      'Hádá se současně: oba tipnou a u každé pozice uvidí, jestli sedí barva i místo (zlatá), jen barva – je jinde v kódu (kroužek), nebo nic.',
      'Vyhrává, kdo prolomí kód na méně pokusů. Prolomí-li ho oba ve stejném kole nebo nikdo do 10 pokusů, je remíza.',
      'Na volbu kódu i na každý tip máš 60 s, pak se zvolí automaticky.',
      'Online se kód na začátku zapečetí otiskem a po hře se ověří, že soupeř odpovídal poctivě.',
    ],
    keys: 'Barvy klávesami 1–6 nebo klepnutím, Backspace maže, Enter potvrdí.',
    handoff: 'Před každým tipem se zařízení předá – soupeř nevidí tvůj kód.',
    nobodyCracked: 'Kód nikdo neprolomil.',
    crackedOn: (name: string, attempt: number) => `${name}: kód prolomen na ${attempt}. pokus`,
  },
  {
    name: 'Codebreaker Duel',
    rules: [
      'Each player secretly sets a code of 4 colors (6 colors, repeats allowed). The opponent tries to guess it.',
      'Both guess at the same time and see for each position whether color and place match (gold), only the color is in the code elsewhere (ring), or nothing.',
      'Whoever cracks the code in fewer attempts wins. If both crack it in the same round, or nobody does within 10 attempts, it is a draw.',
      'You have 60 s to set your code and for each guess; after that, one is chosen automatically.',
      'Online, each code is sealed with a hash at the start, and after the game it is checked that the opponent answered honestly.',
    ],
    keys: 'Colors with keys 1–6 or by tapping; Backspace deletes, Enter confirms.',
    handoff: "The device is handed over before every guess – the opponent can't see your code.",
    nobodyCracked: 'Nobody cracked the code.',
    crackedOn: (name: string, attempt: number) => `${name}: code cracked on attempt ${attempt}`,
  },
);

export const logik = defineGame<LogikState, LogikMove, LogikView, Code>({
  id: 'logik',
  name: t.name,
  type: 'hidden',
  length: 'long',
  rules: t.rules,
  controls: (mode) => (mode === 'local' ? [t.handoff, t.keys] : [t.keys]),
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
    if (solved.length === 0) return t.nobodyCracked;
    return solved.map((p) => t.crackedOn(names[p], view.guesses[p].length)).join(' · ');
  },
  createView: createLogikView,
});
