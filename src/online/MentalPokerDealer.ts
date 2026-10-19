import { translations } from '../i18n';
import {
  CardCodec,
  createPokerKeys,
  encryptAndShuffle,
  fromHex,
  lockPerCard,
  Q,
  toHex,
  unlockCard,
  validDeck,
  type PokerKeys,
} from '../core/cards/mentalPoker';
import type { CardAt, CardDealer, KnownCards } from '../core/MiniGame';
import { otherPlayer, type PerPlayer, type PlayerSlot } from '../core/types';
import { Listeners } from '../net/Transport';

const t = translations(
  {
    noKeys: 'Soupeř neposlal klíče k ověření balíčku.',
    outOfOrder: 'Soupeř poslal balíček mimo pořadí míchání.',
    badDeck: 'Soupeř poslal neplatný zašifrovaný balíček.',
    badKey: 'Soupeř poslal neplatný klíč ke kartě.',
    otherKey: 'Soupeř poslal ke stejné kartě jiný klíč.',
    auditIncomplete: 'Audit balíčku od soupeře je neúplný.',
    auditKeys: 'Klíče v auditu nesouhlasí s klíči ze hry.',
    auditCards: 'Balíček neobsahoval každou kartu právě jednou.',
    keyNoCard: 'Klíč od soupeře neodemyká platnou kartu.',
    shuffleFailed: 'Míchání balíčku selhalo.',
  },
  {
    noKeys: 'Your opponent did not send the keys to verify the deck.',
    outOfOrder: 'Your opponent sent the deck out of shuffling order.',
    badDeck: 'Your opponent sent an invalid encrypted deck.',
    badKey: 'Your opponent sent an invalid card key.',
    otherKey: 'Your opponent sent a different key for the same card.',
    auditIncomplete: 'Your opponent’s deck audit is incomplete.',
    auditKeys: 'The audit keys do not match the keys used in the game.',
    auditCards: 'The deck did not contain every card exactly once.',
    keyNoCard: 'Your opponent’s key does not unlock a valid card.',
    shuffleFailed: 'Shuffling the deck failed.',
  },
);

export type DeckStage = 1 | 2 | 3 | 4;

/** Zprávy mental pokeru (pole jsou mutabilní kvůli typům protokolu ze Zodu). */
export type PokerMessage =
  | { kind: 'deck'; stage: DeckStage; cards: string[] }
  | { kind: 'card-keys'; keys: { pos: number; key: string }[] }
  | { kind: 'deck-audit'; keys: string[] };

/** Výsledek závěrečného auditu balíčku: null = v pořádku, jinak popis problému. */
export type AuditResult = string | null;

/**
 * Online rozdávající přes mental poker (SRA) pro dva hráče:
 *  1. hostitel zašifruje karty svým klíčem a zamíchá,
 *  2. host zašifruje svým klíčem a zamíchá,
 *  3. hostitel sundá svou vrstvu a zamkne každou pozici zvláštním klíčem,
 *  4. host totéž – vznikne balíček, jehož pořadí nezná nikdo.
 * Kartu na pozici odemknou až klíče obou hráčů. Klíč ke své vrstvě pošle hráč soupeři jen
 * k pozicím, na které má soupeř nárok (jeho ruka, veřejné karty). Na konci si hráči pošlou
 * všechny klíče a ověří, že balíček obsahoval každou kartu právě jednou.
 */
export class MentalPokerDealer implements CardDealer {
  private readonly codec: CardCodec;
  private readonly keys: PokerKeys;
  private readonly opponent: PlayerSlot;
  /** Zamčený balíček po kroku 4. */
  private deck: readonly bigint[] | null = null;
  private expectedStage: DeckStage;
  private readonly theirKeys = new Map<number, bigint>();
  private readonly cards = new Map<number, number>();
  private readonly sent = new Set<number>();
  private entitled: PerPlayer<ReadonlySet<number>> = { A: new Set(), B: new Set() };
  private readonly changes = new Listeners<void>();
  private readonly readyPromise: Promise<void>;
  private resolveReady: () => void = () => undefined;
  private auditSent = false;
  private audit: AuditResult | undefined = undefined;
  private readonly auditWaiters: ((result: AuditResult) => void)[] = [];
  private failed = false;
  private busy: Promise<void> = Promise.resolve();

