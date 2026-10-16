import { describe, expect, it } from 'vitest';
import { ManualClock } from './clock';

describe('ManualClock', () => {
  it('spouští časovače v pořadí a posouvá čas', () => {
    const clock = new ManualClock();
    const log: string[] = [];
    clock.setTimeout(() => log.push(`b@${clock.now()}`), 200);
    clock.setTimeout(() => log.push(`a@${clock.now()}`), 100);
    clock.advance(150);
    expect(log).toEqual(['a@100']);
    clock.advance(100);
    expect(log).toEqual(['a@100', 'b@200']);
    expect(clock.now()).toBe(250);
  });

  it('zrušený časovač se nespustí a časovače naplánované uvnitř běží', () => {
    const clock = new ManualClock();
    const log: number[] = [];
    const handle = clock.setTimeout(() => log.push(1), 50);
    clock.clearTimeout(handle);
    clock.setTimeout(() => clock.setTimeout(() => log.push(2), 10), 20);
    clock.advance(100);
    expect(log).toEqual([2]);
    expect(clock.pending).toBe(0);
  });
});
