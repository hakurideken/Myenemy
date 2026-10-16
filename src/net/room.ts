import type { MatchFormat } from '../core/match/planMatch';
import type { Clock, TimerHandle } from '../core/util/clock';
import { randomHex } from '../core/util/commitReveal';
import { createKeyPair, deriveSessionKey, type SessionKeyPair } from './crypto';
import { Peer, type PeerTiming } from './Peer';
import {
  BUILD_ID,
  helloSchema,
  isRecord,
  PROTOCOL_VERSION,
  roomFullSchema,
  versionMismatch,
  versionMismatchSchema,
  versionProbeSchema,
  welcomeSchema,
  type Hello,
  type Welcome,
} from './protocol';
import { Listeners, type Transport } from './Transport';

/** Bez zaměnitelných 0/O a 1/I. 32 znaků → 32^5 ≈ 33 milionů kódů. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
const ROOM_CODE = /^[A-HJ-NP-Z2-9]{5}$/;

export const HELLO_RETRY_MS = 1000;
export const JOIN_TIMEOUT_MS = 5000;

export function generateRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  // 256 je násobek 32, takže modulo nezkresluje rozdělení.
  return Array.from(bytes, (b) => ROOM_CODE_ALPHABET.charAt(b % ROOM_CODE_ALPHABET.length)).join(
    '',
  );
}

export function normalizeRoomCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  return ROOM_CODE.test(code) ? code : null;
}

export function roomLink(code: string, base: { origin: string; pathname: string }): string {
  return `${base.origin}${base.pathname}?room=${code}`;
}

export function roomFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('room');
  return value === null ? null : normalizeRoomCode(value);
}

export function newClientId(): string {
  return randomHex(8);
}

export interface Identity {
  readonly id: string;
  readonly nickname: string;
}

export interface Pairing {
  readonly peer: Peer;
  readonly opponent: Identity;
  readonly format: MatchFormat;
}

export type PairingFailure = 'unavailable' | 'full' | 'version' | 'no-host';

export class PairingError extends Error {
  override name = 'PairingError';
  constructor(readonly reason: PairingFailure) {
    super(reason);
  }
}

export interface RoomOptions {
  readonly transport: Transport;
  readonly clock: Clock;
  readonly room: string;
  readonly me: Identity;
  readonly timing?: Partial<PeerTiming>;
}

async function openTransport(o: RoomOptions): Promise<SessionKeyPair> {
  try {
    await o.transport.open(o.room);
  } catch {
    throw new PairingError('unavailable');
  }
  return createKeyPair();
}

/** Hostitel: přijme prvního hosta, další dostanou „místnost je plná“. */
export class HostRoom {
  private guest: { id: string; welcome: Welcome | null } | null = null;
  private readonly guests = new Listeners<Pairing>();
  private readonly mismatches = new Listeners<void>();
  private readonly off: () => void;

  private constructor(
    private readonly o: RoomOptions & { readonly format: MatchFormat },
    private readonly keys: SessionKeyPair,
  ) {
    this.off = o.transport.onMessage((raw) => void this.handle(raw));
  }

  /** Vyhodí PairingError('unavailable'), když server do 5 s neodpoví. */
  static async open(o: RoomOptions & { readonly format: MatchFormat }): Promise<HostRoom> {
    return new HostRoom(o, await openTransport(o));
  }

  onGuest(handler: (pairing: Pairing) => void): () => void {
    return this.guests.add(handler);
  }

  onVersionMismatch(handler: () => void): () => void {
    return this.mismatches.add(handler);
  }

  async close(): Promise<void> {
    this.off();
    await this.o.transport.close();
  }

