import { afterEach, describe, expect, it } from 'vitest';
import { getGame } from '../games/registry';
import { InMemoryHub } from '../net/InMemoryTransport';
import {
  matchBody,
  SpectateCaster,
  SpectateReceiver,
  watchChannel,
  type SpectateBody,
} from './spectate';

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const base = matchBody({
  names: { A: 'Ondra', B: 'Petra' },
  score: { A: 1, B: 0 },
  phase: 'playing',
  current: { gameNo: 2, replay: 0, gameId: 'tic-tac-toe' },
  history: [
    { gameNo: 1, gameId: 'nim', replay: 0, outcome: { kind: 'win', winner: 'A' }, byCoin: false },
  ],
  winner: null,
});

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function pair(): Promise<{
  hub: InMemoryHub;
  caster: SpectateCaster;
  received: SpectateBody[];
}> {
  const hub = new InMemoryHub();
  const caster = await SpectateCaster.open(hub.createTransport());
  const received: SpectateBody[] = [];
  const receiver = await SpectateReceiver.open(
    hub.createTransport(),
    caster.token,
    caster.publicKey,
    (body) => received.push(body),
  );
  closers.push(
    () => caster.close(),
    () => receiver.close(),
  );
  return { hub, caster, received };
}

describe('sledování – vysílání a příjem', () => {
  it('divák dostane podepsaný snímek se stavem zápasu a pohledy', async () => {
    const { caster, received } = await pair();
    caster.update(base);
    caster.game({ views: { A: { x: 1 }, B: { x: 2 } }, finished: null });
    await wait(600);
    const last = received.at(-1);
    expect(last).toMatchObject({
      names: { A: 'Ondra', B: 'Petra' },
      score: { A: 1, B: 0 },
      game: { no: 2, id: 'tic-tac-toe' },
      history: [{ no: 1, id: 'nim', winner: 'A' }],
      views: { A: { x: 1 }, B: { x: 2 } },
    });
  });

  it('podvržený snímek (jiný klíč, změněná data, staré pořadí) divák zahodí', async () => {
    const { hub, caster, received } = await pair();
    caster.update(base);
    await wait(400);
    const count = received.length;
    expect(count).toBeGreaterThan(0);
    // Jiný divák se pokusí vysílat do stejného kanálu vlastním klíčem.
    const forger = await SpectateCaster.open(hub.createTransport());
    closers.push(() => forger.close());
    const intruder = hub.createTransport();
    await intruder.open(watchChannel(caster.token));
    closers.push(() => intruder.close());
    intruder.send({
      seq: 999,
      data: JSON.stringify({ ...base, score: { A: 0, B: 5 } }),
      sig: 'A'.repeat(86),
    });
    // Změněná data se starým podpisem.
    const captured: unknown[] = [];
    const spy = hub.createTransport();
    spy.onMessage((m) => captured.push(m));
    await spy.open(watchChannel(caster.token));
    closers.push(() => spy.close());
    caster.update({ ...base, score: { A: 2, B: 0 } });
    await wait(400);
    const real = captured.at(-1) as { seq: number; data: string; sig: string };
    intruder.send({ ...real, seq: real.seq + 1, data: real.data.replace('"A":2', '"A":9') });
    intruder.send({ ...real, seq: real.seq - 5 });
    await wait(200);
    expect(received.every((b) => b.score.B === 0 && b.score.A !== 9)).toBe(true);
  });

  it('nový divák se chytí díky opakování posledního snímku', async () => {
    const hub = new InMemoryHub();
    const caster = await SpectateCaster.open(hub.createTransport());
    closers.push(() => caster.close());
    caster.update(base);
    await wait(400);
    const received: SpectateBody[] = [];
    const late = await SpectateReceiver.open(
      hub.createTransport(),
      caster.token,
      caster.publicKey,
      (b) => received.push(b),
    );
    closers.push(() => late.close());
    await wait(3_400);
    expect(received.length).toBeGreaterThan(0);
  }, 10_000);

  it('neplatný token nebo klíč se vůbec neotevře', async () => {
    const hub = new InMemoryHub();
    await expect(
      SpectateReceiver.open(hub.createTransport(), 'krátký', 'x', () => undefined),
    ).rejects.toThrow();
  });
});

describe('sledování – divák nevidí soukromé údaje', () => {
  it('KNP: volba hráče je skrytá, dokud nezvolí oba', () => {
    const rps = getGame('rps');
    const policy = rps.spectator;
    if (!policy) throw new Error('KNP musí mít masku');
    const state = rps.logic.apply(
      rps.logic.setup({ rng: { next: () => 0 } as never, starter: 'A' }),
      'A',
      {
        choice: 'rock',
      },
    );
    const masked = policy.mask(rps.logic.view(state, 'A'), 'A') as { mine: unknown };
    expect(masked.mine).toBeNull();
  });

  it('hry hrané každým u sebe se nevysílají', () => {
    for (const id of [
      'quick-draw',
      'reflex',
      'click-battle',
      'sequence',
      'spot-change',
      'digit-flash',
    ]) {
      expect(getGame(id).spectator, id).toBe(false);
    }
  });
});

describe('sledování – vysílá se jen, když se někdo dívá', () => {
  it('bez diváka kanál mlčí, po ozvání diváka dorazí snímek hned', async () => {
    const hub = new InMemoryHub();
    const caster = await SpectateCaster.open(hub.createTransport());
    closers.push(() => caster.close());
    const sniffed: unknown[] = [];
    const sniffer = hub.createTransport();
    sniffer.onMessage((m) => sniffed.push(m));
    await sniffer.open(watchChannel(caster.token));
    closers.push(() => sniffer.close());
    caster.update(base);
    await wait(700);
    expect(sniffed).toHaveLength(0);
    const received: SpectateBody[] = [];
    const viewer = await SpectateReceiver.open(
      hub.createTransport(),
      caster.token,
      caster.publicKey,
      (b) => received.push(b),
    );
    closers.push(() => viewer.close());
    await wait(300);
    expect(received.length).toBeGreaterThan(0);
  });

  it('Oko bere: vlastní rozhodnutí hráče divák vidí jen jako „rozhodnuto“', () => {
    const oko = getGame('oko-bere');
    const policy = oko.spectator;
    if (!policy) throw new Error('Oko bere musí mít masku');
    const view = { decisions: { A: 'stand', B: null } } as never;
    const masked = policy.mask(view, 'A') as { decisions: Record<string, unknown> };
    expect(masked.decisions).toEqual({ A: 'decided', B: null });
  });
});
