import {
  otherPlayer,
  win,
  type GameId,
  type Outcome,
  type PerPlayer,
  type PlayerSlot,
} from '../types';
import type { Rng } from '../util/rng';
import type { MatchPlan } from './planMatch';

/** Po kolika remízách v řadě rozhodne los (platí pro všechny hry). */
export const MAX_DRAW_REPLAYS = 3;

export type ForfeitReason = 'disconnect' | 'cheat' | 'afk';
export type EndReason = 'score' | ForfeitReason;

export interface CurrentGame {
  readonly gameId: GameId;
  /** 1-based pořadí hry; remízová opakování ho nezvyšují. */
  readonly gameNo: number;
  readonly maxGames: number;
  /** 0 = první pokus, 1–3 = rozhodující kola po remíze. */
  readonly replay: number;
  readonly starter: PlayerSlot;
}

export interface RoundRecord {
  readonly gameNo: number;
  readonly gameId: GameId;
  readonly replay: number;
  readonly outcome: Outcome;
  readonly byCoin: boolean;
}

export type ReportResult =
  | { readonly kind: 'replay'; readonly replay: number }
  | {
      readonly kind: 'decided';
      readonly winner: PlayerSlot;
      readonly byCoin: boolean;
      readonly matchWinner: PlayerSlot | null;
    };

/** Řízení zápasu: skóre, pořadí her, remízy a los. Nezná konkrétní hry, DOM ani síť. */
export class MatchController {
  private gameIndex = 0;
  private replay = 0;
  /** Počet odehraných kol včetně remízových – podle něj se střídá začínající hráč. */
  private roundsPlayed = 0;
  private readonly starterOffset: number;
  private readonly scores: PerPlayer<number> = { A: 0, B: 0 };
  private readonly records: RoundRecord[] = [];
  private winnerSlot: PlayerSlot | null = null;
  private reason: EndReason | null = null;

  constructor(
    readonly plan: MatchPlan,
    private readonly rng: Rng,
    private readonly maxReplays = MAX_DRAW_REPLAYS,
  ) {
    this.starterOffset = rng.int(2);
  }

  get score(): Readonly<PerPlayer<number>> {
    return { ...this.scores };
  }

  get history(): readonly RoundRecord[] {
    return [...this.records];
  }

  get winner(): PlayerSlot | null {
    return this.winnerSlot;
  }

  get endReason(): EndReason | null {
    return this.reason;
  }

  get isOver(): boolean {
    return this.winnerSlot !== null;
  }

  /** Index (0-based) posledního rozehraného slotu – sloty do něj včetně jsou už odhalené. */
  get lastStartedIndex(): number {
    return this.gameIndex;
  }

  current(): CurrentGame {
    if (this.isOver) throw new Error('Zápas už skončil.');
    const slot = this.plan.slots[this.gameIndex];
    if (!slot) throw new Error('Mimo plán zápasu.');
    return {
      gameId: slot.gameId,
      gameNo: this.gameIndex + 1,
      maxGames: this.plan.bestOf,
      replay: this.replay,
      starter: (this.roundsPlayed + this.starterOffset) % 2 === 0 ? 'A' : 'B',
    };
  }

  report(outcome: Outcome): ReportResult {
    const cur = this.current();
    this.roundsPlayed++;
    this.records.push({
      gameNo: cur.gameNo,
      gameId: cur.gameId,
      replay: cur.replay,
      outcome,
      byCoin: false,
    });

    if (outcome.kind === 'win') return this.decide(cur, outcome.winner, false);

    if (this.replay < this.maxReplays) {
      this.replay++;
      return { kind: 'replay', replay: this.replay };
    }
    const winner: PlayerSlot = this.rng.chance(0.5) ? 'A' : 'B';
    this.records.push({
      gameNo: cur.gameNo,
      gameId: cur.gameId,
      replay: cur.replay,
      outcome: win(winner),
      byCoin: true,
    });
    return this.decide(cur, winner, true);
  }

  forfeit(loser: PlayerSlot, reason: ForfeitReason): void {
    if (this.isOver) return;
    this.winnerSlot = otherPlayer(loser);
    this.reason = reason;
  }

  private decide(cur: CurrentGame, winner: PlayerSlot, byCoin: boolean): ReportResult {
    this.scores[winner]++;
    if (this.scores[winner] >= this.plan.winsNeeded) {
      this.winnerSlot = winner;
      this.reason = 'score';
    } else if (cur.gameNo < this.plan.bestOf) {
      this.gameIndex++;
      this.replay = 0;
    }
    return { kind: 'decided', winner, byCoin, matchWinner: this.winnerSlot };
  }
}
