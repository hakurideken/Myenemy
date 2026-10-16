import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { MatchFormat } from '../core/match/planMatch';
import {
  AIMemory,
  defineGame,
  type AnyMiniGameModule,
  type RenderFrame,
  type ViewContext,
} from '../core/MiniGame';
import { DRAW, win, type PlayerSlot } from '../core/types';
import { ManualClock } from '../core/util/clock';
import { commit } from '../core/util/commitReveal';
import { quickDraw } from '../games/quick-draw';
import { rps } from '../games/rps';
import { InMemoryHub, type InMemoryTransport } from '../net/InMemoryTransport';
import type { Peer } from '../net/Peer';
import type { SessionBody } from '../net/protocol';
import { HostRoom, joinRoom, newClientId, type Pairing } from '../net/room';
import { run } from '../test/helpers';
import { SeedExchange } from './exchanges';
import { OnlineSession, type OnlinePhase, type RoundMount } from './OnlineSession';

interface StubView {
  readonly ctx: ViewContext<unknown>;
  readonly renders: { view: unknown; frame: RenderFrame }[];
}

/** Skutečná hra, jen místo DOM se vykreslení zaznamenává. */
function stubbed(game: AnyMiniGameModule): { module: AnyMiniGameModule; views: StubView[] } {
  const views: StubView[] = [];
  const module: AnyMiniGameModule = {
    ...game,
    createView: (ctx) => {
      const entry: StubView = { ctx, renders: [] };
      views.push(entry);
      return {
        render: (view, frame) => {
          entry.renders.push({ view, frame });
        },
        destroy: () => undefined,
      };
    },
  };
  return { module, views };
}

const lastView = (views: StubView[], player: PlayerSlot): StubView => {
  const view = views.filter((v) => v.ctx.localPlayers[0] === player).at(-1);
  if (!view) throw new Error(`chybí pohled hráče ${player}`);
  return view;
};

/** Jednoduchá nezapečetěná hra: oba zvolí číslo, vyšší vyhrává. */
const pick = defineGame<
  { picks: Partial<Record<PlayerSlot, number>> },
  { n: number },
  { mine: number | null }
>({
  id: 'pick',
  name: 'Číslo',
  type: 'turn',
  length: 'quick',
  rules: ['test'],
  controls: () => ['test'],
  localLayout: 'shared',
  moveTimeoutMs: 1000,
  revealMs: 100,
  logic: {
    setup: () => ({ picks: {} }),
    toMove: (s) => (['A', 'B'] as const).filter((p) => s.picks[p] === undefined),
    legal: (s, p) => s.picks[p] === undefined,
    apply: (s, p, m) => ({ picks: { ...s.picks, [p]: m.n } }),
    outcome: (s) => {
      const { A, B } = s.picks;
      if (A === undefined || B === undefined) return null;
      return A === B ? DRAW : win(A > B ? 'A' : 'B');
    },
    view: (s, viewer) => ({ mine: s.picks[viewer] ?? null }),
  },
  moveSchema: z.object({ n: z.number().int() }),
  viewSchema: z.object({ mine: z.number().nullable() }),
  getAIMove: () => ({ n: 1 }),
  summarize: () => '',
  createView: () => ({ render: () => undefined, destroy: () => undefined }),
});

const mount = (): RoundMount => ({
  root: {} as HTMLElement,
  prefs: { reducedMotion: true },
  sfx: { play: () => undefined, vibrate: () => undefined },
  aiMemory: new AIMemory(),
  showTurnTimer: () => undefined,
});

/** Chová se jako UI: při fázi „playing“ kolo vykreslí, jinak ho uklidí. */
function autoMount(session: OnlineSession): void {
  let unmount: (() => void) | null = null;
  session.onPhase((phase) => {
    unmount?.();
    unmount = phase.name === 'playing' ? session.mountRound(mount()) : null;
  });
}

