import { describe, expect, it } from 'vitest';
import { settle } from '../test/helpers';
import {
  CheatError,
  SealedExchange,
  SeedExchange,
  type SealedMessage,
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
