import { defineGame } from '../../core/MiniGame';
import { lang, translations } from '../../i18n';
import { plural } from '../../ui/labels';
import { duckAIDelay, duckAIMove } from './ai';
import {
  COUNTDOWN_MS,
  duckLogic,
  duckMoveSchema,
  duckViewSchema,
  DURATION_MS,
  type DuckMove,
  type DuckState,
  type DuckView,
} from './logic';
import { createDuckView } from './view';

const t = translations(
  {
    name: 'Kachní hon',
    rules: [
      'Po odpočtu 3 – 2 – 1 létají minutu nad krajinou kachny – celkem 15, najednou nejvýš 3.',
      'Každá letí po své dráze a mění směr; pozdější kachny jsou rychlejší a po chvíli uletí.',
      'Kachnu získá, kdo ji trefí první – ostatní uvidí, jak padá v jeho barvě.',
      'Vyhrává víc sestřelených kachen. Při shodě rozhodne rychlejší reakce (součet časů od vylétnutí kachny do zásahu).',
      'Po minutí se puška chvíli nabíjí, střílení naslepo se nevyplatí.',
    ],
    controls: [
      'Klikni nebo klepni na kachnu.',
      'Bez myši: šipky posouvají zaměřovač, mezerník nebo Enter střílí.',
    ],
    ducks: (n: number) => `${n} ${plural(n, 'kachna', 'kachny', 'kachen')}`,
    reactions: (a: string, b: string) => `součet reakcí ${a} s : ${b} s`,
  },
  {
    name: 'Duck Hunt',
    rules: [
      'After the 3 – 2 – 1 countdown, ducks fly over the countryside for a minute – 15 in total, at most 3 at once.',
      'Each follows its own path and changes direction; later ducks are faster and fly away after a while.',
      'A duck goes to whoever hits it first – everyone sees it fall in that player’s colour.',
      'More ducks wins. On a tie, faster reactions decide (the sum of times from a duck appearing to the hit).',
      'After a miss the gun reloads for a moment, so shooting blindly does not pay.',
    ],
    controls: [
      'Click or tap a duck.',
      'Without a mouse: arrows move the crosshair, Space or Enter shoots.',
    ],
    ducks: (n: number) => `${n} ${n === 1 ? 'duck' : 'ducks'}`,
    reactions: (a: string, b: string) => `total reactions ${a} s : ${b} s`,
  },
);

/** Sekundy s jedním desetinným místem (česky s čárkou). */
const seconds = (ms: number): string =>
  (ms / 1000).toLocaleString(lang(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const duckHunt = defineGame<DuckState, DuckMove, DuckView>({
  id: 'duck-hunt',
  name: t.name,
  type: 'reaction',
  length: 'long',
  cognitive: { primary: 'speed', secondary: null },
  rules: t.rules,
  controls: () => t.controls,
  moveTimeoutMs: null,
  liveMoves: true,
  // Minuta střílení + odpočet + rezerva – do té doby soupeř smí mlčet (nic netrefil).
  untimedLimitMs: COUNTDOWN_MS + DURATION_MS + 5000,
  revealMs: 2500,
  logic: duckLogic,
  moveSchema: duckMoveSchema,
  viewSchema: duckViewSchema,
  getAIMove: duckAIMove,
  aiDelayMs: duckAIDelay,
  inactiveMove: () => ({ kind: 'done' }),
  summarize: (view, names) => {
    const { A, B } = view.score;
    const text = `${names.A}: ${t.ducks(A.hits)} · ${names.B}: ${t.ducks(B.hits)}`;
    // Při shodě rozhodla rychlost – ať je vidět proč.
    return A.hits === B.hits && A.hits > 0
      ? `${text} · ${t.reactions(seconds(A.reaction), seconds(B.reaction))}`
      : text;
  },
  createView: createDuckView,
});
