import { canonicalJson } from '../core/util/canonicalJson';
import type { Clock, TimerHandle } from '../core/util/clock';
import { signText, verifyText } from './crypto';
import {
  isRecord,
  MAX_MESSAGE_CHARS,
  PROTOCOL_VERSION,
  sessionBodySchema,
  sessionEnvelopeSchema,
  versionProbeSchema,
  type SessionBody,
  type SessionEnvelope,
} from './protocol';
import { Listeners, type Transport } from './Transport';

export interface PeerTiming {
  readonly heartbeatMs: number;
  /** Po jak dlouhém tichu je soupeř „ztracený“ (UI ukáže odpočet). */
  readonly lostAfterMs: number;
  /** Jak dlouho se pak ještě čeká, než se prohlásí za odpojeného (kontumace). */
  readonly goneAfterMs: number;
  readonly retransmitMs: number;
}

export const DEFAULT_TIMING: PeerTiming = {
  heartbeatMs: 2000,
  lostAfterMs: 5000,
  goneAfterMs: 15_000,
  retransmitMs: 1000,
};

const ACK_DELAY_MS = 50;
const WATCHDOG_MS = 250;
const MAX_BUFFERED = 256;

export type PeerStatus = 'ok' | 'lost' | 'gone';

export interface PeerOptions {
  readonly transport: Transport;
  readonly clock: Clock;
  readonly myId: string;
  readonly peerId: string;
  /** HMAC klíč z párování (ECDH). */
  readonly key: CryptoKey;
  readonly timing?: Partial<PeerTiming>;
}

type Unsigned = Omit<SessionEnvelope, 'mac'>;

/**
 * Spojení se soupeřem nad Transportem: spolehlivé a seřazené doručení (seq/ack/opakování),
 * podpis každé zprávy, validace (Zod), kontrola verze a hlídání, jestli soupeř žije.
 */
export class Peer {
  private nextSeq = 0;
  private expected = 0;
  private readonly outbox = new Map<number, SessionEnvelope>();
  private readonly inbox = new Map<number, unknown>();
  private incoming: Promise<void> = Promise.resolve();
  private outgoing: Promise<void> = Promise.resolve();
  private lastHeard: number;
  private statusValue: PeerStatus = 'ok';
  private closed = false;
  private ackTimer: TimerHandle | null = null;
  private readonly loops = new Map<string, TimerHandle>();
  private readonly backlog: SessionBody[] = [];
  private readonly messages = new Listeners<SessionBody>();
  private readonly statuses = new Listeners<PeerStatus>();
  private readonly byes = new Listeners<void>();
  private readonly mismatches = new Listeners<void>();
  private readonly unsubscribe: (() => void)[];
  private readonly timing: PeerTiming;

  constructor(private readonly o: PeerOptions) {
    this.timing = { ...DEFAULT_TIMING, ...o.timing };
    this.lastHeard = o.clock.now();
    this.unsubscribe = [
      o.transport.onMessage((raw) => this.receive(raw)),
      o.transport.onStatus((status) => {
        if (status === 'open') this.retransmit();
      }),
    ];
    this.every('heartbeat', this.timing.heartbeatMs, () => this.sendControl('ping'));
    this.every('retransmit', this.timing.retransmitMs, () => this.retransmit());
    this.every('watchdog', WATCHDOG_MS, () => this.watch());
  }

  get status(): PeerStatus {
    return this.statusValue;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get peerId(): string {
    return this.o.peerId;
  }

  /** Zprávy doručené dřív, než se někdo přihlásil, dostane první posluchač. */
  onMessage(handler: (body: SessionBody) => void): () => void {
    const off = this.messages.add(handler);
    for (const body of this.backlog.splice(0)) handler(body);
    return off;
  }

  onStatus(handler: (status: PeerStatus) => void): () => void {
    return this.statuses.add(handler);
  }

  onBye(handler: () => void): () => void {
    return this.byes.add(handler);
  }

  onVersionMismatch(handler: () => void): () => void {
    return this.mismatches.add(handler);
  }

  send(body: SessionBody): void {
    if (this.closed) return;
    const seq = this.nextSeq++;
    this.enqueue('msg', { seq, body }, (envelope) => this.outbox.set(seq, envelope));
  }

  /** Oznámí odchod a spojení zavře. */
  bye(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.enqueue('bye', {});
    const done = this.outgoing.then(() => this.close());
    return done;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const handle of this.loops.values()) this.o.clock.clearTimeout(handle);
    this.loops.clear();
    if (this.ackTimer !== null) this.o.clock.clearTimeout(this.ackTimer);
    for (const off of this.unsubscribe) off();
  }

