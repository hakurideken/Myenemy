import type { AIContext } from '../../core/MiniGame';
import type { Difficulty } from '../../core/types';
import { CARDS, pairOf, seenCard, type PexesoMove, type PexesoView } from './logic';

/** Jak spolehlivě si AI zapamatuje otočenou kartu. */
const RECALL: Record<Difficulty, number> = { easy: 0.35, medium: 0.7, hard: 1 };

interface Memory {
  /** Kolik karet už bylo vidět – když je jich míň, začala nová hra. */
  seenCount: number;
  readonly decided: Set<number>;
  readonly remembered: Map<number, number>;
}

function memoryFor(view: PexesoView, ai: AIContext): Memory {
  const key = `pexeso:${ai.me}`;
  const memory = ai.memory.get<Memory>(key, () => ({
    seenCount: 0,
    decided: new Set(),
    remembered: new Map(),
  }));
  if (view.seen.length < memory.seenCount) {
    memory.decided.clear();
    memory.remembered.clear();
  }
  memory.seenCount = view.seen.length;
  // Každou nově viděnou kartu si buď zapamatuje, nebo ne (podle obtížnosti).
  for (const { pos, card } of view.seen) {
    if (memory.decided.has(pos)) continue;
    memory.decided.add(pos);
    if (ai.rng.chance(RECALL[ai.difficulty])) memory.remembered.set(pos, card);
  }
  return memory;
}

export function pexesoAIMove(view: PexesoView, ai: AIContext): PexesoMove {
  const memory = memoryFor(view, ai);
  const open = Array.from({ length: CARDS }, (_, p) => p).filter(
    (p) => view.taken[p] === null && !view.flipped.includes(p),
  );
  const unseen = open.filter((p) => seenCard(view, p) === undefined);
  const known = (p: number): number | undefined => memory.remembered.get(p);
  const flip = (p: number | undefined): PexesoMove => ({
    kind: 'flip',
    pos: p ?? ai.rng.pick(unseen.length > 0 ? unseen : open),
  });

  // Lehká AI občas otočí úplně náhodně.
  if (ai.difficulty === 'easy' && ai.rng.chance(0.3)) return flip(ai.rng.pick(open));

  const first = view.flipped[0];
  if (first === undefined) {
    // Známá dvojice? Otoč první z ní.
    for (const p of open) {
      const card = known(p);
      if (card === undefined) continue;
      const partner = open.find(
        (q) => q !== p && known(q) !== undefined && pairOf(known(q) ?? -1) === pairOf(card),
      );
      if (partner !== undefined) return flip(p);
    }
    return flip(unseen.length > 0 ? ai.rng.pick(unseen) : undefined);
  }
  const firstCard = seenCard(view, first);
  if (firstCard !== undefined) {
    const partner = open.find(
      (q) => known(q) !== undefined && pairOf(known(q) ?? -1) === pairOf(firstCard),
    );
    if (partner !== undefined) return flip(partner);
  }
  return flip(undefined);
}
