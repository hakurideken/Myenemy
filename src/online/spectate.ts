import { z } from 'zod';
import type { RoundRecord } from '../core/match/MatchController';
import type { SpectateSnapshot } from '../core/MiniGame';
import type { GameId, Outcome, PerPlayer, PlayerSlot } from '../core/types';
import { fromBase64Url, toBase64Url } from '../net/crypto';
import type { Transport } from '../net/Transport';

/**
 * Sledování turnajových zápasů. Kdo zápas řídí (hostitel online místnosti, nebo hráč
 * proti AI), posílá do zvláštního kanálu „spec-TOKEN“ podepsané snímky: skóre, právě
 * hranou hru a veřejné pohledy obou hráčů (bez karet v ruce, lodí, polohy v mlze).
 * Token a veřejný klíč (ECDSA P-256) dostanou od serveru jen účastníci turnaje – diváci
 * kód místnosti hráčů neznají a nic do hry poslat nemůžou. Podpis brání tomu, aby jiný
 * divák podstrčil ostatním vymyšlený průběh.
 */

export type SpectatePhase =
  'waiting' | 'intro' | 'playing' | 'round-result' | 'match-result' | 'ended';

export interface SpectateRecord {
  readonly no: number;
  readonly id: GameId;
  /** null = remíza. */
  readonly winner: PlayerSlot | null;
}

export interface SpectateBody {
  readonly names: PerPlayer<string>;
  readonly score: PerPlayer<number>;
  readonly phase: SpectatePhase;
  /** Právě hraná (nebo naposledy dohraná) hra. */
  readonly game: { readonly no: number; readonly replay: number; readonly id: GameId } | null;
  readonly history: readonly SpectateRecord[];
  /** Veřejné pohledy obou hráčů na aktuální hru (null = hra se nevysílá). */
  readonly views: PerPlayer<unknown> | null;
  readonly finished: Outcome | null;
  /** Vítěz zápasu (po konci). */
  readonly winner: PlayerSlot | null;
}

/** Jak často nejvýš posílat (ms) a jak často opakovat poslední snímek pro nové diváky. */
export const SEND_MIN_MS = 500;
export const HEARTBEAT_MS = 5_000;
/**
 * Vysílá se jen na vyžádání: divák se ozve při připojení a pak každých WATCH_PING_MS;
 * bez ozvání déle než WATCH_IDLE_MS vysílání mlčí (šetří kvótu Realtime pro hru).
 */
export const WATCH_PING_MS = 10_000;
export const WATCH_IDLE_MS = 25_000;
const WATCH_REQUEST = { kind: 'watch' } as const;
/** Největší povolená zpráva (znaky JSON) – víc nepošleme ani nepřijmeme. */
export const MAX_SNAPSHOT_CHARS = 60_000;

const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
const KEY_RE = /^[A-Za-z0-9_-]{87}$/;

const slot = z.enum(['A', 'B']);
/** Id hry (zda existuje, ověří až vykreslení přes registr). */
const gameId = z.string().regex(/^[a-z][a-z0-9-]{1,30}$/);
const name = z.string().min(1).max(64);
const outcome = z.union([
  z.object({ kind: z.literal('win'), winner: slot }),
  z.object({ kind: z.literal('draw') }),
]);

export const spectateBodySchema = z.object({
  names: z.object({ A: name, B: name }),
  score: z.object({ A: z.number().int().min(0).max(99), B: z.number().int().min(0).max(99) }),
  phase: z.enum(['waiting', 'intro', 'playing', 'round-result', 'match-result', 'ended']),
  game: z
    .object({
      no: z.number().int().min(1).max(99),
      replay: z.number().int().min(0).max(99),
      id: gameId,
    })
    .nullable(),
  history: z
    .array(z.object({ no: z.number().int().min(1).max(99), id: gameId, winner: slot.nullable() }))
    .max(40),
  views: z.object({ A: z.unknown(), B: z.unknown() }).nullable(),
  finished: outcome.nullable(),
  winner: slot.nullable(),
});

