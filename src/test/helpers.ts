import type { ManualClock } from '../core/util/clock';

type Immediate = (cb: () => void) => void;
const immediate: Immediate =
  (globalThis as unknown as { setImmediate?: Immediate }).setImmediate ??
  ((cb) => void setTimeout(cb, 0));

/**
 * Nechá doběhnout rozpracovanou asynchronní práci. Web Crypto v Node běží ve vláknovém
 * poolu, takže kromě mikroúloh potřebuje i kousek skutečného času (setTimeout(0) je na
 * Windows ~15 ms, proto točíme setImmediate).
 */
export async function settle(minMs = 1): Promise<void> {
  const end = performance.now() + minMs;
  let rounds = 0;
  do {
    await new Promise<void>((resolve) => immediate(resolve));
    rounds++;
  } while (rounds < 6 || performance.now() < end);
}

/** Posouvá ruční čas po krocích a mezi nimi nechá doběhnout asynchronní práci. */
export async function run(clock: ManualClock, ms: number, step = 50): Promise<void> {
  await settle();
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    clock.advance(Math.min(step, ms - elapsed));
    await settle();
  }
}
