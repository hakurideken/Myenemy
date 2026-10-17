import { describe, expect, it } from 'vitest';
import type { PlayerSlot } from '../core/types';
import { settle } from '../test/helpers';
import { MentalPokerDealer, type PokerMessage } from './MentalPokerDealer';

/** Dva rozdávající propojení přímo (zprávy doručené asynchronně, ve správném pořadí). */
function pair(
  deckSize = 8,
  tamper?: (from: PlayerSlot, m: PokerMessage) => PokerMessage,
): {
  dealers: Record<PlayerSlot, MentalPokerDealer>;
  cheats: string[];
} {
  const cheats: string[] = [];
  const dealers = {} as Record<PlayerSlot, MentalPokerDealer>;
  const wire = (from: PlayerSlot, to: PlayerSlot) => (m: PokerMessage) => {
    const msg = tamper ? tamper(from, m) : m;
    setTimeout(() => dealers[to].receive(msg), 0);
  };
  dealers.A = new MentalPokerDealer('A', deckSize, wire('A', 'B'), (d) => cheats.push(`A: ${d}`));
  dealers.B = new MentalPokerDealer('B', deckSize, wire('B', 'A'), (d) => cheats.push(`B: ${d}`));
  dealers.A.start();
  return { dealers, cheats };
}

async function untilReady(dealers: Record<PlayerSlot, MentalPokerDealer>): Promise<void> {
  await Promise.all([dealers.A.ready(), dealers.B.ready()]);
}

describe('mental poker – protokol dvou hráčů', () => {
  it('soukromé líznutí: kartu zná jen ten, komu soupeř poslal klíč', async () => {
    const { dealers, cheats } = pair();
    await untilReady(dealers);
    const entitled = { A: [0, 1], B: [2] };
    dealers.A.entitle(entitled);
    dealers.B.entitle(entitled);
    await settle(20);
    expect(cheats).toEqual([]);
    expect([...dealers.A.known('A').keys()]).toEqual([0, 1]);
    expect([...dealers.B.known('B').keys()]).toEqual([2]);
    // B nemá klíč A k pozicím 0 a 1 – jejich kartu nezná.
    expect(dealers.B.peek([0])).toBeNull();
    expect(dealers.A.peek([2])).toBeNull();
  });

  it('veřejné odhalení zná každý a tvrzení o kartě jde ověřit', async () => {
    const { dealers, cheats } = pair();
    await untilReady(dealers);
    const entitled = { A: [0, 5], B: [5] };
    dealers.A.entitle(entitled);
    dealers.B.entitle(entitled);
    await settle(20);
    const atA = dealers.A.peek([5]);
    const atB = dealers.B.peek([5]);
    expect(atA).not.toBeNull();
    expect(atB).toEqual(atA);
    const card0 = dealers.A.known('A').get(0) ?? -1;
    // B ověří „vyložení“ karty 0 až s klíčem A.
    expect(dealers.B.check([{ pos: 0, card: card0 }])).toBe(false);
    dealers.A.reveal([0]);
    await settle(20);
    expect(dealers.B.check([{ pos: 0, card: card0 }])).toBe(true);
    expect(dealers.B.check([{ pos: 0, card: (card0 + 1) % 8 }])).toBe(false);
    expect(cheats).toEqual([]);
  });

  it('audit na konci: balíček obsahoval každou kartu právě jednou', async () => {
    const { dealers } = pair();
    await untilReady(dealers);
    dealers.A.sendAudit();
    dealers.B.sendAudit();
    const never = (): void => undefined;
    const [a, b] = await Promise.all([dealers.A.waitAudit(never), dealers.B.waitAudit(never)]);
    expect(a).toBeNull();
    expect(b).toBeNull();
  });

  it('podvržený klíč ke kartě se pozná hned', async () => {
    const { dealers, cheats } = pair(8, (from, m) =>
      from === 'B' && m.kind === 'card-keys'
        ? { ...m, keys: m.keys.map((k) => ({ ...k, key: '1234567' })) }
        : m,
    );
    await untilReady(dealers);
    dealers.B.entitle({ A: [0], B: [] });
    await settle(20);
    expect(cheats).toEqual(['A: Klíč od soupeře neodemyká platnou kartu.']);
  });

  it('zdvojená karta při míchání se pozná (balíček s duplicitou)', async () => {
    const { dealers, cheats } = pair(8, (from, m) => {
      if (from !== 'B' || m.kind !== 'deck' || m.stage !== 2) return m;
      const cards = [...m.cards];
      cards[1] = cards[0] ?? '';
      return { ...m, cards };
    });
    await expect(
      Promise.race([untilReady(dealers), settle(200).then(() => 'timeout')]),
    ).resolves.toBe('timeout');
    expect(cheats).toEqual(['A: Soupeř poslal neplatný zašifrovaný balíček.']);
  });
});
