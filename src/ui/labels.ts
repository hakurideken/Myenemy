import type { CurrentGame, EndReason } from '../core/match/MatchController';
import { MAX_DRAW_REPLAYS } from '../core/match/MatchController';
import type { FormatKind, MatchFormat } from '../core/match/planMatch';
import type { Difficulty, GameLength, GameMode, GameType } from '../core/types';
import { translations } from '../i18n';

interface Labels {
  difficulty: Record<Difficulty, string>;
  difficultyHint: Record<Difficulty, string>;
  type: Record<GameType, string>;
  length: Record<GameLength, string>;
  mode: Record<GameMode, string>;
  format: Record<FormatKind, { name: string; description: string }>;
  endReason: Record<Exclude<EndReason, 'score'>, (iWon: boolean, detail: string | null) => string>;
  progress: (gameNo: number, maxGames: number) => string;
  replay: (replay: number, max: number) => string;
}

const t = translations<Labels>(
  {
    difficulty: { easy: 'Lehká', medium: 'Střední', hard: 'Těžká' },
    difficultyHint: {
      easy: 'Pomalejší reakce, hraje spíš náhodně',
      medium: 'Solidní soupeř, občas chybuje',
      hard: 'Rychlý a vychytralý',
    },
    type: {
      reaction: 'Reakční',
      turn: 'Tahová',
      hidden: 'Skrytá informace',
      card: 'Karetní',
    },
    length: { quick: 'Rychlá (do 1 min)', long: 'Delší (2–5 min)' },
    mode: {
      pve: 'Proti AI',
      local: 'Dva hráči na jednom zařízení',
      online: 'Online souboj',
    },
    format: {
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
    },
    endReason: {
      disconnect: (iWon) =>
        iWon ? 'Soupeř se odpojil – výhra kontumací.' : 'Spojení se přerušilo – prohra kontumací.',
      left: (iWon) => (iWon ? 'Soupeř opustil zápas – výhra kontumací.' : 'Zápas jsi opustil.'),
      afk: (iWon) =>
        iWon
          ? 'Soupeř třikrát po sobě nereagoval – výhra kontumací.'
          : 'Třikrát po sobě jsi nereagoval – prohra kontumací.',
      cheat: (iWon, detail) =>
        iWon
          ? `Soupeř poslal data, která nesedí s jeho závazkem${detail ? `: ${detail}` : '.'} Výhra kontumací.`
          : 'Soupeř nahlásil nesoulad v datech zápasu – prohra kontumací.',
    },
    progress: (gameNo, maxGames) => `Hra ${gameNo} z max. ${maxGames}`,
    replay: (replay, max) => `rozhodující kolo ${replay}/${max}`,
  },
  {
    difficulty: { easy: 'Easy', medium: 'Medium', hard: 'Hard' },
    difficultyHint: {
      easy: 'Slower reactions, plays mostly at random',
      medium: 'A solid opponent who sometimes slips',
      hard: 'Fast and cunning',
    },
    type: { reaction: 'Reaction', turn: 'Turn-based', hidden: 'Hidden info', card: 'Cards' },
    length: { quick: 'Quick (under 1 min)', long: 'Longer (2–5 min)' },
    mode: { pve: 'Vs. AI', local: 'Two players, one device', online: 'Online duel' },
    format: {
      rychlovka: {
        name: 'Quickfire',
        description: 'Best of 5 quick games – first to win 3 takes the match.',
      },
      'velky-souboj': {
        name: 'Grand duel',
        description: 'Best of 3 longer games – first to win 2 takes the match.',
      },
      vlastni: {
        name: 'Custom',
        description: 'Pick the number of games and which ones, or go fully random.',
      },
    },
    endReason: {
      disconnect: (iWon) =>
        iWon
          ? 'Your opponent disconnected – you win by forfeit.'
          : 'Connection lost – you lose by forfeit.',
      left: (iWon) =>
        iWon ? 'Your opponent left the match – you win by forfeit.' : 'You left the match.',
      afk: (iWon) =>
        iWon
          ? 'Your opponent did not react three times in a row – you win by forfeit.'
          : 'You did not react three times in a row – you lose by forfeit.',
      cheat: (iWon, detail) =>
        iWon
          ? `Your opponent sent data that does not match their commitment${detail ? `: ${detail}` : '.'} You win by forfeit.`
          : 'Your opponent reported a data mismatch – you lose by forfeit.',
    },
    progress: (gameNo, maxGames) => `Game ${gameNo} of max. ${maxGames}`,
    replay: (replay, max) => `deciding round ${replay}/${max}`,
  },
);

export const DIFFICULTY_LABEL: Record<Difficulty, string> = t.difficulty;
export const DIFFICULTY_HINT: Record<Difficulty, string> = t.difficultyHint;
export const TYPE_LABEL: Record<GameType, string> = t.type;
export const LENGTH_LABEL: Record<GameLength, string> = t.length;
export const MODE_LABEL: Record<GameMode, string> = t.mode;
export const FORMAT_INFO: Record<FormatKind, { name: string; description: string }> = t.format;

export function formatTitle(format: MatchFormat): string {
  const name = FORMAT_INFO[format.kind].name;
  return format.kind === 'vlastni' ? `${name} · best of ${format.bestOf}` : name;
}

/** Česká plurálová forma: 1 výhra, 2–4 výhry, 5+ výher. */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  return n >= 2 && n <= 4 ? few : many;
}

/** Proč zápas skončil – z pohledu vítěze a poraženého. */
export function endReasonText(
  reason: EndReason,
  iWon: boolean,
  detail: string | null,
): string | null {
  return reason === 'score' ? null : t.endReason[reason](iWon, detail);
}

export function gameProgress(current: CurrentGame): string {
  const base = t.progress(current.gameNo, current.maxGames);
  return current.replay > 0 ? `${base} · ${t.replay(current.replay, MAX_DRAW_REPLAYS)}` : base;
}
