import type { GameInfo } from '../MiniGame';
import type { GameId, GameLength } from '../types';
import type { Rng } from '../util/rng';

export const CUSTOM_BEST_OF = [1, 3, 5, 7, 9] as const;
export type BestOf = (typeof CUSTOM_BEST_OF)[number];

export type MatchFormat =
  | { readonly kind: 'rychlovka' }
  | { readonly kind: 'velky-souboj' }
  | {
      readonly kind: 'vlastni';
      readonly bestOf: BestOf;
      readonly picks: readonly GameId[] | 'random';
    };

export type FormatKind = MatchFormat['kind'];

export interface MatchSlot {
  readonly gameId: GameId;
  /** Hostitel hru vybral sám – je známá předem. Jinak se před startem ukazuje „?“. */
  readonly picked: boolean;
}

export interface MatchPlan {
  readonly format: MatchFormat;
  readonly bestOf: number;
  readonly winsNeeded: number;
  readonly slots: readonly MatchSlot[];
}

export const PRESETS = {
  rychlovka: { bestOf: 5, length: 'quick' },
  'velky-souboj': { bestOf: 3, length: 'long' },
} as const satisfies Record<string, { bestOf: number; length: GameLength }>;

export class MatchFormatError extends Error {
  override name = 'MatchFormatError';
}

export function isFormatAvailable(kind: FormatKind, games: readonly GameInfo[]): boolean {
  if (kind === 'vlastni') return games.length > 0;
  return games.some((g) => g.length === PRESETS[kind].length);
}

/**
 * Losuje hry bez opakování. Opakovat se začne, až když nabídka dojde
 * (pak nový zamíchaný cyklus a nikdy dvakrát stejná hra za sebou, pokud to jde).
 */
export function drawSequence(
  pool: readonly GameId[],
  count: number,
  rng: Rng,
  alreadyUsed: readonly GameId[] = [],
): GameId[] {
  if (count <= 0) return [];
  if (pool.length === 0) throw new MatchFormatError('Není z čeho losovat – žádné hry.');
  const out: GameId[] = [];
  let bag = rng.shuffle(pool.filter((id) => !alreadyUsed.includes(id)));
  while (out.length < count) {
    if (bag.length === 0) {
      bag = rng.shuffle(pool);
      const previous = out.at(-1) ?? alreadyUsed.at(-1);
      if (bag.length > 1 && bag[0] === previous) bag.push(bag.shift() as GameId);
    }
    out.push(bag.shift() as GameId);
  }
  return out;
}

function makePlan(format: MatchFormat, bestOf: number, slots: MatchSlot[]): MatchPlan {
  return { format, bestOf, winsNeeded: (bestOf + 1) / 2, slots };
}

const randomSlot = (gameId: GameId): MatchSlot => ({ gameId, picked: false });

export function planMatch(format: MatchFormat, games: readonly GameInfo[], rng: Rng): MatchPlan {
  const allIds = games.map((g) => g.id);

  if (format.kind !== 'vlastni') {
    const preset = PRESETS[format.kind];
    const pool = games.filter((g) => g.length === preset.length).map((g) => g.id);
    if (pool.length === 0) {
      throw new MatchFormatError('Pro tento formát zatím nejsou k dispozici žádné hry.');
    }
    return makePlan(format, preset.bestOf, drawSequence(pool, preset.bestOf, rng).map(randomSlot));
  }

  const { bestOf, picks } = format;
  if (!CUSTOM_BEST_OF.includes(bestOf)) {
    throw new MatchFormatError(`Počet her musí být jedno z: ${CUSTOM_BEST_OF.join(', ')}.`);
  }
  if (allIds.length === 0) throw new MatchFormatError('Nejsou k dispozici žádné hry.');

  if (picks === 'random') {
    return makePlan(format, bestOf, drawSequence(allIds, bestOf, rng).map(randomSlot));
  }

  if (picks.length > bestOf) {
    throw new MatchFormatError(`Vybráno ${picks.length} her, ale zápas má jen ${bestOf}.`);
  }
  if (new Set(picks).size !== picks.length) {
    throw new MatchFormatError('Každou hru lze vybrat jen jednou.');
  }
  const unknown = picks.find((id) => !allIds.includes(id));
  if (unknown !== undefined) throw new MatchFormatError(`Neznámá hra: ${unknown}`);

  const fill = drawSequence(allIds, bestOf - picks.length, rng, picks);
  return makePlan(format, bestOf, [
    ...picks.map((gameId) => ({ gameId, picked: true })),
    ...fill.map(randomSlot),
  ]);
}
