import type { FogKeeper, FogKnowledge, FogRules, Sighting } from '../MiniGame';
import { otherPlayer, PLAYER_SLOTS, type PerPlayer, type PlayerSlot } from '../types';

/** Průnik štítků: co z toho, kam pozorovatel dohlédne, soupeř prozrazuje. */
export function intersect(queries: readonly string[], exposed: readonly string[]): string[] {
  const shown = new Set(exposed);
  return [...new Set(queries)].filter((label) => shown.has(label)).sort();
}

/**
 * Mlha pro PvE a hru na jednom zařízení: zná soukromé stavy obou hráčů (lidé i AI),
 * každému ale prozradí jen to, co sám viděl. Všechno se počítá hned.
 */
export class LocalFog implements FogKeeper {
  private privates: PerPlayer<unknown> | null = null;
  private staged: { readonly player: PlayerSlot; readonly next: unknown } | null = null;
  private segment = 0;
  private readonly sightings: PerPlayer<Sighting[]> = { A: [], B: [] };
  private readonly revealed: PerPlayer<Map<number, unknown>> = { A: new Map(), B: new Map() };

  constructor(private readonly rules: FogRules<unknown, unknown, unknown>) {}

  begin(viewOf: (player: PlayerSlot) => unknown): void {
    this.segment = this.rules.segment(viewOf('A'));
    this.privates = {
      A: this.rules.start(viewOf('A'), 'A'),
      B: this.rules.start(viewOf('B'), 'B'),
    };
    this.observe(0, null, viewOf);
  }

  stage(player: PlayerSlot, view: unknown, move: unknown): boolean {
    if (!this.privates) return false;
    const next = this.rules.advance(view, player, this.privates[player], move);
    if (next === null) return false;
    this.staged = { player, next };
    return true;
  }

  record(
    index: number,
    player: PlayerSlot,
    move: unknown,
    viewOf: (player: PlayerSlot) => unknown,
  ): void {
    const privates = this.privates;
    if (!privates) return;
    if (this.staged?.player === player) privates[player] = this.staged.next;
    this.staged = null;
    const segment = this.rules.segment(viewOf('A'));
    if (segment !== this.segment) {
      this.reveal();
      this.segment = segment;
      for (const p of PLAYER_SLOTS) privates[p] = this.rules.start(viewOf(p), p);
    }
    if (this.rules.observes(move)) this.observe(index, player, viewOf);
  }

  ready(): boolean {
    return true;
  }

  knowledge(player: PlayerSlot): FogKnowledge | null {
    if (!this.privates) return null;
    return {
      own: this.privates[player],
      sightings: this.sightings[player],
      revealed: this.revealed[player],
    };
  }

  finish(): void {
    this.reveal();
  }

  onChange(): () => void {
    return () => undefined;
  }

  /** Uzavřený úsek: každý se dozví, kudy chodil soupeř. */
  private reveal(): void {
    const privates = this.privates;
    if (!privates) return;
    for (const p of PLAYER_SLOTS) this.revealed[p].set(this.segment, privates[otherPlayer(p)]);
  }

  private observe(
    index: number,
    mover: PlayerSlot | null,
    viewOf: (player: PlayerSlot) => unknown,
  ): void {
    const privates = this.privates;
    if (!privates) return;
    for (const p of PLAYER_SLOTS) {
      const other = otherPlayer(p);
      const seen = intersect(
        this.rules.queries(viewOf(p), p, privates[p]),
        this.rules.exposed(viewOf(other), other, privates[other]),
      );
      this.sightings[p].push({ index, segment: this.segment, mover, own: privates[p], seen });
    }
  }
}
