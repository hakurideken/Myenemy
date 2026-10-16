/** Do kolika ms musí jít místnost otevřít, jinak hra nabídne PvE nebo lokální režim. */
export const OPEN_TIMEOUT_MS = 5000;

export type TransportStatus = 'open' | 'reconnecting' | 'closed';

/**
 * „Hloupá roura“ mezi hráči v jedné místnosti. Žádná herní logika, žádné ověřování –
 * to dělá Peer. Herní kód pracuje jen s tímto rozhraním, nikdy přímo se Supabase.
 */
export interface Transport {
  /** Vyhodí TransportUnavailableError nejpozději po OPEN_TIMEOUT_MS. */
  open(room: string): Promise<void>;
  send(message: unknown): void;
  onMessage(handler: (raw: unknown) => void): () => void;
  onStatus(handler: (status: TransportStatus) => void): () => void;
  close(): Promise<void>;
}

export class TransportUnavailableError extends Error {
  override name = 'TransportUnavailableError';
}

export type TransportFactory = () => Promise<Transport>;

/** Pomocník pro implementace: seznam posluchačů s odhlášením. */
export class Listeners<T> {
  private readonly handlers = new Set<(value: T) => void>();

  add(handler: (value: T) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(value: T): void {
    for (const handler of [...this.handlers]) handler(value);
  }

  get size(): number {
    return this.handlers.size;
  }

  clear(): void {
    this.handlers.clear();
  }
}
