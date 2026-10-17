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
import { createRng } from '../core/util/rng';
import { logik } from '../games/logik';
import { okoBere } from '../games/oko-bere';
import type { OkoView } from '../games/oko-bere/logic';
import { pexeso } from '../games/pexeso';
import { pexesoAIMove } from '../games/pexeso/ai';
import type { PexesoView } from '../games/pexeso/logic';
import { prsi } from '../games/prsi';
import type { LogikMove } from '../games/logik/logic';
import { quickDraw } from '../games/quick-draw';
import { rps } from '../games/rps';
import { InMemoryHub, type InMemoryTransport } from '../net/InMemoryTransport';
import type { Peer } from '../net/Peer';
import type { SessionBody } from '../net/protocol';
import { HostRoom, joinRoom, newClientId, type Pairing } from '../net/room';
import { run, runUntil, settle, settledFlag } from '../test/helpers';
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
  const joined = settledFlag(joining);
  await runUntil(clock, () => hostPairing !== null && joined());
  const guestPairing = await joining;
  if (!hostPairing) throw new Error('hostitel nepřijal hosta');
  return { hostPairing, guestPairing, hostT, guestT };
}

async function sessions(
  games: AnyMiniGameModule[],
  format: MatchFormat,
  options: { mountGuest?: boolean; guestGames?: AnyMiniGameModule[] } = {},
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
    games: options.guestGames ?? games,
  });
  autoMount(host);
  if (options.mountGuest !== false) autoMount(guest);
  // Výměna seedu (kryptografie) – posouvat čas, dokud nejsou oba v lobby.
  await runUntil(clock, () => host.phase.name !== 'seeding' && guest.phase.name !== 'seeding');
  await run(clock, 100);
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