  private async handle(raw: unknown): Promise<void> {
    const { me, transport } = this.o;
    if (!isRecord(raw)) return;
    const probe = versionProbeSchema.safeParse(raw);
    if (!probe.success) return;

    if (probe.data.type === 'version-mismatch') {
      const msg = versionMismatchSchema.safeParse(raw);
      if (msg.success && msg.data.to === me.id && msg.data.from === this.guest?.id) {
        this.mismatches.emit();
      }
      return;
    }
    if (probe.data.type !== 'hello') return;

    const from = typeof raw.from === 'string' ? raw.from.slice(0, 64) : undefined;
    if (probe.data.v !== PROTOCOL_VERSION || raw.build !== BUILD_ID) {
      transport.send(versionMismatch(me.id, from));
      this.mismatches.emit();
      return;
    }
    const parsed = helloSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn('[room] nevalidní hello zahozeno', parsed.error.issues);
      return;
    }
    const hello = parsed.data;
    if (this.guest && this.guest.id !== hello.from) {
      transport.send({ v: PROTOCOL_VERSION, type: 'room-full', from: me.id, to: hello.from });
      return;
    }
    if (this.guest) {
      // Host hello opakuje, dokud nedostane odpověď – welcome mohlo cestou zmizet.
      if (this.guest.welcome) transport.send(this.guest.welcome);
      return;
    }
    await this.accept(hello);
  }

  private async accept(hello: Hello): Promise<void> {
    const { me, transport, clock, room, format, timing } = this.o;
    this.guest = { id: hello.from, welcome: null };
    let key: CryptoKey;
    try {
      key = await deriveSessionKey(this.keys, hello.pub, room);
    } catch {
      this.guest = null;
      return;
    }
    const welcome: Welcome = {
      v: PROTOCOL_VERSION,
      type: 'welcome',
      from: me.id,
      to: hello.from,
      nickname: me.nickname,
      build: BUILD_ID,
      pub: this.keys.publicKey,
      format,
    };
    this.guest.welcome = welcome;
    transport.send(welcome);
    const peer = new Peer({
      transport,
      clock,
      myId: me.id,
      peerId: hello.from,
      key,
      ...(timing ? { timing } : {}),
    });
    this.guests.emit({ peer, opponent: { id: hello.from, nickname: hello.nickname }, format });
  }
}

/** Host: připojí se kódem; selže s PairingError (plno / jiná verze / hostitel neodpovídá / server nedostupný). */
export async function joinRoom(o: RoomOptions): Promise<Pairing> {
  try {
    await o.transport.open(o.room);
  } catch {
    throw new PairingError('unavailable');
  }
  const { me, transport, clock, room, timing } = o;

  return new Promise<Pairing>((resolve, reject) => {
    let settled = false;
    let accepting = false;
    let retry: TimerHandle | null = null;
    let off: () => void = () => undefined;

    const finish = (result: Pairing | PairingError): void => {
      if (settled) return;
      settled = true;
      off();
      if (retry !== null) clock.clearTimeout(retry);
      clock.clearTimeout(deadline);
      if (result instanceof PairingError) reject(result);
      else resolve(result);
    };

    // Lhůta běží od otevření kanálu – včetně generování klíčů.
    const deadline = clock.setTimeout(() => finish(new PairingError('no-host')), JOIN_TIMEOUT_MS);

    createKeyPair().then(
      (keys) => {
        if (!settled) listen(keys);
      },
      () => finish(new PairingError('no-host')),
    );

    const listen = (keys: SessionKeyPair): void => {
      const hello: Hello = {
        v: PROTOCOL_VERSION,
        type: 'hello',
        from: me.id,
        nickname: me.nickname,
        build: BUILD_ID,
        pub: keys.publicKey,
      };
      off = transport.onMessage((raw) => {
        if (settled || accepting || !isRecord(raw) || raw.to !== me.id) return;
        const probe = versionProbeSchema.safeParse(raw);
        if (!probe.success) return;
        if (probe.data.type === 'version-mismatch' || probe.data.v !== PROTOCOL_VERSION) {
          finish(new PairingError('version'));
          return;
        }
        if (probe.data.type === 'room-full' && roomFullSchema.safeParse(raw).success) {
          finish(new PairingError('full'));
          return;
        }
        if (probe.data.type !== 'welcome') return;
        if (raw.build !== BUILD_ID) {
          transport.send(
            versionMismatch(me.id, typeof raw.from === 'string' ? raw.from : undefined),
          );
          finish(new PairingError('version'));
          return;
        }
        const parsed = welcomeSchema.safeParse(raw);
        if (!parsed.success) {
          console.warn('[room] nevalidní welcome zahozeno', parsed.error.issues);
          return;
        }
        const welcome = parsed.data;
        accepting = true;
        deriveSessionKey(keys, welcome.pub, room).then(
          (key) =>
            finish({
              peer: new Peer({
                transport,
                clock,
                myId: me.id,
                peerId: welcome.from,
                key,
                ...(timing ? { timing } : {}),
              }),
              opponent: { id: welcome.from, nickname: welcome.nickname },
              format: welcome.format,
            }),
          () => finish(new PairingError('no-host')),
        );
      });

      const sendHello = (): void => {
        transport.send(hello);
        retry = clock.setTimeout(sendHello, HELLO_RETRY_MS);
      };
      sendHello();
    };
  });
}
