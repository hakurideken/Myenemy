import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '../core/util/canonicalJson';
import { ManualClock } from '../core/util/clock';
import { createRng } from '../core/util/rng';
import { run, settle } from '../test/helpers';
import { createKeyPair, deriveSessionKey, signText } from './crypto';
import { InMemoryHub } from './InMemoryTransport';
import { Peer, type PeerStatus } from './Peer';
import { PROTOCOL_VERSION, type SessionBody } from './protocol';

const A_ID = 'aaaaaaaaaaaaaaaa';
const B_ID = 'bbbbbbbbbbbbbbbb';

async function connectedPair(hub: InMemoryHub, clock: ManualClock) {
  const ta = hub.createTransport();
  const tb = hub.createTransport();
  await ta.open('ROOM1');
  await tb.open('ROOM1');
  const ka = await createKeyPair();
  const kb = await createKeyPair();
  const a = new Peer({
    transport: ta,
    clock,
    myId: A_ID,
    peerId: B_ID,
    key: await deriveSessionKey(ka, kb.publicKey, 'ROOM1'),
  });
  const b = new Peer({
    transport: tb,
    clock,
    myId: B_ID,
    peerId: A_ID,
    key: await deriveSessionKey(kb, ka.publicKey, 'ROOM1'),
  });
  return { a, b, ta, tb };
}

const rematch = (match: number): SessionBody => ({ type: 'rematch', match });

let clock: ManualClock;
beforeEach(() => {
  clock = new ManualClock();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('Peer – spolehlivé doručení', () => {
  it('doručí všechny zprávy právě jednou a ve správném pořadí i přes ztráty a předbíhání', async () => {
    const hub = new InMemoryHub({
      clock,
      dropRate: 0.3,
      latencyMs: 20,
      jitterMs: 80,
      rng: createRng('lossy'),
    });
    const { a, b } = await connectedPair(hub, clock);
    const got: number[] = [];
    b.onMessage((body) => body.type === 'rematch' && got.push(body.match));
    for (let i = 1; i <= 40; i++) a.send(rematch(i));
    await run(clock, 15_000, 100);
    expect(got).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });

  it('zprávy přijaté dřív, než se někdo přihlásil, nepropadnou', async () => {
    const hub = new InMemoryHub({ clock });
    const { a, b } = await connectedPair(hub, clock);
    a.send(rematch(7));
    await run(clock, 200);
    const got: SessionBody[] = [];
    b.onMessage((body) => got.push(body));
    expect(got).toEqual([rematch(7)]);
  });

  it('nevalidní zprávu zahodí, zaloguje a pokračuje dalšími', async () => {
    const hub = new InMemoryHub({ clock });
    const { a, b } = await connectedPair(hub, clock);
    const got: SessionBody[] = [];
    b.onMessage((body) => got.push(body));
    a.send({ type: 'rematch', match: -5 } as unknown as SessionBody);
    a.send(rematch(2));
    await run(clock, 300);
    expect(got).toEqual([rematch(2)]);
    expect(console.warn).toHaveBeenCalledWith(
      '[peer] nevalidní zpráva zahozena',
      expect.anything(),
    );
  });
});

describe('Peer – bezpečnost a verze', () => {
  it('zprávu podvrženou třetí stranou (jiný klíč) zahodí', async () => {
    const hub = new InMemoryHub({ clock });
    const { b } = await connectedPair(hub, clock);
    const eve = hub.createTransport();
    await eve.open('ROOM1');
    const eveKey = await deriveSessionKey(
      await createKeyPair(),
      (await createKeyPair()).publicKey,
      'ROOM1',
    );
    const unsigned = {
      v: PROTOCOL_VERSION,
      type: 'session',
      from: A_ID,
      to: B_ID,
      kind: 'msg',
      seq: 0,
      ack: -1,
      body: rematch(1),
    };
    eve.send({ ...unsigned, mac: await signText(eveKey, canonicalJson(unsigned)) });
    const got: SessionBody[] = [];
    b.onMessage((body) => got.push(body));
    await run(clock, 200);
    expect(got).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith('[peer] zpráva s neplatným podpisem zahozena');
  });

  it('zpráva jiné verze protokolu ohlásí neshodu verzí', async () => {
    const hub = new InMemoryHub({ clock });
    const { b, ta } = await connectedPair(hub, clock);
    const mismatch = vi.fn();
    b.onVersionMismatch(mismatch);
    ta.send({ v: PROTOCOL_VERSION + 1, type: 'session', from: A_ID, to: B_ID, cokoli: true });
    await run(clock, 100);
    expect(mismatch).toHaveBeenCalledOnce();
  });
});

describe('Peer – živost spojení', () => {
  async function watched() {
    const hub = new InMemoryHub({ clock });
    const pair = await connectedPair(hub, clock);
    const statuses: PeerStatus[] = [];
    pair.b.onStatus((s) => statuses.push(s));
    return { ...pair, statuses };
  }

  it('po 5 s ticha je soupeř „ztracený“, po návratu zase v pořádku', async () => {
    const { ta, statuses } = await watched();
    await run(clock, 3000);
    expect(statuses).toEqual([]);
    ta.setConnected(false);
    await run(clock, 7000);
    expect(statuses).toEqual(['lost']);
    ta.setConnected(true);
    await run(clock, 3000);
    expect(statuses).toEqual(['lost', 'ok']);
  });

  it('po dalších 15 s bez spojení je soupeř pryč a spojení se zavře', async () => {
    const { ta, b, statuses } = await watched();
    ta.setConnected(false);
    await run(clock, 19_000, 250);
    expect(statuses).toEqual(['lost']);
    await run(clock, 2000, 250);
    expect(statuses).toEqual(['lost', 'gone']);
    expect(b.isClosed).toBe(true);
  });

  it('bye ukončí spojení okamžitě', async () => {
    const { a, b } = await watched();
    const bye = vi.fn();
    b.onBye(bye);
    void a.bye();
    await run(clock, 100);
    expect(bye).toHaveBeenCalledOnce();
    expect(a.isClosed).toBe(true);
    expect(b.isClosed).toBe(true);
    await settle();
  });
});
