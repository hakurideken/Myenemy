import { describe, expect, it } from 'vitest';
import { settle } from '../test/helpers';
import {
  CheatError,
  SealedExchange,
  SecretExchange,
  SeedExchange,
  type SealedMessage,
  type SecretMessage,
  type SeedMessage,
} from './exchanges';

describe('společný seed (commit-reveal)', () => {
  function wire(tamper?: (m: SeedMessage) => SeedMessage) {
    const log: string[] = [];
    const peers: { a?: SeedExchange; b?: SeedExchange } = {};
    const deliver = (to: 'a' | 'b', who: string) => (m: SeedMessage) => {
      log.push(`${who}:${m.kind}`);
      const msg = who === 'B' && tamper ? tamper(m) : m;
      queueMicrotask(() => {
        const target = peers[to];
        if (!target) return;
        if (msg.kind === 'commit') target.receiveCommit(msg.hash);
        else void target.receiveReveal(msg.seed, msg.salt);
      });
    };
    const a = new SeedExchange('A', deliver('b', 'A'));
    const b = new SeedExchange('B', deliver('a', 'B'));
    peers.a = a;
    peers.b = b;
    return { a, b, log };
  }

  it('oba dojdou ke stejnému seedu; odhaluje se až po závazku soupeře', async () => {
    const { a, b, log } = wire();
    void a.start();
    await settle();
    expect(log).toEqual(['A:commit']);
    void b.start();
    await settle();
    const [seedA, seedB] = await Promise.all([a.result, b.result]);
    expect(seedA).toMatch(/^[0-9a-f]{64}$/);
    expect(seedA).toBe(seedB);
    expect(log.indexOf('A:reveal')).toBeGreaterThan(log.indexOf('B:commit'));
  });

  it('seed odlišný od závazku se pozná jako podvod', async () => {
    const { a, b } = wire((m) => (m.kind === 'reveal' ? { ...m, seed: 'f'.repeat(32) } : m));
    const outcome = a.result.catch((err: unknown) => err);
    void b.result.catch(() => undefined);
    void a.start();
    void b.start();
    await settle();
    expect(await outcome).toBeInstanceOf(CheatError);
  });

  it('odhalení bez závazku je podvod', async () => {
    const ex = new SeedExchange('A', () => undefined);
    const outcome = ex.result.catch((err: unknown) => err);
    await ex.receiveReveal('a'.repeat(32), 'b'.repeat(64));
    expect(await outcome).toBeInstanceOf(CheatError);
  });
});

describe('zapečetěný tah', () => {
  it('hostitel se tah hosta dozví až po vlastním závazku', async () => {
    const toHost: SealedMessage[] = [];
    const toGuest: SealedMessage[] = [];
    const host = new SealedExchange('A', (m) => toGuest.push(m));
    const guest = new SealedExchange('B', (m) => toHost.push(m));

    await guest.seal({ choice: 'rock' }, false);
    expect(toHost.map((m) => m.kind)).toEqual(['commit']);
    expect(JSON.stringify(toHost)).not.toContain('rock');

    const guestCommit = toHost[0];
    if (guestCommit?.kind !== 'commit') throw new Error('čekal jsem commit');
    host.receiveCommit(guestCommit.hash);
    await host.seal({ choice: 'paper' }, false);
    expect(toGuest.map((m) => m.kind)).toEqual(['commit', 'reveal']);

    const hostCommit = toGuest[0];
    if (hostCommit?.kind !== 'commit') throw new Error('čekal jsem commit');
    guest.receiveCommit(hostCommit.hash);
    expect(toHost.map((m) => m.kind)).toEqual(['commit', 'reveal']);

    const guestReveal = toHost[1];
    const hostReveal = toGuest[1];
    if (guestReveal?.kind !== 'reveal' || hostReveal?.kind !== 'reveal') throw new Error('reveal');
    expect(await host.receiveReveal(guestReveal.move, guestReveal.salt)).toBe(true);
    expect(await guest.receiveReveal(hostReveal.move, hostReveal.salt)).toBe(true);
    expect(host.opponentMove).toEqual({ move: { choice: 'rock' } });
    expect(guest.opponentMove).toEqual({ move: { choice: 'paper' } });
  });

  it('odhalení jiného tahu, než byl závazek, neprojde', async () => {
    const toHost: SealedMessage[] = [];
    const host = new SealedExchange('A', () => undefined);
    const guest = new SealedExchange('B', (m) => toHost.push(m));
    await guest.seal({ choice: 'rock' }, false);
    const c = toHost[0];
    if (c?.kind !== 'commit') throw new Error('commit');
    host.receiveCommit(c.hash);
    guest.receiveCommit('a'.repeat(64));
    const reveal = toHost[1];
    if (reveal?.kind !== 'reveal') throw new Error('reveal');
    expect(await host.receiveReveal({ choice: 'paper' }, reveal.salt)).toBe(false);
    expect(host.opponentMove).toBeNull();
  });
});

describe('tajná data hry (závazek na začátku, odhalení na konci)', () => {
  function pairUp() {
    const sent: SecretMessage[] = [];
    const a = new SecretExchange('A', (m) => sent.push(m));
    const b = new SecretExchange('B', () => undefined);
    return { a, b, sent };
  }

  it('odhalení sedí se závazkem; před odhalením je vidět jen otisk', async () => {
    const { a, b, sent } = pairUp();
    await a.commit({ code: [1, 2, 3, 4] });
    const first = sent[0];
    if (first?.kind !== 'secret-commit') throw new Error('chybí závazek');
    expect(JSON.stringify(first)).not.toContain('[1,2,3,4]');
    expect(b.receiveCommit(first.hash)).toBe(true);
    expect(b.receiveCommit('f'.repeat(64))).toBe(false);
    const waiting = b.waitReveal(() => undefined);
    a.reveal();
    a.reveal();
    expect(sent.filter((m) => m.kind === 'secret-reveal')).toHaveLength(1);
    const reveal = sent[1];
    if (reveal?.kind !== 'secret-reveal') throw new Error('chybí odhalení');
    await b.receiveReveal(reveal.secret, reveal.salt);
    expect(await waiting).toEqual({ kind: 'ok', secret: { code: [1, 2, 3, 4] } });
  });

  it('jiná data než v závazku = nesoulad; bez odhalení = chybí', async () => {
    const { a, b, sent } = pairUp();
    await a.commit([0, 0, 0, 0]);
    const first = sent[0];
    if (first?.kind !== 'secret-commit') throw new Error('chybí závazek');
    b.receiveCommit(first.hash);
    a.reveal();
    const reveal = sent[1];
    if (reveal?.kind !== 'secret-reveal') throw new Error('chybí odhalení');
    await b.receiveReveal([1, 1, 1, 1], reveal.salt);
    expect(await b.waitReveal(() => undefined)).toEqual({ kind: 'mismatch' });

    const c = new SecretExchange('B', () => undefined);
    c.receiveCommit(first.hash);
    let timeout: () => void = () => undefined;
    const waiting = c.waitReveal((cb) => (timeout = cb));
    await settle();
    timeout();
    expect(await waiting).toEqual({ kind: 'missing' });
  });

  it('závazek jde poslat jen jednou', async () => {
    const { a } = pairUp();
    await a.commit(1);
    await expect(a.commit(2)).rejects.toThrow();
    expect(a.ownSecret).toBe(1);
  });
});
