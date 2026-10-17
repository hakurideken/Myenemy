import type { CardAt, CardDealer, KnownCards } from '../MiniGame';
import type { PerPlayer, PlayerSlot } from '../types';
import type { Rng } from '../util/rng';

/**
 * Rozdávající pro PvE a hru na jednom zařízení: zná celý balíček (zamíchaný z herní
 * náhody), hráčům ale prozradí jen karty, na které mají nárok.
 */
export class LocalDealer implements CardDealer {
  private readonly deck: readonly number[];
  private entitled: PerPlayer<ReadonlySet<number>> = { A: new Set(), B: new Set() };

  constructor(deckSize: number, rng: Rng) {
    this.deck = rng.shuffle(Array.from({ length: deckSize }, (_, id) => id));
  }

  ready(): Promise<void> {
    return Promise.resolve();
  }

  entitle(entitled: PerPlayer<readonly number[]>): void {
    this.entitled = { A: new Set(entitled.A), B: new Set(entitled.B) };
  }

  known(player: PlayerSlot): KnownCards {
    const out = new Map<number, number>();
    for (const pos of this.entitled[player]) {
      const card = this.deck[pos];
      if (card !== undefined) out.set(pos, card);
    }
    return out;
  }

  peek(positions: readonly number[]): CardAt[] | null {
    const out: CardAt[] = [];
    for (const pos of positions) {
      const card = this.deck[pos];
      if (card === undefined) return null;
      out.push({ pos, card });
    }
    return out;
  }

  check(claims: readonly CardAt[]): boolean {
    return claims.every((c) => this.deck[c.pos] === c.card);
  }

  onChange(): () => void {
    return () => undefined;
  }
}