describe('online zápas – skrytá informace (Logik)', () => {
  const LOGIK: MatchFormat = { kind: 'vlastni', bestOf: 1, picks: ['logik'] };
  const hidden = logik.hidden;
  if (!hidden) throw new Error('Logik musí mít skrytou informaci');

  /** Klient, který při odpovídání lže (vždy „nic netrefil“). */
  function lying(game: AnyMiniGameModule): AnyMiniGameModule {
    if (!hidden) throw new Error('chybí hidden');
    return {
      ...game,
      hidden: {
        ...hidden,
        respond: (view, player, secret) => {
          const move = hidden.respond(view, player, secret);
          return (move as LogikMove | null)?.kind === 'feedback'
            ? { kind: 'feedback', black: 0, white: 0 }
            : move;
        },
      },
    };
  }

  const gameBodies = (bodies: SessionBody[], kind: string): number =>
    bodies.filter((b) => b.type === 'game' && b.body.kind === kind).length;

  async function chooseCodes(lkViews: StubView[], a: number[], b: number[]): Promise<void> {
    lastView(lkViews, 'A').ctx.submitSecret('A', a);
    lastView(lkViews, 'B').ctx.submitSecret('B', b);
    await run(clock, 500);
  }

  it('kódy se zavážou předem, odhalí až po konci a výsledek sedí u obou', async () => {
    const lk = stubbed(logik);
    const s = await sessions([lk.module], LOGIK);
    const seenByHost: SessionBody[] = [];
    s.hostPairing.peer.onMessage((b) => seenByHost.push(b));
    await toPlaying(s.host, s.guest);
    await chooseCodes(lk.views, [0, 0, 0, 0], [1, 1, 1, 1]);
    expect(gameBodies(seenByHost, 'secret-commit')).toBe(1);
    expect(gameBodies(seenByHost, 'secret-reveal')).toBe(0);
    expect(JSON.stringify(seenByHost)).not.toContain('[1,1,1,1]');

    lastView(lk.views, 'A').ctx.submit('A', { kind: 'guess', code: [1, 1, 1, 1] });
    lastView(lk.views, 'B').ctx.submit('B', { kind: 'guess', code: [2, 2, 2, 2] });
    await run(clock, 4000);
    expect(gameBodies(seenByHost, 'secret-reveal')).toBe(1);
    for (const session of [s.host, s.guest]) {
      const phase = session.phase;
      if (phase.name !== 'round-result') throw new Error(`fáze ${phase.name}`);
      expect(phase.report).toMatchObject({ kind: 'decided', winner: 'A' });
    }
  });

  it('host lže v odpovědích → hostitel to po odhalení kódu pozná', async () => {
    const host = stubbed(logik);
    const guest = stubbed(lying(logik));
    const s = await sessions([host.module], LOGIK, { guestGames: [guest.module] });
    await toPlaying(s.host, s.guest);
    lastView(host.views, 'A').ctx.submitSecret('A', [0, 0, 0, 0]);
    lastView(guest.views, 'B').ctx.submitSecret('B', [1, 1, 1, 1]);
    await run(clock, 500);
    lastView(host.views, 'A').ctx.submit('A', { kind: 'guess', code: [1, 1, 1, 1] });
    lastView(guest.views, 'B').ctx.submit('B', { kind: 'guess', code: [0, 0, 0, 0] });
    await run(clock, 4000);
    expect(s.host.phase).toMatchObject({ name: 'match-result', winner: 'A', reason: 'cheat' });
    expect(s.guest.phase).toMatchObject({ name: 'match-result', winner: 'A', reason: 'cheat' });
  });

  it('hostitel lže v odpovědích → host to po odhalení kódu pozná', async () => {
    const host = stubbed(lying(logik));
    const guest = stubbed(logik);
    const s = await sessions([host.module], LOGIK, { guestGames: [guest.module] });
    await toPlaying(s.host, s.guest);
    lastView(host.views, 'A').ctx.submitSecret('A', [0, 0, 0, 0]);
    lastView(guest.views, 'B').ctx.submitSecret('B', [1, 1, 1, 1]);
    await run(clock, 500);
    lastView(host.views, 'A').ctx.submit('A', { kind: 'guess', code: [1, 1, 1, 1] });
    lastView(guest.views, 'B').ctx.submit('B', { kind: 'guess', code: [0, 0, 0, 0] });
    await run(clock, 4000);
    expect(s.guest.phase).toMatchObject({ name: 'match-result', winner: 'B', reason: 'cheat' });
    if (s.guest.phase.name === 'match-result') {
      expect(s.guest.phase.detail).toContain('odpovídal v rozporu');
    }
  });

  it('hostitel pozmění odpověď hosta → host to pozná', async () => {
    const honest = stubbed(logik);
    const tampered: AnyMiniGameModule = {
      ...honest.module,
      // Podvádějící hostitel samozřejmě nekontroluje sám sebe.
      hidden: { ...hidden, consistent: () => true },
      logic: {
        ...logik.logic,
        // Hostitel si odpověď hosta „vylepší“ na prolomený kód.
        apply: (state, player, move) =>
          logik.logic.apply(
            state,
            player,
            player === 'B' && (move as LogikMove).kind === 'feedback'
              ? { kind: 'feedback', black: 4, white: 0 }
              : move,
          ),
      },
    };
    const s = await sessions([tampered], LOGIK, { guestGames: [honest.module] });
    await toPlaying(s.host, s.guest);
    await chooseCodes(honest.views, [0, 0, 0, 0], [1, 1, 1, 1]);
    lastView(honest.views, 'A').ctx.submit('A', { kind: 'guess', code: [3, 3, 3, 3] });
    lastView(honest.views, 'B').ctx.submit('B', { kind: 'guess', code: [2, 2, 2, 2] });
    await run(clock, 4000);
    expect(s.guest.phase).toMatchObject({ name: 'match-result', winner: 'B', reason: 'cheat' });
    if (s.guest.phase.name === 'match-result') {
      expect(s.guest.phase.detail).toContain('pozměnil');
    }
  });

  it('hostitel začne hru bez závazku ke kódu → host to pozná hned', async () => {
    const honest = stubbed(logik);
    const noCommit: AnyMiniGameModule = {
      ...honest.module,
      logic: {
        ...logik.logic,
        setup: (env) => {
          const state = logik.logic.setup(env) as { ready: Record<PlayerSlot, boolean> };
          return { ...state, ready: { A: true, B: false } };
        },
      },
    };
    const s = await sessions([noCommit], LOGIK, { guestGames: [honest.module] });
    await toPlaying(s.host, s.guest);
    lastView(honest.views, 'B').ctx.submitSecret('B', [1, 1, 1, 1]);
    await run(clock, 500);
    expect(s.guest.phase).toMatchObject({ name: 'match-result', winner: 'B', reason: 'cheat' });
  });

  it('host, který nezvolí kód ani po lhůtě, prohraje kontumací', async () => {
    const lk = stubbed(logik);
    const s = await sessions([lk.module], LOGIK, { mountGuest: false });
    await toPlaying(s.host, s.guest);
    lastView(lk.views, 'A').ctx.submitSecret('A', [0, 0, 0, 0]);
    await run(clock, 71_000, 1000);
    expect(s.host.phase).toMatchObject({ name: 'match-result', winner: 'A', reason: 'afk' });
  });
});