  constructor(
    private readonly me: PlayerSlot,
    readonly deckSize: number,
    private readonly send: (message: PokerMessage) => void,
    private readonly onCheat: (detail: string) => void,
  ) {
    this.codec = new CardCodec(deckSize);
    this.keys = createPokerKeys(deckSize);
    this.opponent = otherPlayer(me);
    this.expectedStage = me === 'A' ? 2 : 1;
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  /** Hostitel zahájí míchání (krok 1). */
  start(): void {
    if (this.me !== 'A') return;
    this.enqueue(async () => {
      const stage1 = await encryptAndShuffle(this.codec.encodedDeck(), this.keys.global);
      this.sendDeck(1, stage1);
    });
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  get isReady(): boolean {
    return this.deck !== null;
  }

  // ---------- CardDealer ----------

  entitle(entitled: PerPlayer<readonly number[]>): void {
    this.entitled = { A: new Set(entitled.A), B: new Set(entitled.B) };
    this.reveal(entitled[this.opponent]);
  }

  known(player: PlayerSlot): KnownCards {
    const out = new Map<number, number>();
    for (const pos of this.entitled[player]) {
      const card = this.cards.get(pos);
      if (card !== undefined) out.set(pos, card);
    }
    return out;
  }

  peek(positions: readonly number[]): CardAt[] | null {
    const out: CardAt[] = [];
    for (const pos of positions) {
      const card = this.cards.get(pos);
      if (card === undefined) return null;
      out.push({ pos, card });
    }
    return out;
  }

  check(claims: readonly CardAt[]): boolean {
    return claims.every((c) => this.cards.get(c.pos) === c.card);
  }

  onChange(cb: () => void): () => void {
    return this.changes.add(cb);
  }

  // ---------- Klíče ----------

  /** Pošle soupeři klíče své vrstvy k pozicím (každý jen jednou). */
  reveal(positions: Iterable<number>): void {
    if (!this.deck || this.failed) return;
    const keys: { pos: number; key: string }[] = [];
    for (const pos of positions) {
      const key = this.keys.perCard[pos];
      if (!key || this.sent.has(pos)) continue;
      this.sent.add(pos);
      keys.push({ pos, key: toHex(key.d) });
    }
    if (keys.length > 0) this.send({ kind: 'card-keys', keys });
  }

  /** Konec hry: všechny klíče pro audit balíčku. */
  sendAudit(): void {
    if (!this.deck || this.auditSent || this.failed) return;
    this.auditSent = true;
    this.send({ kind: 'deck-audit', keys: this.keys.perCard.map((k) => toHex(k.d)) });
  }

  /** Počká na audit soupeře; `schedule` po časovém limitu vrátí „chybí“. */
  waitAudit(schedule: (cb: () => void) => void): Promise<AuditResult> {
    if (this.audit !== undefined) return Promise.resolve(this.audit);
    return new Promise((resolve) => {
      this.auditWaiters.push(resolve);
      schedule(() => this.settleAudit(t.noKeys));
    });
  }

  // ---------- Zprávy od soupeře ----------

  receive(message: PokerMessage): void {
    if (this.failed) return;
    switch (message.kind) {
      case 'deck':
        this.receiveDeck(message.stage, message.cards);
        break;
      case 'card-keys':
        this.receiveKeys(message.keys);
        break;
      case 'deck-audit':
        this.enqueue(() => this.receiveAudit(message.keys));
        break;
    }
  }

  private receiveDeck(stage: DeckStage, cards: readonly string[]): void {
    if (stage !== this.expectedStage || this.deck) {
      this.cheat(t.outOfOrder);
      return;
    }
    const parsed = cards.map((c) => fromHex(c));
    if (!parsed.every((x): x is bigint => x !== null) || !validDeck(parsed, this.deckSize)) {
      this.cheat(t.badDeck);
      return;
    }
    this.expectedStage = (stage + 2) as DeckStage;
    this.enqueue(async () => {
      switch (stage) {
        case 1:
          this.sendDeck(2, await encryptAndShuffle(parsed, this.keys.global));
          break;
        case 2:
          this.sendDeck(3, await lockPerCard(parsed, this.keys));
          break;
        case 3: {
          const final = await lockPerCard(parsed, this.keys);
          this.sendDeck(4, final);
          this.finishShuffle(final);
          break;
        }
        case 4:
          this.finishShuffle(parsed);
          break;
      }
    });
  }

  private receiveKeys(keys: readonly { readonly pos: number; readonly key: string }[]): void {
    for (const { pos, key } of keys) {
      const value = fromHex(key, Q);
      if (!Number.isInteger(pos) || pos < 0 || pos >= this.deckSize || value === null) {
        this.cheat(t.badKey);
        return;
      }
      const known = this.theirKeys.get(pos);
      if (known !== undefined && known !== value) {
        this.cheat(t.otherKey);
        return;
      }
      this.theirKeys.set(pos, value);
    }
    if (this.unlockAll()) this.changes.emit();
  }

  private async receiveAudit(keys: readonly string[]): Promise<void> {
    if (keys.length !== this.deckSize || !this.deck) {
      this.settleAudit(t.auditIncomplete);
      return;
    }
    const seen = new Set<number>();
    for (const [pos, key] of keys.entries()) {
      const theirs = fromHex(key, Q);
      const earlier = this.theirKeys.get(pos);
      if (theirs === null || (earlier !== undefined && earlier !== theirs)) {
        this.settleAudit(t.auditKeys);
        return;
      }
      const card = this.unlock(pos, theirs);
      if (card === null || seen.has(card)) {
        this.settleAudit(t.auditCards);
        return;
      }
      seen.add(card);
      if (pos % 4 === 3) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    this.settleAudit(null);
  }

  // ---------- Vnitřní ----------

  private sendDeck(stage: DeckStage, deck: readonly bigint[]): void {
    if (!this.failed) this.send({ kind: 'deck', stage, cards: deck.map(toHex) });
  }

  private finishShuffle(deck: readonly bigint[]): void {
    this.deck = deck;
    this.unlockAll();
    this.resolveReady();
  }

  /** Odemkne pozice, ke kterým už máme klíč soupeře. true = přibyla karta. */
  private unlockAll(): boolean {
    if (!this.deck) return false;
    let changed = false;
    for (const [pos, theirs] of this.theirKeys) {
      if (this.cards.has(pos)) continue;
      const card = this.unlock(pos, theirs);
      if (card === null || [...this.cards.values()].includes(card)) {
        this.cheat(t.keyNoCard);
        return false;
      }
      this.cards.set(pos, card);
      changed = true;
    }
    return changed;
  }

  private unlock(pos: number, theirs: bigint): number | null {
    const locked = this.deck?.[pos];
    const mine = this.keys.perCard[pos];
    if (locked === undefined || !mine) return null;
    return this.codec.decode(unlockCard(locked, mine.d, theirs));
  }

  private settleAudit(result: AuditResult): void {
    if (this.audit !== undefined) return;
    this.audit = result;
    for (const resolve of this.auditWaiters.splice(0)) resolve(result);
  }

  /** Kroky míchání jdou po sobě, i když zprávy přijdou rychle za sebou. */
  private enqueue(task: () => Promise<void>): void {
    this.busy = this.busy.then(task).catch((err: unknown) => {
      console.error('[mental poker]', err);
      this.cheat(t.shuffleFailed);
    });
  }

  private cheat(detail: string): void {
    if (this.failed) return;
    this.failed = true;
    this.onCheat(detail);
  }
}
