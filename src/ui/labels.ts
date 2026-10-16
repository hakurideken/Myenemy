import type { CurrentGame } from '../core/match/MatchController';
import { MAX_DRAW_REPLAYS } from '../core/match/MatchController';
import type { FormatKind, MatchFormat } from '../core/match/planMatch';
import type { Difficulty, GameLength, GameMode, GameType } from '../core/types';

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Lehká',
  medium: 'Střední',
  hard: 'Těžká',
};

export const DIFFICULTY_HINT: Record<Difficulty, string> = {
  easy: 'Pomalejší reakce, hraje spíš náhodně',
  medium: 'Solidní soupeř, občas chybuje',
  hard: 'Rychlý a vychytralý',
};

export const TYPE_LABEL: Record<GameType, string> = {
  reaction: 'Reakční',
  turn: 'Tahová',
  hidden: 'Skrytá informace',
  card: 'Karetní',
};

export const LENGTH_LABEL: Record<GameLength, string> = {
  quick: 'Rychlá (do 1 min)',
  long: 'Delší (2–5 min)',
};

export const MODE_LABEL: Record<GameMode, string> = {
  pve: 'Proti AI',
  local: 'Dva hráči na jednom zařízení',
  online: 'Online souboj',
};

export const FORMAT_INFO: Record<FormatKind, { name: string; description: string }> = {
  rychlovka: {
    name: 'Rychlovka',
    description: 'Best of 5 z rychlých her – vyhrává, kdo první vyhraje 3.',
  },
  'velky-souboj': {
    name: 'Velký souboj',
    description: 'Best of 3 z delších her – vyhrává, kdo první vyhraje 2.',
  },
  vlastni: {
    name: 'Vlastní výběr',
    description: 'Zvolíš počet her a konkrétní hry, nebo náhodně ze všech.',
  },
};

export function formatTitle(format: MatchFormat): string {
  const name = FORMAT_INFO[format.kind].name;
  return format.kind === 'vlastni' ? `${name} · best of ${format.bestOf}` : name;
}

/** Česká plurálová forma: 1 výhra, 2–4 výhry, 5+ výher. */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  return n >= 2 && n <= 4 ? few : many;
}

export function gameProgress(current: CurrentGame): string {
  const base = `Hra ${current.gameNo} z max. ${current.maxGames}`;
  return current.replay > 0
    ? `${base} · rozhodující kolo ${current.replay}/${MAX_DRAW_REPLAYS}`
    : base;
}