  private every(name: string, ms: number, fn: () => void): void {
    const tick = (): void => {
      if (this.closed) return;
      fn();
      if (!this.closed) this.loops.set(name, this.o.clock.setTimeout(tick, ms));
    };
    this.loops.set(name, this.o.clock.setTimeout(tick, ms));
  }

  private sendControl(kind: 'ack' | 'ping' | 'bye'): void {
    if (!this.closed) this.enqueue(kind, {});
  }

  private enqueue(
    kind: SessionEnvelope['kind'],
    part: { seq?: number; body?: SessionBody },
    onSealed?: (envelope: SessionEnvelope) => void,
  ): void {
    this.outgoing = this.outgoing
      .then(async () => {
        const unsigned: Unsigned = {
          v: PROTOCOL_VERSION,
          type: 'session',
          from: this.o.myId,
          to: this.o.peerId,
          kind,
          ...(part.seq !== undefined ? { seq: part.seq } : {}),
          ack: this.expected - 1,
          ...(part.body !== undefined ? { body: part.body } : {}),
        };
        const envelope: SessionEnvelope = {
          ...unsigned,
          mac: await signText(this.o.key, canonicalJson(unsigned)),
        };
        onSealed?.(envelope);
        if (!this.closed || kind === 'bye') this.o.transport.send(envelope);
      })
      .catch((err: unknown) => console.warn('[peer] odeslání selhalo', err));
  }

  private receive(raw: unknown): void {
    // Levný filtr předem: jen zprávy od spárovaného soupeře pro mě.
    if (this.closed || !isRecord(raw) || raw.from !== this.o.peerId || raw.to !== this.o.myId)
      return;
    if (raw.type !== 'session' && raw.type !== 'version-mismatch') return;
    this.incoming = this.incoming
      .then(() => this.process(raw))
      .catch((err: unknown) => console.warn('[peer] zpracování selhalo', err));
  }

  private async process(raw: Record<string, unknown>): Promise<void> {
    const probe = versionProbeSchema.safeParse(raw);
    if (!probe.success) return;
    if (probe.data.v !== PROTOCOL_VERSION || probe.data.type === 'version-mismatch') {
      this.mismatches.emit();
      return;
    }
    const parsed = sessionEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn('[peer] nevalidní obálka zahozena', parsed.error.issues);
      return;
    }
    const { mac, ...unsigned } = parsed.data;
    const text = canonicalJson(unsigned);
    if (text.length > MAX_MESSAGE_CHARS) {
      console.warn('[peer] příliš velká zpráva zahozena');
      return;
    }
    if (!(await verifyText(this.o.key, text, mac))) {
      console.warn('[peer] zpráva s neplatným podpisem zahozena');
      return;
    }
    if (this.closed) return;
    this.heard();
    for (const seq of [...this.outbox.keys()]) if (seq <= unsigned.ack) this.outbox.delete(seq);
    if (unsigned.kind === 'msg' && unsigned.seq !== undefined) {
      this.receiveMessage(unsigned.seq, unsigned.body);
    } else if (unsigned.kind === 'bye') {
      this.close();
      this.byes.emit();
    }
  }

  private receiveMessage(seq: number, body: unknown): void {
    if (seq >= this.expected && seq < this.expected + MAX_BUFFERED) this.inbox.set(seq, body);
    while (this.inbox.has(this.expected)) {
      const next = this.inbox.get(this.expected);
      this.inbox.delete(this.expected);
      this.expected++;
      const parsed = sessionBodySchema.safeParse(next);
      if (!parsed.success) {
        console.warn('[peer] nevalidní zpráva zahozena', parsed.error.issues);
        continue;
      }
      if (this.messages.size === 0) this.backlog.push(parsed.data);
      else this.messages.emit(parsed.data);
      if (this.closed) return;
    }
    this.scheduleAck();
  }

  private scheduleAck(): void {
    if (this.ackTimer !== null || this.closed) return;
    this.ackTimer = this.o.clock.setTimeout(() => {
      this.ackTimer = null;
      this.sendControl('ack');
    }, ACK_DELAY_MS);
  }

  private retransmit(): void {
    if (this.closed) return;
    for (const envelope of this.outbox.values()) this.o.transport.send(envelope);
  }

  private heard(): void {
    this.lastHeard = this.o.clock.now();
    if (this.statusValue === 'lost') this.setStatus('ok');
  }

  private watch(): void {
    const silence = this.o.clock.now() - this.lastHeard;
    if (this.statusValue === 'ok' && silence >= this.timing.lostAfterMs) {
      this.setStatus('lost');
    } else if (
      this.statusValue === 'lost' &&
      silence >= this.timing.lostAfterMs + this.timing.goneAfterMs
    ) {
      this.close();
      this.setStatus('gone');
    }
  }

  private setStatus(status: PeerStatus): void {
    this.statusValue = status;
    this.statuses.emit(status);
  }
}
