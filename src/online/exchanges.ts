import type { PlayerSlot } from '../core/types';
import {
  combineSeeds,
  commit,
  randomHex,
  verifyCommit,
  type Commitment,
} from '../core/util/commitReveal';

export class CheatError extends Error {
  override name = 'CheatError';
}

export type SeedMessage =
  | { readonly kind: 'commit'; readonly hash: string }
  | { readonly kind: 'reveal'; readonly seed: string; readonly salt: string };

/**
 * Společný seed zápasu: každý pošle SHA-256(sůl ‖ seed), teprve po přijetí závazku soupeře
 * odhalí. Výsledek = SHA-256(seedA ‖ seedB) – nemůže ho ovlivnit ani hostitel.
 */
export class SeedExchange {
  readonly result: Promise<string>;
  private resolve: (seed: string) => void = () => undefined;
  private reject: (error: Error) => void = () => undefined;
  private own: Commitment<string> | null = null;
  private theirHash: string | null = null;
  private theirSeed: string | null = null;
  private revealed = false;
  private settled = false;

  constructor(
    private readonly me: PlayerSlot,
    private readonly send: (message: SeedMessage) => void,
  ) {
    this.result = new Promise<string>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  async start(): Promise<void> {
    this.own = await commit(randomHex(16));
    this.send({ kind: 'commit', hash: this.own.hash });
    this.maybeReveal();
  }

  receiveCommit(hash: string): void {
    if (this.theirHash !== null) return;
    this.theirHash = hash;
    this.maybeReveal();
  }

  async receiveReveal(seed: string, salt: string): Promise<void> {
    if (this.theirHash === null || this.theirSeed !== null) {
      this.fail('Soupeř odhalil seed bez předchozího závazku.');
      return;
    }
    if (!(await verifyCommit(this.theirHash, seed, salt))) {
      this.fail('Seed soupeře neodpovídá jeho závazku.');
      return;
    }
    this.theirSeed = seed;
    await this.finish();
  }

  private maybeReveal(): void {
    if (!this.own || this.theirHash === null || this.revealed) return;
    this.revealed = true;
    this.send({ kind: 'reveal', seed: this.own.value, salt: this.own.salt });
    void this.finish();
  }

  private async finish(): Promise<void> {
    if (!this.own || !this.revealed || this.theirSeed === null || this.settled) return;
    this.settled = true;
    const [a, b] =
      this.me === 'A' ? [this.own.value, this.theirSeed] : [this.theirSeed, this.own.value];
    this.resolve(await combineSeeds(a, b));
  }

  private fail(detail: string): void {
    if (this.settled) return;
    this.settled = true;
    this.reject(new CheatError(detail));
  }
}

export type SealedMessage =
  | {
      readonly kind: 'commit';
      readonly player: PlayerSlot;
      readonly hash: string;
      readonly auto: boolean;
    }
  | {
      readonly kind: 'reveal';
      readonly player: PlayerSlot;
      readonly move: unknown;
      readonly salt: string;
    };

/**
 * Zapečetěný současný tah (např. KNP): nejdřív závazek, odhalení až ve chvíli,
 * kdy mají závazek oba – nikdo nemůže změnit volbu podle volby soupeře.
 */
export class SealedExchange {
  private own: Commitment<unknown> | null = null;
  private sealing = false;
  private theirHash: string | null = null;
  private revealedOwn = false;
  private verifiedMove: { move: unknown } | null = null;

  constructor(
    private readonly me: PlayerSlot,
    private readonly send: (message: SealedMessage) => void,
  ) {}

  get hasSealed(): boolean {
    return this.sealing;
  }

  get ownMove(): unknown {
    return this.own?.value;
  }

  get opponentCommitted(): boolean {
    return this.theirHash !== null;
  }

  /** Ověřený tah soupeře (po odhalení), jinak null. */
  get opponentMove(): { move: unknown } | null {
    return this.verifiedMove;
  }

  async seal(move: unknown, auto: boolean): Promise<void> {
    if (this.sealing) return;
    this.sealing = true;
    this.own = await commit(move);
    this.send({ kind: 'commit', player: this.me, hash: this.own.hash, auto });
    this.maybeReveal();
  }

  receiveCommit(hash: string): boolean {
    if (this.theirHash !== null) return false;
    this.theirHash = hash;
    this.maybeReveal();
    return true;
  }

  async receiveReveal(move: unknown, salt: string): Promise<boolean> {
    if (this.theirHash === null || this.verifiedMove !== null) return false;
    const ok = await verifyCommit(this.theirHash, move, salt);
    if (ok) this.verifiedMove = { move };
    return ok;
  }

  private maybeReveal(): void {
    if (!this.own || this.theirHash === null || this.revealedOwn) return;
    this.revealedOwn = true;
    this.send({ kind: 'reveal', player: this.me, move: this.own.value, salt: this.own.salt });
  }
}
