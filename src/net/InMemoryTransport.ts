import { systemClock, type Clock } from '../core/util/clock';
import { createRng, type Rng } from '../core/util/rng';
import {
  Listeners,
  OPEN_TIMEOUT_MS,
  TransportUnavailableError,
  type Transport,
  type TransportStatus,
} from './Transport';

export interface InMemoryHubOptions {
  readonly clock?: Clock;
  readonly latencyMs?: number;
  /** Náhodný rozptyl latence – zprávy se pak můžou předbíhat. */
  readonly jitterMs?: number;
  /** Pravděpodobnost ztráty zprávy. */
  readonly dropRate?: number;
  readonly rng?: Rng;
}

/** Simulovaná síť pro vývoj (dva hráči v jedné záložce) a unit testy online logiky. */
export class InMemoryHub {
  /** false = simulace výpadku serveru (open() selže po OPEN_TIMEOUT_MS). */
  available = true;
  lastRoom: string | null = null;
  readonly clock: Clock;
  private readonly rooms = new Map<string, Set<InMemoryTransport>>();
  private readonly rng: Rng;

  constructor(private readonly options: InMemoryHubOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.rng = options.rng ?? createRng('in-memory-hub');
  }

  createTransport(): InMemoryTransport {
    return new InMemoryTransport(this);
  }

  /** @internal */
  join(room: string, transport: InMemoryTransport): void {
    let members = this.rooms.get(room);
    if (!members) {
      members = new Set();
      this.rooms.set(room, members);
    }
    members.add(transport);
    this.lastRoom = room;
  }

  /** @internal */
  leave(room: string, transport: InMemoryTransport): void {
    this.rooms.get(room)?.delete(transport);
  }

  /** @internal */
  deliver(from: InMemoryTransport, room: string, message: unknown): void {
    const { latencyMs = 0, jitterMs = 0, dropRate = 0 } = this.options;
    // Serializace jako na skutečné síti – žádné sdílené reference mezi hráči.
    const wire = JSON.stringify(message);
    for (const target of this.rooms.get(room) ?? []) {
      if (target === from || !target.connected || !from.connected) continue;
      if (dropRate > 0 && this.rng.chance(dropRate)) continue;
      const delay = latencyMs + (jitterMs > 0 ? this.rng.range(0, jitterMs) : 0);
      this.clock.setTimeout(() => target.receive(JSON.parse(wire) as unknown), delay);
    }
  }
}

export class InMemoryTransport implements Transport {
  /** false = simulace výpadku spojení jen tohoto hráče. */
  connected = true;
  private room: string | null = null;
  private readonly messages = new Listeners<unknown>();
  private readonly statuses = new Listeners<TransportStatus>();

  constructor(private readonly hub: InMemoryHub) {}

  open(room: string): Promise<void> {
    if (!this.hub.available) {
      return new Promise((_, reject) => {
        this.hub.clock.setTimeout(
          () => reject(new TransportUnavailableError('Server neodpověděl.')),
          OPEN_TIMEOUT_MS,
        );
      });
    }
    this.room = room;
    this.hub.join(room, this);
    this.statuses.emit('open');
    return Promise.resolve();
  }

  send(message: unknown): void {
    if (this.room !== null) this.hub.deliver(this, this.room, message);
  }

  onMessage(handler: (raw: unknown) => void): () => void {
    return this.messages.add(handler);
  }

  onStatus(handler: (status: TransportStatus) => void): () => void {
    return this.statuses.add(handler);
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
    this.statuses.emit(connected ? 'open' : 'reconnecting');
  }

  close(): Promise<void> {
    if (this.room !== null) this.hub.leave(this.room, this);
    this.room = null;
    this.statuses.emit('closed');
    this.messages.clear();
    this.statuses.clear();
    return Promise.resolve();
  }

  /** @internal */
  receive(message: unknown): void {
    if (this.room !== null && this.connected) this.messages.emit(message);
  }
}
