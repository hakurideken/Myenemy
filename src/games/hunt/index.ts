import { defineGame } from '../../core/MiniGame';
import { translations } from '../../i18n';
import { huntAIMove } from './ai';
import {
  huntFog,
  huntLogic,
  huntMoveSchema,
  huntViewSchema,
  ROUNDS,
  type HuntMove,
  type HuntState,
  type HuntView,
} from './logic';
import { createHuntView } from './view';

export const MOVE_TIMEOUT_MS = 30_000;

const t = translations(
  {
    name: 'Hon v mlze',
    rules: [
      'Jeden je lovec, druhý liška. Hraje se na dva poločasy na stejné mapě – každý si jednou zahraje za obě role.',
      'Les 9 × 9: stromy nejdou projít ani přes ně vidět, kdo stojí v keři, je vidět jen ze sousedního pole. Polohu soupeře nikdo nezná – každý vidí jen své okolí.',
      'Lovec ujde až 2 pole rovně a vidí do vzdálenosti 2. Liška ujde 1 pole i šikmo (nebo zůstane) a vidí do vzdálenosti 3. Začíná liška.',
      'Liška za sebou nechává stopy z posledních 2 tahů – lovec je uvidí, když na ně dohlédne.',
      `Lovec lišku chytí, když vstoupí na její pole (i když jím jen prochází). Na chycení má ${ROUNDS} kol.`,
      'Vyhrává, kdo jako lovec chytil lišku v nižším kole. Stejně rychle nebo vůbec = remíza. Na tah máš 30 s.',
      'Online polohu soupeře nezná ani jeho zařízení: kdo koho vidí, se zjistí šifrovaně a po každém poločase se ověří celé trasy.',
    ],
    keys: 'Klikni na zvýrazněné pole, kam chceš jít (na své pole = zůstat), nebo šipky a Enter.',
    caught: (name: string, round: number) => `Lovec ${name}: chycena v ${round}. kole`,
    escaped: (name: string) => `Lovec ${name}: liška unikla`,
  },
  {
    name: 'Fog Hunt',
    rules: [
      'One player is the hunter, the other the fox. The game has two halves on the same map – each player plays both roles once.',
      'A 9 × 9 forest: trees block movement and sight, and anyone standing in a bush can only be seen from an adjacent cell. Nobody knows where the opponent is – each player only sees their surroundings.',
      'The hunter moves up to 2 cells straight and sees 2 cells far. The fox moves 1 cell, diagonally too (or stays), and sees 3 cells far. The fox goes first.',
      'The fox leaves tracks from its last 2 moves – the hunter sees them when they are in sight.',
      `The hunter catches the fox by stepping onto its cell (even just passing through). The hunter has ${ROUNDS} rounds.`,
      'Whoever catches the fox in an earlier round as the hunter wins. Equally fast or not at all = draw. You have 30 s per move.',
      "Online, not even the opponent's device knows their position: who sees whom is worked out with encryption, and both routes are checked after each half.",
    ],
    keys: 'Click a highlighted cell to move there (your own cell = stay), or use the arrow keys and Enter.',
    caught: (name: string, round: number) => `Hunter ${name}: caught in round ${round}`,
    escaped: (name: string) => `Hunter ${name}: the fox escaped`,
  },
);

export const hunt = defineGame<HuntState, HuntMove, HuntView>({
  id: 'hunt',
  name: t.name,
  type: 'hidden',
  length: 'long',
  cognitive: { primary: 'strategy', secondary: 'chance' },
  rules: t.rules,
  controls: () => [t.keys],
  moveTimeoutMs: MOVE_TIMEOUT_MS,
  revealMs: 3500,
  fog: huntFog,
  logic: huntLogic,
  moveSchema: huntMoveSchema,
  viewSchema: huntViewSchema,
  getAIMove: huntAIMove,
  summarize: (view, names) =>
    view.halves
      .map((half) =>
        half.caught === null
          ? t.escaped(names[half.hunter])
          : t.caught(names[half.hunter], half.caught),
      )
      .join(' · '),
  createView: createHuntView,
});
