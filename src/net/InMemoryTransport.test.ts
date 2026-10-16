import { describe, expect, it } from 'vitest';
import { ManualClock } from '../core/util/clock';
import { createRng } from '../core/util/rng';
import { InMemoryHub } from './InMemoryTransport';
import { OPEN_TIMEOUT_MS, TransportUnavailableError } from './Transport';

describe('InMemoryTransport', () => {
  it('doručí zprávu ostatním v místnosti (ne sobě, ne jiné místnosti) jako kopii', async () => {
    const clock = new ManualClock();
    const hub = new InMemoryHub({ clock, latencyMs: 30 });
    const [a, b, c] = [hub.createTransport(), hub.createTransport(), hub.createTransport()];
    await a.open('ROOM1');
    await b.open('ROOM1');
    await c.open('ROOM2');
    const got: { who: string; msg: unknown }[] = [];
    for (const [who, t] of [
      ['a', a],
      ['b', b],
      ['c', c],
    ] as const) {
      t.onMessage((msg) => got.push({ who, msg }));
    }
    const original = { x: 1 };
    a.send(original);
    clock.advance(29);
    expect(got).toEqual([]);
    clock.advance(1);
    expect(got).toEqual([{ who: 'b', msg: { x: 1 } }]);
    expect(got[0]?.msg).not.toBe(original);
  });

  it('při výpadku serveru open() selže nejpozději po 5 s', async () => {
    const clock = new ManualClock();
    const hub = new InMemoryHub({ clock });
    hub.available = false;
    const opening = hub.createTransport().open('ROOM1');
    let error: unknown = null;
    opening.catch((err: unknown) => (error = err));
    clock.advance(OPEN_TIMEOUT_MS - 1);
    await Promise.resolve();
    expect(error).toBeNull();
    clock.advance(1);
    await Promise.resolve();
    expect(error).toBeInstanceOf(TransportUnavailableError);
  });

  it('odpojený hráč nic neposílá ani nepřijímá; ztrátovost zprávy zahazuje', async () => {
    const clock = new ManualClock();
    const hub = new InMemoryHub({ clock, dropRate: 0.5, rng: createRng('drop') });
    const a = hub.createTransport();
    const b = hub.createTransport();
    await a.open('R');
    await b.open('R');
    let count = 0;
    b.onMessage(() => count++);
    for (let i = 0; i < 200; i++) a.send(i);
    clock.advance(1);
    expect(count).toBeGreaterThan(60);
    expect(count).toBeLessThan(140);
    b.setConnected(false);
    const before = count;
    a.send('x');
    clock.advance(1);
    expect(count).toBe(before);
  });
});
