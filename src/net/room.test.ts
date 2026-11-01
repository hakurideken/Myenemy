import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualClock } from '../core/util/clock';
import { run, runUntil, settledFlag } from '../test/helpers';
import { commitPublicKey, createKeyPair } from './crypto';
import { InMemoryHub } from './InMemoryTransport';
import { BUILD_ID, PROTOCOL_VERSION, type SessionBody } from './protocol';
import {
  generateRoomCode,
  HostRoom,
  joinRoom,
  JOIN_TIMEOUT_MS,
  newClientId,
  normalizeRoomCode,
  PairingError,
  roomFromSearch,
  roomLink,
  type Pairing,
} from './room';
import { OPEN_TIMEOUT_MS } from './Transport';

const FORMAT = { kind: 'rychlovka' } as const;

let clock: ManualClock;
let hub: InMemoryHub;
beforeEach(() => {
  clock = new ManualClock();
  hub = new InMemoryHub({ clock, latencyMs: 15 });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

const identity = (nickname: string) => ({ id: newClientId(), nickname });

async function openHost() {
  const room = await HostRoom.open({
    transport: hub.createTransport(),
    clock,
    room: 'ABCDE',
    me: identity('Hostitel'),
    format: FORMAT,
  });
  const guests: Pairing[] = [];
  room.onGuest((p) => guests.push(p));
  return { room, guests };
}

function join(nickname: string): Promise<Pairing> {
  return joinRoom({
    transport: hub.createTransport(),
    clock,
    room: 'ABCDE',
    me: identity(nickname),
  });
}

/** Sleduje výsledek hned od začátku, aby odmítnutí nebylo „neošetřené“. */
function observe(promise: Promise<unknown>): { readonly reason: string | null } {
  const state: { reason: string | null } = { reason: null };
  promise.catch((err: unknown) => {
    state.reason = err instanceof PairingError ? err.reason : 'jiná chyba';
  });
  return state;
}

describe('kódy místností', () => {
  it('5 znaků bez zaměnitelných 0/O a 1/I', () => {
    for (let i = 0; i < 300; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    }
  });

  it('normalizace vstupu a odkaz ke sdílení', () => {
    expect(normalizeRoomCode(' ab-c de ')).toBe('ABCDE');
    expect(normalizeRoomCode('ABC0E')).toBeNull();
    expect(normalizeRoomCode('ABCIE')).toBeNull();
    expect(normalizeRoomCode('ABCD')).toBeNull();
    const link = roomLink('XY234', { origin: 'https://hra.cz', pathname: '/Myenemy/' });
    expect(link).toBe('https://hra.cz/Myenemy/?room=XY234');
    expect(roomFromSearch(new URL(link).search)).toBe('XY234');
    expect(roomFromSearch('?room=<script>')).toBeNull();
  });
});

describe('párování', () => {
  it('host se připojí, oba znají přezdívku soupeře a formát a můžou si psát', async () => {
    const { guests } = await openHost();
    const joining = join('Jana');
    await runUntil(clock, settledFlag(joining));
    const guest = await joining;
    // Hostitel spáruje až po odhalení klíče, ke kterému se host zavázal v hello.
    await runUntil(clock, () => guests.length > 0);
    const host = guests[0];
    expect(host?.opponent.nickname).toBe('Jana');
    expect(guest.opponent.nickname).toBe('Hostitel');
    expect(guest.format).toEqual(FORMAT);
    // Kontrolní kód: oba vidí stejný (nikdo se nevložil mezi ně).
    expect(guest.check).toMatch(/^\d{3} \d{3}$/);
    expect(host?.check).toBe(guest.check);

    const got: SessionBody[] = [];
    host?.peer.onMessage((b) => got.push(b));
    guest.peer.send({ type: 'rematch', match: 1 });
    await runUntil(clock, () => got.length > 0);
    expect(got).toEqual([{ type: 'rematch', match: 1 }]);
  });

  it('třetí hráč dostane „místnost je plná“', async () => {
    await openHost();
    const first = join('Jana');
    await runUntil(clock, settledFlag(first));
    await first;
    const third = observe(join('Petr'));
    await runUntil(clock, () => third.reason !== null);
    expect(third.reason).toBe('full');
  });

  it('host s jinou verzí: oba se dozví o neshodě verzí', async () => {
    const { room } = await openHost();
    const mismatch = vi.fn();
    room.onVersionMismatch(mismatch);
    const fake = hub.createTransport();
    await fake.open('ABCDE');
    const answers: unknown[] = [];
    fake.onMessage((m) => answers.push(m));
    const id = newClientId();
    fake.send({
      v: PROTOCOL_VERSION,
      type: 'hello',
      from: id,
      nickname: 'Stará',
      build: 'starsi-build',
      pub: (await createKeyPair()).publicKey,
    });
    await runUntil(clock, () => answers.length > 0);
    expect(mismatch).toHaveBeenCalledOnce();
    expect(answers).toEqual([
      expect.objectContaining({ type: 'version-mismatch', to: id, build: BUILD_ID }),
    ]);
  });

  it('po spárování cizí hello s jinou verzí zápas neukončí', async () => {
    const { room } = await openHost();
    const mismatch = vi.fn();
    room.onVersionMismatch(mismatch);
    const guest = join('Jana');
    await runUntil(clock, settledFlag(guest));
    await guest;
    const fake = hub.createTransport();
    await fake.open('ABCDE');
    fake.send({
      v: PROTOCOL_VERSION + 1,
      type: 'hello',
      from: newClientId(),
      nickname: 'Cizí',
      build: 'jiny-build',
      pub: (await createKeyPair()).publicKey,
    });
    await run(clock, 200);
    expect(mismatch).not.toHaveBeenCalled();
  });

  it('hostitel s jinou verzí: host odmítne a dá mu vědět', async () => {
    const fakeHost = hub.createTransport();
    await fakeHost.open('ABCDE');
    const seen: unknown[] = [];
    fakeHost.onMessage((m) => {
      seen.push(m);
      const hello = m as { type: string; from: string };
      if (hello.type !== 'hello' || seen.length > 1) return;
      void createKeyPair().then((keys) =>
        fakeHost.send({
          v: PROTOCOL_VERSION,
          type: 'welcome',
          from: newClientId(),
          to: hello.from,
          nickname: 'Hostitel',
          build: 'novejsi-build',
          pub: keys.publicKey,
          format: FORMAT,
        }),
      );
    });
    const joining = observe(join('Jana'));
    await runUntil(clock, () => joining.reason !== null);
    expect(joining.reason).toBe('version');
    expect(seen.some((m) => (m as { type: string }).type === 'version-mismatch')).toBe(true);
  });

  it('bez hostitele vyprší připojení po 5 s', async () => {
    const joining = observe(join('Jana'));
    await run(clock, JOIN_TIMEOUT_MS - 100, 250);
    expect(joining.reason).toBeNull();
    await run(clock, 200);
    expect(joining.reason).toBe('no-host');
  });

  it('nedostupný server se pozná do 5 s', async () => {
    hub.available = false;
    const opening = observe(
      HostRoom.open({
        transport: hub.createTransport(),
        clock,
        room: 'ABCDE',
        me: identity('Hostitel'),
        format: FORMAT,
      }),
    );
    await run(clock, OPEN_TIMEOUT_MS - 100, 250);
    expect(opening.reason).toBeNull();
    await run(clock, 200);
    expect(opening.reason).toBe('unavailable');
  });

  it('hostitel přijme jen klíč, ke kterému se host zavázal', async () => {
    const { guests } = await openHost();
    const fake = hub.createTransport();
    await fake.open('ABCDE');
    const id = newClientId();
    const promised = await createKeyPair();
    const other = await createKeyPair();
    let hostId: string | null = null;
    fake.onMessage((m) => {
      const msg = m as { type: string; from: string };
      if (msg.type === 'welcome') hostId = msg.from;
    });
    fake.send({
      v: PROTOCOL_VERSION,
      type: 'hello',
      from: id,
      nickname: 'Jana',
      build: BUILD_ID,
      commit: await commitPublicKey(promised.publicKey),
    });
    await runUntil(clock, () => hostId !== null);
    const reveal = (pub: string) => ({
      v: PROTOCOL_VERSION,
      type: 'key',
      from: id,
      to: hostId,
      pub,
    });
    // Jiný klíč než ten slíbený (útočník by ho dopočítal až po welcome) – nic.
    fake.send(reveal(other.publicKey));
    await run(clock, 300);
    expect(guests).toHaveLength(0);
    fake.send(reveal(promised.publicKey));
    await runUntil(clock, () => guests.length > 0);
    expect(guests).toHaveLength(1);
  });

  it('ztracené welcome se po opakovaném hello pošle znovu', async () => {
    const { guests } = await openHost();
    const lossy = hub.createTransport();
    const send = vi.spyOn(lossy, 'send');
    const joining = joinRoom({ transport: lossy, clock, room: 'ABCDE', me: identity('Jana') });
    // Počkat, až hello skutečně odejde (generování klíče trvá skutečný čas).
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    lossy.connected = false;
    await run(clock, 500);
    // Welcome se ztratilo a host klíč ještě neodhalil – hostitel zatím nespároval.
    expect(guests).toHaveLength(0);
    lossy.connected = true;
    await run(clock, 1500);
    await expect(joining).resolves.toMatchObject({ opponent: { nickname: 'Hostitel' } });
    await runUntil(clock, () => guests.length > 0);
    expect(guests).toHaveLength(1);
  });
});