const envelopeSchema = z.object({
  /** Pořadí snímku (starší se zahodí). */
  seq: z.number().int().min(0),
  /** Tělo jako JSON text – podepisuje se přesně tento text i s pořadím. */
  data: z.string().max(MAX_SNAPSHOT_CHARS),
  sig: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
});

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;
const signed = (seq: number, data: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(`${seq}\n${data}`);

export function isWatchToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

export function isWatchKey(key: string): boolean {
  return KEY_RE.test(key);
}

/** Stav zápasu pro diváky z údajů průběhu (OnlineFlow i MatchFlow). */
export function matchBody(o: {
  readonly names: PerPlayer<string>;
  readonly score: PerPlayer<number>;
  readonly phase: SpectatePhase;
  readonly current: {
    readonly gameNo: number;
    readonly replay: number;
    readonly gameId: GameId;
  } | null;
  readonly history: readonly RoundRecord[];
  readonly winner: PlayerSlot | null;
}): Omit<SpectateBody, 'views' | 'finished'> {
  return {
    names: o.names,
    score: o.score,
    phase: o.phase,
    game: o.current
      ? { no: o.current.gameNo, replay: o.current.replay, id: o.current.gameId }
      : null,
    history: o.history.map((r) => ({
      no: r.gameNo,
      id: r.gameId,
      winner: r.outcome.kind === 'win' ? r.outcome.winner : null,
    })),
    winner: o.winner,
  };
}

/** Kanál sledování (Transport.open). */
export const watchChannel = (token: string): string => `spec-${token}`;

/**
 * Vysílač snímků. Snímky posílá nejvýš každých SEND_MIN_MS (poslední vyhrává) a poslední
 * opakuje každé HEARTBEAT_MS, aby se nově příchozí divák hned chytil.
 */
export class SpectateCaster {
  private body: SpectateBody | null = null;
  private seq = 0;
  private lastSent = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private closed = false;
  private sending: Promise<void> = Promise.resolve();
  /** Kdy se naposledy ozval divák (0 = nikdo se nedívá). */
  private watchedAt = 0;
  private lastData = '';
  private readonly offRequests: () => void;

  private constructor(
    private readonly transport: Transport,
    private readonly key: CryptoKey,
    readonly token: string,
    readonly publicKey: string,
  ) {
    this.heartbeat = setInterval(() => this.flush(true), HEARTBEAT_MS);
    // Žádost diváka nemusí být podepsaná – podvržená vede nejvýš ke zbytečnému vysílání.
    this.offRequests = transport.onMessage((raw) => {
      if (
        typeof raw !== 'object' ||
        raw === null ||
        (raw as { kind?: unknown }).kind !== WATCH_REQUEST.kind
      ) {
        return;
      }
      const fresh = !this.watching;
      this.watchedAt = Date.now();
      // Nový divák: hned poslat aktuální stav.
      if (fresh) this.flush(true);
    });
  }

  private get watching(): boolean {
    return Date.now() - this.watchedAt < WATCH_IDLE_MS;
  }

  /** Nový kanál s náhodným tokenem a jednorázovým podpisovým klíčem. */
  static async open(transport: Transport): Promise<SpectateCaster> {
    try {
      const token = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
      const pair = await crypto.subtle.generateKey(ECDSA, false, ['sign', 'verify']);
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
      await transport.open(watchChannel(token));
      return new SpectateCaster(transport, pair.privateKey, token, toBase64Url(raw));
    } catch (err) {
      await transport.close();
      throw err;
    }
  }

  /** Nový stav zápasu (pohledy se přenesou ze snímku hry, pokud nejsou zadané). */
  update(next: Omit<SpectateBody, 'views' | 'finished'> & Partial<SpectateBody>): void {
    const sameGame =
      this.body?.game?.no === next.game?.no && this.body?.game?.replay === next.game?.replay;
    this.body = {
      ...next,
      views: next.views !== undefined ? next.views : sameGame ? (this.body?.views ?? null) : null,
      finished:
        next.finished !== undefined
          ? next.finished
          : sameGame
            ? (this.body?.finished ?? null)
            : null,
    };
    this.schedule();
  }

  /** Změna ve hře (z GameRunneru). */
  game(snapshot: SpectateSnapshot): void {
    if (!this.body) return;
    this.body = { ...this.body, views: snapshot.views, finished: snapshot.finished };
    this.schedule();
  }

  private schedule(): void {
    if (this.closed || this.timer !== null) return;
    const wait = Math.max(0, this.lastSent + SEND_MIN_MS - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, wait);
  }

  /** repeat = poslat i nezměněný stav (opakování pro nové diváky, poslední snímek). */
  private flush(repeat = false): void {
    const body = this.body;
    if (this.closed || !body || !this.watching) return;
    let data = JSON.stringify(body);
    // Příliš velký pohled se nepošle (divák uvidí aspoň skóre).
    if (data.length > MAX_SNAPSHOT_CHARS) data = JSON.stringify({ ...body, views: null });
    if (!repeat && data === this.lastData) return;
    this.lastData = data;
    this.lastSent = Date.now();
    const seq = ++this.seq;
    this.sending = this.sending
      .then(async () => {
        const sig = await crypto.subtle.sign(SIGN, this.key, signed(seq, data));
        if (!this.closed) {
          this.transport.send({ seq, data, sig: toBase64Url(new Uint8Array(sig)) });
        }
      })
      .catch(() => undefined);
  }

  /** Konec vysílání (poslední snímek ještě odejde). */
  async close(final?: SpectateBody): Promise<void> {
    if (this.closed) return;
    if (final) this.body = final;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    clearInterval(this.heartbeat);
    this.flush(true);
    await this.sending;
    this.closed = true;
    this.offRequests();
    await this.transport.close();
  }
}

/** Přijímač: ověří podpis a pořadí, vrací jen platné snímky. */
export class SpectateReceiver {
  private lastSeq = -1;
  private readonly off: () => void;
  private ping: ReturnType<typeof setInterval> | null = null;

  private constructor(
    private readonly transport: Transport,
    private readonly key: CryptoKey,
    onBody: (body: SpectateBody) => void,
  ) {
    let chain: Promise<void> = Promise.resolve();
    this.off = transport.onMessage((raw) => {
      chain = chain.then(() => this.accept(raw, onBody)).catch(() => undefined);
    });
  }

  /** „Dívám se“ – vysílající posílá jen, když se někdo dívá. */
  private startPing(): void {
    this.transport.send(WATCH_REQUEST);
    this.ping = setInterval(() => this.transport.send(WATCH_REQUEST), WATCH_PING_MS);
  }

  static async open(
    transport: Transport,
    token: string,
    publicKey: string,
    onBody: (body: SpectateBody) => void,
  ): Promise<SpectateReceiver> {
    if (!isWatchToken(token) || !isWatchKey(publicKey)) throw new Error('neplatné sledování');
    const key = await crypto.subtle.importKey('raw', fromBase64Url(publicKey), ECDSA, false, [
      'verify',
    ]);
    const receiver = new SpectateReceiver(transport, key, onBody);
    try {
      await transport.open(watchChannel(token));
    } catch (err) {
      await receiver.close();
      throw err;
    }
    receiver.startPing();
    return receiver;
  }

  private async accept(raw: unknown, onBody: (body: SpectateBody) => void): Promise<void> {
    const envelope = envelopeSchema.safeParse(raw);
    if (!envelope.success) return;
    const { seq, data, sig } = envelope.data;
    if (seq <= this.lastSeq) return;
    const ok = await crypto.subtle.verify(SIGN, this.key, fromBase64Url(sig), signed(seq, data));
    if (!ok || seq <= this.lastSeq) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const body = spectateBodySchema.safeParse(parsed);
    if (!body.success) return;
    this.lastSeq = seq;
    onBody(body.data);
  }

  async close(): Promise<void> {
    if (this.ping !== null) clearInterval(this.ping);
    this.ping = null;
    this.off();
    await this.transport.close();
  }
}