let clock: ManualClock;
let hub: InMemoryHub;
beforeEach(() => {
  clock = new ManualClock();
  hub = new InMemoryHub({ clock, latencyMs: 20 });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

async function pair(format: MatchFormat): Promise<{
  hostPairing: Pairing;
  guestPairing: Pairing;
  hostT: InMemoryTransport;
  guestT: InMemoryTransport;
}> {
  const hostT = hub.createTransport();
  const guestT = hub.createTransport();
  const room = await HostRoom.open({
    transport: hostT,
    clock,
    room: 'ABCDE',
    me: { id: newClientId(), nickname: 'Hostitel' },
    format,
  });
  let hostPairing: Pairing | null = null;
  room.onGuest((p) => (hostPairing = p));
  const joining = joinRoom({
    transport: guestT,
    clock,
    room: 'ABCDE',
    me: { id: newClientId(), nickname: 'Host' },
  });
  await run(clock, 300);
  const guestPairing = await joining;
  if (!hostPairing) throw new Error('hostitel nepřijal hosta');
  return { hostPairing, guestPairing, hostT, guestT };
}

async function sessions(
  games: AnyMiniGameModule[],
  format: MatchFormat,
  options: { mountGuest?: boolean } = {},
) {
  const p = await pair(format);
  const names = { A: 'Hostitel', B: 'Host' };
  const host = new OnlineSession({
    role: 'host',
    peer: p.hostPairing.peer,
    names,
    format,
    clock,
    games,
  });
  const guest = new OnlineSession({
    role: 'guest',
    peer: p.guestPairing.peer,
    names,
    format: p.guestPairing.format,
    clock,
    games,
  });
  autoMount(host);
  if (options.mountGuest !== false) autoMount(guest);
  await run(clock, 400);
  return { ...p, host, guest };
}

async function toPlaying(host: OnlineSession, guest: OnlineSession): Promise<void> {
  if (host.phase.name === 'lobby') host.startMatch();
  await run(clock, 200);
  host.setReady();
  guest.setReady();
  await run(clock, 300);
}

const phaseOf = (s: OnlineSession): OnlinePhase['name'] => s.phase.name;

describe('online zápas – průběh', () => {
  it('oba skončí v lobby se stejným pořadím her ze společného seedu', async () => {
    const { host, guest } = await sessions([pick, rps], {
      kind: 'vlastni',
      bestOf: 5,
      picks: 'random',
    });
    const h = host.phase;
    const g = guest.phase;
    if (h.name !== 'lobby' || g.name !== 'lobby') throw new Error(`fáze ${h.name}/${g.name}`);
    expect(g.plan.slots).toEqual(h.plan.slots);
    expect(h.plan.slots).toHaveLength(5);
  });

  it('kolo začne až ve chvíli, kdy jsou připravení oba', async () => {
    const { host, guest } = await sessions([pick], { kind: 'vlastni', bestOf: 1, picks: ['pick'] });
    host.startMatch();
    await run(clock, 200);
    expect([phaseOf(host), phaseOf(guest)]).toEqual(['intro', 'intro']);
    host.setReady();
    await run(clock, 300);
    expect(phaseOf(host)).toBe('intro');
    guest.setReady();
    await run(clock, 300);
    expect([phaseOf(host), phaseOf(guest)]).toEqual(['playing', 'playing']);
  });

  it('KNP: hostitel volbu hosta nevidí, dokud sám nezvolí; výsledek sedí u obou', async () => {
    const knp = stubbed(rps);
    const s = await sessions([knp.module], { kind: 'vlastni', bestOf: 3, picks: ['rps'] });
    const seenByHost: SessionBody[] = [];
    s.hostPairing.peer.onMessage((b) => seenByHost.push(b));
    await toPlaying(s.host, s.guest);

    lastView(knp.views, 'B').ctx.submit('B', { choice: 'rock' });
    await run(clock, 300);
    expect(JSON.stringify(seenByHost)).not.toContain('rock');
    const hostView = lastView(knp.views, 'A');
    expect(hostView.renders.at(-1)?.frame.committed).toEqual(['B']);

    hostView.ctx.submit('A', { choice: 'scissors' });
    await run(clock, 4000);
    expect(JSON.stringify(seenByHost)).toContain('rock');
    for (const session of [s.host, s.guest]) {
      const phase = session.phase;
      if (phase.name !== 'round-result') throw new Error(`fáze ${phase.name}`);
      expect(phase.report).toMatchObject({ kind: 'decided', winner: 'B' });
      expect(session.score).toEqual({ A: 0, B: 1 });
    }
  });

  it('Tasec: každý posílá vlastní změřený čas, pod 100 ms je předčasný výstřel', async () => {
    const qd = stubbed(quickDraw);
    const s = await sessions([qd.module], { kind: 'vlastni', bestOf: 3, picks: ['quick-draw'] });
    await toPlaying(s.host, s.guest);
    lastView(qd.views, 'A').ctx.submit('A', { kind: 'reacted', ms: 320 });
    lastView(qd.views, 'B').ctx.submit('B', { kind: 'reacted', ms: 40 });
    await run(clock, 3000);
    const phase = s.guest.phase;
    if (phase.name !== 'round-result') throw new Error(`fáze ${phase.name}`);
    expect(phase.report).toMatchObject({ winner: 'A' });
    expect(phase.result.summary).toContain('předčasně');
  });

  it('odveta ve stejné místnosti: nový seed a znovu lobby', async () => {
    const { host, guest } = await sessions([pick], { kind: 'vlastni', bestOf: 1, picks: ['pick'] });
    await toPlaying(host, guest);
    // Nikdo nehraje: hostitel zahraje automaticky (1 s), za hosta jeho klient – remíza 1:1.
    await run(clock, 2000);
    expect(phaseOf(host)).toBe('round-result');
    for (let i = 0; i < 4 && host.phase.name !== 'match-result'; i++) {
      host.continueAfterRound();
      guest.continueAfterRound();
      await toPlaying(host, guest);
      await run(clock, 2000);
    }
    host.continueAfterRound();
    guest.continueAfterRound();
    expect([phaseOf(host), phaseOf(guest)]).toEqual(['match-result', 'match-result']);
    host.requestRematch();
    await run(clock, 200);
    expect(phaseOf(host)).toBe('match-result');
    guest.requestRematch();
    await run(clock, 500);
    expect([phaseOf(host), phaseOf(guest)]).toEqual(['lobby', 'lobby']);
    expect(host.score).toEqual({ A: 0, B: 0 });
  });
});

describe('online zápas – odpojení a neaktivita', () => {
  it('odpojený host: po 5 s „ztracen“, po dalších 15 s výhra kontumací', async () => {
    const { host, guestT } = await sessions([pick], {
      kind: 'vlastni',
      bestOf: 3,
      picks: ['pick'],
    });
    host.startMatch();
    await run(clock, 200);
    const connection: boolean[] = [];
    host.onConnection((c) => connection.push(c.lost));
    guestT.setConnected(false);
    await run(clock, 6000, 250);
    expect(connection).toEqual([true]);
    expect(phaseOf(host)).toBe('intro');
    await run(clock, 15_000, 250);
    const phase = host.phase;
    if (phase.name !== 'match-result') throw new Error(`fáze ${phase.name}`);
    expect(phase).toMatchObject({ winner: 'A', reason: 'disconnect', canRematch: false });
  });

  it('host, který odejde, prohraje okamžitě', async () => {
    const { host, guest } = await sessions([pick], { kind: 'vlastni', bestOf: 3, picks: ['pick'] });
    host.startMatch();
    await run(clock, 200);
    void guest.leave();
    await run(clock, 200);
    expect(host.phase).toMatchObject({ name: 'match-result', winner: 'A', reason: 'left' });
  });

  it('odchod v lobby místnost zavře', async () => {
    const { host, guest } = await sessions([pick], { kind: 'vlastni', bestOf: 3, picks: ['pick'] });
    void guest.leave();
    await run(clock, 200);
    expect(host.phase).toMatchObject({ name: 'closed', reason: 'opponent-left' });
  });

  it('host, který 3× po sobě nereaguje, prohraje kontumací', async () => {
    const game = stubbed(pick);
    const s = await sessions(
      [game.module],
      { kind: 'vlastni', bestOf: 9, picks: 'random' },
      { mountGuest: false },
    );
    for (let round = 0; round < 3 && s.host.phase.name !== 'match-result'; round++) {
      await toPlaying(s.host, s.guest);
      lastView(game.views, 'A').ctx.submit('A', { n: 5 });
      // Host nic nevykreslil ani nezahrál – hostitel za něj zahraje po lhůtě + rezervě.
      await run(clock, 12_000, 250);
      if (s.host.phase.name === 'round-result') {
        s.host.continueAfterRound();
        s.guest.continueAfterRound();
      }
    }
    expect(s.host.phase).toMatchObject({ name: 'match-result', winner: 'A', reason: 'afk' });
    expect(s.guest.phase).toMatchObject({ name: 'match-result', winner: 'A', reason: 'afk' });
  });
});

describe('online zápas – podvody', () => {
  /** Host, který místo poctivého klienta posílá zprávy ze skriptu. */
  function scriptedGuest(peer: Peer, onRoundStart: (send: (body: SessionBody) => void) => void) {
    const send = (body: SessionBody): void => peer.send(body);
    const seeds = new SeedExchange('B', (m) =>
      send(
        m.kind === 'commit'
          ? { type: 'seed-commit', match: 1, hash: m.hash }
          : { type: 'seed-reveal', match: 1, seed: m.seed, salt: m.salt },
      ),
    );
    void seeds.result.catch(() => undefined);
    const received: SessionBody[] = [];
    peer.onMessage((body) => {
      received.push(body);
      if (body.type === 'seed-commit') seeds.receiveCommit(body.hash);
      if (body.type === 'seed-reveal') void seeds.receiveReveal(body.seed, body.salt);
      if (body.type === 'match-start') send({ type: 'ready', match: 1, gameNo: 1, replay: 0 });
      if (body.type === 'round-start') onRoundStart(send);
    });
    void seeds.start();
    return received;
  }

  it('host odhalí jiný tah, než ke kterému se zavázal → prohra kontumací', async () => {
    const knp = stubbed(rps);
    const format: MatchFormat = { kind: 'vlastni', bestOf: 3, picks: ['rps'] };
    const p = await pair(format);
    const host = new OnlineSession({
      role: 'host',
      peer: p.hostPairing.peer,
      names: { A: 'Hostitel', B: 'Host' },
      format,
      clock,
      games: [knp.module],
    });
    autoMount(host);
    let rockSalt = '';
    const received = scriptedGuest(p.guestPairing.peer, (send) => {
      void commit({ choice: 'rock' }).then((c) => {
        rockSalt = c.salt;
        send({
          type: 'game',
          match: 1,
          gameNo: 1,
          replay: 0,
          body: { kind: 'commit', player: 'B', hash: c.hash, auto: false },
        });
      });
    });
    await run(clock, 500);
    host.startMatch();
    host.setReady();
    await run(clock, 500);
    lastView(knp.views, 'A').ctx.submit('A', { choice: 'paper' });
    await run(clock, 300);
    expect(received.some((b) => b.type === 'game' && b.body.kind === 'reveal')).toBe(true);
    // Host viděl, že hostitel má papír – „odhalí“ nůžky se solí od kamene.
    p.guestPairing.peer.send({
      type: 'game',
      match: 1,
      gameNo: 1,
      replay: 0,
      body: { kind: 'reveal', player: 'B', move: { choice: 'scissors' }, salt: rockSalt },
    });
    await run(clock, 500);
    expect(host.phase).toMatchObject({ name: 'match-result', winner: 'A', reason: 'cheat' });
  });

  it('hostitel pošle jiné pořadí her, než vychází ze seedu → host to pozná', async () => {
    const format: MatchFormat = { kind: 'vlastni', bestOf: 3, picks: 'random' };
    const p = await pair(format);
    const guest = new OnlineSession({
      role: 'guest',
      peer: p.guestPairing.peer,
      names: { A: 'Hostitel', B: 'Host' },
      format,
      clock,
      games: [pick, rps],
    });
    const peer = p.hostPairing.peer;
    const seeds = new SeedExchange('A', (m) =>
      peer.send(
        m.kind === 'commit'
          ? { type: 'seed-commit', match: 1, hash: m.hash }
          : { type: 'seed-reveal', match: 1, seed: m.seed, salt: m.salt },
      ),
    );
    peer.onMessage((body) => {
      if (body.type === 'seed-commit') seeds.receiveCommit(body.hash);
      if (body.type === 'seed-reveal') void seeds.receiveReveal(body.seed, body.salt);
    });
    void seeds.start();
    await run(clock, 500);
    peer.send({
      type: 'match-setup',
      match: 1,
      format,
      slots: [
        { gameId: 'rps', picked: false },
        { gameId: 'rps', picked: false },
        { gameId: 'rps', picked: false },
      ],
    });
    await run(clock, 300);
    expect(guest.phase).toMatchObject({ name: 'match-result', winner: 'B', reason: 'cheat' });
  });
});