describe('online zápas – karty (mental poker)', () => {
  /** Čeká na podmínku; ruční čas posouvá po malých krocích (kryptografie běží opravdu). */
  async function until(cond: () => boolean, label: string, maxSteps = 4000): Promise<void> {
    for (let i = 0; i < maxSteps && !cond(); i++) {
      clock.advance(5);
      await settle(1);
    }
    if (!cond()) throw new Error(`nedočkal jsem se: ${label}`);
  }

  const frameOf = (views: StubView[], player: PlayerSlot): RenderFrame | undefined =>
    lastView(views, player).renders.at(-1)?.frame;

  const cardsReady = (views: StubView[]): boolean =>
    (['A', 'B'] as const).every((p) => frameOf(views, p)?.cards != null);

  it('Pexeso: oba míchají, otáčí se přes klíče obou a výsledek i audit sedí', async () => {
    const pex = stubbed(pexeso);
    const s = await sessions([pex.module], { kind: 'vlastni', bestOf: 1, picks: ['pexeso'] });
    await toPlaying(s.host, s.guest);
    await until(() => cardsReady(pex.views), 'zamíchaný balíček');
    const rng = createRng('pexeso-online');
    const memory = new AIMemory();

    for (let flips = 0; flips < 400 && s.host.phase.name === 'playing'; flips++) {
      const player = (['A', 'B'] as const).find((p) => frameOf(pex.views, p)?.canAct.includes(p));
      if (!player) {
        clock.advance(20);
        await settle(1);
        continue;
      }
      const view = lastView(pex.views, player).renders.at(-1)?.view as PexesoView;
      // Hraje jako těžká AI (pamatuje si všechno, co bylo vidět).
      const move = pexesoAIMove(view, { difficulty: 'hard', rng, me: player, memory });
      const before = view.moves;
      lastView(pex.views, player).ctx.submit(player, move);
      await until(
        () =>
          (lastView(pex.views, player).renders.at(-1)?.view as PexesoView).moves > before ||
          s.host.phase.name !== 'playing',
        'otočení',
      );
    }
    await until(
      () => s.host.phase.name === 'round-result' && s.guest.phase.name === 'round-result',
      'konec kola',
    );
    const h = s.host.phase;
    const g = s.guest.phase;
    if (h.name !== 'round-result' || g.name !== 'round-result') throw new Error('fáze');
    expect(g.result.outcome).toEqual(h.result.outcome);
  });

  it('Oko bere: rozhodnutí jsou zapečetěná, karty soupeře se odhalí až na konci', async () => {
    const oko = stubbed(okoBere);
    const s = await sessions([oko.module], { kind: 'vlastni', bestOf: 1, picks: ['oko-bere'] });
    const seenByHost: SessionBody[] = [];
    s.hostPairing.peer.onMessage((b) => seenByHost.push(b));
    await toPlaying(s.host, s.guest);
    await until(
      () =>
        (frameOf(oko.views, 'A')?.cards?.has(0) ?? false) &&
        (frameOf(oko.views, 'B')?.cards?.has(1) ?? false),
      'první karty',
    );

    // Každý zná jen svou kartu (A pozice 0, B pozice 1).
    expect([...(frameOf(oko.views, 'A')?.cards?.keys() ?? [])]).toEqual([0]);
    expect([...(frameOf(oko.views, 'B')?.cards?.keys() ?? [])]).toEqual([1]);

    lastView(oko.views, 'B').ctx.submit('B', { kind: 'stand' });
    await until(() => frameOf(oko.views, 'A')?.committed.includes('B') ?? false, 'závazek hosta');
    // Hostitel ví jen, že se host rozhodl – ne jak.
    expect(seenByHost.some((b) => b.type === 'game' && b.body.kind === 'move')).toBe(false);
    expect(seenByHost.some((b) => b.type === 'game' && b.body.kind === 'reveal')).toBe(false);

    lastView(oko.views, 'A').ctx.submit('A', { kind: 'draw' });
    await until(
      () => (lastView(oko.views, 'A').renders.at(-1)?.view as OkoView).hands.A.length === 2,
      'líznutí hostitele',
    );
    await until(() => frameOf(oko.views, 'A')?.cards?.has(2) ?? false, 'karta hostitele');
    expect(frameOf(oko.views, 'B')?.cards?.has(2)).toBe(false);
    // Host už stojí – hostitel hraje sám (bez pečetění), dokud nestojí taky nebo nepřetáhne.
    if (frameOf(oko.views, 'A')?.canAct.includes('A')) {
      lastView(oko.views, 'A').ctx.submit('A', { kind: 'stand' });
    }
    await until(
      () => s.host.phase.name === 'round-result' && s.guest.phase.name === 'round-result',
      'konec kola',
    );
    const finalB = lastView(oko.views, 'B').renders.at(-1)?.view as OkoView;
    expect(finalB.shown).toHaveLength(3);
    const h = s.host.phase;
    const g = s.guest.phase;
    if (h.name !== 'round-result' || g.name !== 'round-result') throw new Error('fáze');
    expect(g.result.outcome).toEqual(h.result.outcome);
  });

  it('Prší: host vyloží kartu, kterou nemůže doložit klíčem → prohra kontumací', async () => {
    const game = stubbed(prsi);
    const s = await sessions([game.module], { kind: 'vlastni', bestOf: 1, picks: ['prsi'] });
    await toPlaying(s.host, s.guest);
    await until(() => cardsReady(game.views), 'zamíchaný balíček');
    // Pozice 4–7 jsou ruka hosta; klíč k ní hostitel nemá, tvrzení nejde ověřit.
    s.guestPairing.peer.send({
      type: 'game',
      match: 1,
      gameNo: 1,
      replay: 0,
      body: { kind: 'move', move: { kind: 'play', pos: 4, card: 31, suit: null }, auto: false },
    });
    await until(() => s.host.phase.name === 'match-result', 'kontumace');
    expect(s.host.phase).toMatchObject({ name: 'match-result', winner: 'A', reason: 'cheat' });
  });

  it('host, který se v Oko bere nerozhodne, prohraje kontumací', async () => {
    const oko = stubbed(okoBere);
    const s = await sessions(
      [oko.module],
      { kind: 'vlastni', bestOf: 1, picks: ['oko-bere'] },
      { mountGuest: false },
    );
    await toPlaying(s.host, s.guest);
    await until(() => frameOf(oko.views, 'A')?.cards != null, 'zamíchaný balíček');
    lastView(oko.views, 'A').ctx.submit('A', { kind: 'stand' });
    await run(clock, 41_000, 1000);
    expect(s.host.phase).toMatchObject({ name: 'match-result', winner: 'A', reason: 'afk' });
  });
});
