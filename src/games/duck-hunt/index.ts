import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
import { plural } from '../../ui/labels';
import { duckAIDelay, duckAIMove } from './ai';
import {
  COUNTDOWN_MS,
  duckLogic,
  duckMoveSchema,
  duckOwners,
  duckViewSchema,
  DURATION_MS,
  goldenIndex,
  type DuckMove,
  type DuckScore,
  type DuckState,
  type DuckView,
} from './logic';
import { createDuckView } from './view';

const t = translations(
  {
    name: 'Kachní hon',
    rules: [
      'Po odpočtu 3 – 2 – 1 létají minutu kachny – ze všech stran, najednou nejvýš 3, postupně rychlejší.',
      'Kachnu získá, kdo ji trefí první (+1 bod) – ostatní uvidí, jak padá v jeho barvě.',
      'Bílou holubici nestřílej – každý zásah holubice je −1 bod.',
      'Vyhrává víc bodů. Když je po minutě nerozhodně, vyletí zlatá kachna – kdo ji trefí první, vyhrává.',
      'Po minutí se puška chvíli nabíjí, střílení naslepo se nevyplatí.',
    ],
    controls: [
      'Klikni nebo klepni na kachnu.',
      'Bez myši: šipky posouvají zaměřovač, mezerník nebo Enter střílí.',
    ],
    score: (s: DuckScore) =>
      `${s.points} ${plural(Math.abs(s.points), 'bod', 'body', 'bodů')}${s.doves > 0 ? ` (holubice −${s.doves})` : ''}`,
    golden: 'rozhodla zlatá kachna',
  },
  {
    name: 'Duck Hunt',
    rules: [
      'After the 3 – 2 – 1 countdown, ducks fly for a minute – from every side, at most 3 at once, faster and faster.',
      'A duck goes to whoever hits it first (+1 point) – everyone sees it fall in that player’s colour.',
      'Do not shoot the white dove – every dove hit is −1 point.',
      'More points wins. If it is a tie after the minute, a golden duck flies out – whoever hits it first wins.',
      'After a miss the gun reloads for a moment, so shooting blindly does not pay.',
    ],
    controls: [
      'Click or tap a duck.',
      'Without a mouse: arrows move the crosshair, Space or Enter shoots.',
    ],
    score: (s: DuckScore) =>
      `${s.points} ${Math.abs(s.points) === 1 ? 'point' : 'points'}${s.doves > 0 ? ` (doves −${s.doves})` : ''}`,
    golden: 'the golden duck decided',
  },
);

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
  // Minuta + rozstřel (zlatá kachna ~7 s) + odpočet a rezerva – do té doby soupeř smí mlčet.
  untimedLimitMs: COUNTDOWN_MS + DURATION_MS + 15_000,
  revealMs: 2500,
  logic: duckLogic,
  moveSchema: duckMoveSchema,
  viewSchema: duckViewSchema,
  getAIMove: duckAIMove,
  aiDelayMs: duckAIDelay,
  inactiveMove: () => ({ kind: 'done' }),
  summarize: (view, names) => {
    const { A, B } = view.score;
    const text = `${names.A}: ${t.score(A)} · ${names.B}: ${t.score(B)}`;
    const golden = duckOwners(view.ducks, view.shots)[goldenIndex(view.ducks)] ?? null;
    return A.points === B.points && golden ? `${text} · ${t.golden}` : text;
  },
  createView: createDuckView,
});
