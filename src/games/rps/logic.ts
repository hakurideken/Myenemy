import { z } from 'zod';
import type { GameLogic } from '../../core/MiniGame';
import {
  DRAW,
  otherPlayer,
  win,
  type Outcome,
  type PerPlayer,
  type PlayerSlot,
} from '../../core/types';
import { translations } from '../../i18n';

const t = translations(
  {
    choice: { rock: 'Kámen', scissors: 'Nůžky', paper: 'Papír' },
    verdict: {
      rock: 'kámen tupí nůžky',
      scissors: 'nůžky stříhají papír',
      paper: 'papír balí kámen',
    },
    bothChose: (choice: string) => `Oba zvolili ${choice}`,
  },
  {
    choice: { rock: 'Rock', scissors: 'Scissors', paper: 'Paper' },
    verdict: {
      rock: 'rock crushes scissors',
      scissors: 'scissors cut paper',
      paper: 'paper covers rock',
    },
    bothChose: (choice: string) => `Both chose ${choice}`,
  },
);

export const RPS_CHOICES = ['rock', 'scissors', 'paper'] as const;
export type RpsChoice = (typeof RPS_CHOICES)[number];

/** Co daná volba poráží. */
export const BEATS: Record<RpsChoice, RpsChoice> = {
  rock: 'scissors',
  scissors: 'paper',
  paper: 'rock',
};

/** Čím danou volbu porazit. */
export const COUNTER: Record<RpsChoice, RpsChoice> = {
  rock: 'paper',
  scissors: 'rock',
  paper: 'scissors',
};

export const CHOICE_LABEL: Record<RpsChoice, string> = t.choice;

const VERDICT: Record<RpsChoice, string> = t.verdict;

export interface RpsMove {
  readonly choice: RpsChoice;
}

export interface RpsState {
  readonly order: readonly PlayerSlot[];
  readonly choices: Partial<Record<PlayerSlot, RpsChoice>>;
}

export interface RpsView {
  readonly viewer: PlayerSlot;
  readonly mine: RpsChoice | null;
  /** Soupeř už zvolil – jeho volba se ale neukazuje, dokud nezvolí oba. */
  readonly opponentReady: boolean;
  readonly revealed: PerPlayer<RpsChoice> | null;
}

export const rpsMoveSchema = z.object({ choice: z.enum(RPS_CHOICES) });

const choiceSchema = z.enum(RPS_CHOICES);
export const rpsViewSchema = z.object({
  viewer: z.enum(['A', 'B']),
  mine: choiceSchema.nullable(),
  opponentReady: z.boolean(),
  revealed: z.object({ A: choiceSchema, B: choiceSchema }).nullable(),
});

/** Remíza = stejná volba. */
export function judgeRps(a: RpsChoice, b: RpsChoice): Outcome {
  if (a === b) return DRAW;
  return win(BEATS[a] === b ? 'A' : 'B');
}

export const rpsLogic: GameLogic<RpsState, RpsMove, RpsView> = {
  setup: ({ starter }) => ({ order: [starter, otherPlayer(starter)], choices: {} }),
  toMove: (state) => state.order.filter((p) => state.choices[p] === undefined),
  legal: (state, player) => state.choices[player] === undefined,
  apply: (state, player, move) => {
    const choices = { ...state.choices };
    choices[player] = move.choice;
    return { ...state, choices };
  },
  outcome: (state) => {
    const { A, B } = state.choices;
    return A && B ? judgeRps(A, B) : null;
  },
  view: (state, viewer) => {
    const { A, B } = state.choices;
    return {
      viewer,
      mine: state.choices[viewer] ?? null,
      opponentReady: state.choices[otherPlayer(viewer)] !== undefined,
      revealed: A && B ? { A, B } : null,
    };
  },
};

export function describeRps(revealed: PerPlayer<RpsChoice>): string {
  const outcome = judgeRps(revealed.A, revealed.B);
  if (outcome.kind === 'draw') return t.bothChose(CHOICE_LABEL[revealed.A].toLowerCase());
  const verdict = VERDICT[revealed[outcome.winner]];
  return verdict.charAt(0).toUpperCase() + verdict.slice(1);
}
