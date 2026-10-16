import {
  RealtimeClient,
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeChannel,
} from '@supabase/realtime-js';
import type { SupabaseConfig } from './config';
import {
  Listeners,
  OPEN_TIMEOUT_MS,
  TransportUnavailableError,
  type Transport,
  type TransportStatus,
} from './Transport';

const EVENT = 'msg';

/**
 * Supabase Realtime Broadcast: kanál „myenemy:KOD“, žádné databázové tabulky.
 * Jediné místo v aplikaci, které o Supabase ví.
 */
export class SupabaseTransport implements Transport {
  private client: RealtimeClient | null = null;
  private channel: RealtimeChannel | null = null;
  private readonly messages = new Listeners<unknown>();
  private readonly statuses = new Listeners<TransportStatus>();

  constructor(private readonly config: SupabaseConfig) {}

  open(room: string): Promise<void> {
    const client = new RealtimeClient(`${this.config.url}/realtime/v1`, {
      params: { apikey: this.config.anonKey },
    });
    const channel = client.channel(`myenemy:${room}`, {
      config: { broadcast: { self: false, ack: false } },
    });
    this.client = client;
    this.channel = channel;
    channel.on('broadcast', { event: EVENT }, (message: { payload?: unknown }) => {
      this.messages.emit(message.payload);
    });

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (reason: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void this.close();
        reject(new TransportUnavailableError(reason));
      };
      // Uspaný nebo nedostupný projekt se jinak připojuje donekonečna.
      const timer = setTimeout(() => fail('Server neodpověděl včas.'), OPEN_TIMEOUT_MS);
      channel.subscribe((status, err) => {
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
          this.statuses.emit('open');
        } else if (
          status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
          status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
        ) {
          if (!settled) fail(err?.message ?? status);
          else this.statuses.emit('reconnecting');
        } else {
          this.statuses.emit('closed');
        }
      });
    });
  }

  send(message: unknown): void {
    const channel = this.channel;
    if (!channel) return;
    channel.send({ type: 'broadcast', event: EVENT, payload: message }).catch((err: unknown) => {
      console.warn('[supabase] odeslání selhalo', err);
    });
  }

  onMessage(handler: (raw: unknown) => void): () => void {
    return this.messages.add(handler);
  }

  onStatus(handler: (status: TransportStatus) => void): () => void {
    return this.statuses.add(handler);
  }

  async close(): Promise<void> {
    const { client, channel } = this;
    this.client = null;
    this.channel = null;
    this.messages.clear();
    this.statuses.clear();
    try {
      if (client && channel) await client.removeChannel(channel);
      await client?.disconnect();
    } catch {
      /* zavírání nesmí shodit hru */
    }
  }
}
