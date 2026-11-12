import { describe, expect, it, vi } from 'vitest';
import { bracketLayout } from '../ui/components/bracket';
import {
  createTournamentApi,
  eliminated,
  entrantName,
  myReadyMatch,
  normalizeTournamentCode,
  placements,
  roundKind,
  tournamentStateSchema,
  type TournamentState,
} from './tournament';

/** Odpověď tournament_state ve tvaru z databáze (4 hráči, 2 lidé + 2 AI). */
function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const player = (slot: number, nickname: string, ai = false, me = false) => ({
    slot,
    nickname,
    tag: ai ? slot : 42,
    ai,
    gone: false,
    online: true,
    me,
    organizer: me,
  });
  const match = (round: number, idx: number, a: number | null, b: number | null, extra = {}) => ({
    round,
    idx,
    a,
    b,
    status: a !== null && b !== null ? 'ready' : 'waiting',
    winner: null,
    score_a: null,
    score_b: null,
    how: null,
    room: null,
    reported: false,
    replays: 0,
    ...extra,
  });
  return {
    id: '00000000-0000-4000-8000-000000000001',
    code: 'K7PX2M',
    status: 'running',
    size: 4,
    organizer: true,
    me: 0,
    players: [
      player(0, 'Pepa', false, true),
      player(1, 'AI', true),
      player(2, 'Ema'),
      player(3, 'AI', true),
    ],
    matches: [
      match(1, 0, 0, 1),
      match(1, 1, 2, 3, { status: 'done', winner: 2, score_a: 5, score_b: 3, how: 'played' }),
      match(2, 0, null, 2),
      match(2, 1, null, 3),
    ],
    ...overrides,
  };
}

const parse = (data: Record<string, unknown>): TournamentState => tournamentStateSchema.parse(data);

describe('turnaj – stav ze serveru', () => {
  it('schéma převede skóre na camelCase a pozná můj připravený zápas', () => {
    const s = parse(raw());
    expect(s.matches[1]).toMatchObject({ scoreA: 5, scoreB: 3, winner: 2, how: 'played' });
    expect(myReadyMatch(s)).toMatchObject({ round: 1, idx: 0, a: 0, b: 1 });
  });

  it('odmítne nesmyslná data (cizí kód místnosti, pozice mimo pavouk)', () => {
    const bad = raw();
    (bad.matches as Record<string, unknown>[])[0]!.room = '<img>';
    expect(() => parse(bad)).toThrow();
    expect(() => parse(raw({ me: 16 }))).toThrow();
    expect(() => parse(raw({ size: 5 }))).toThrow();
  });

  it('v lobby nemám připravený zápas', () => {
    expect(myReadyMatch(parse(raw({ status: 'lobby', me: null })))).toBeNull();
  });

  it('vyřazení: prohra v semifinále posílá ještě do zápasu o 3. místo', () => {
    const s = parse(
      raw({
        matches: [
          {
            ...((raw().matches as object[])[0] as object),
            status: 'done',
            winner: 1,
            how: 'played',
          },
          (raw().matches as object[])[1],
          (raw().matches as object[])[2],
          (raw().matches as object[])[3],
        ],
      }),
    );
    // Velikost 4: kolo 1 je semifinále – prohra v něm ještě nevyřazuje.
    expect(eliminated(s, 0)).toBe(false);
    const big = parse(raw({ size: 8 }));
    expect(eliminated(big, 0)).toBe(false);
  });

  it('pořadí po finále a o 3. místo', () => {
    const done = (r: number, i: number, a: number, b: number, w: number) => ({
      round: r,
      idx: i,
      a,
      b,
      status: 'done',
      winner: w,
      score_a: 5,
      score_b: 2,
      how: 'played',
      room: null,
      reported: false,
      replays: 0,
    });
    const s = parse(
      raw({
        status: 'finished',
        matches: [
          done(1, 0, 0, 1, 0),
          done(1, 1, 2, 3, 2),
          done(2, 0, 0, 2, 2),
          done(2, 1, 1, 3, 3),
        ],
      }),
    );
    expect(placements(s)).toEqual({ first: 2, second: 0, third: 3 });
  });

  it('názvy kol a jména účastníků', () => {
    expect(roundKind(4, 0, 4)).toBe('final');
    expect(roundKind(4, 1, 4)).toBe('third');
    expect(roundKind(3, 0, 4)).toBe('semi');
    expect(roundKind(2, 0, 4)).toBe('quarter');
    expect(roundKind(1, 0, 4)).toBe('eighth');
    const s = parse(raw());
    expect(entrantName(s.players[1] ?? null, 'AI')).toBe('AI 1');
    expect(entrantName(s.players[0] ?? null, 'AI')).toBe('Pepa');
  });

  it('kód turnaje: malá písmena, mezery a pomlčky projdou, I/O/0/1 ne', () => {
    expect(normalizeTournamentCode(' k7p-x2m ')).toBe('K7PX2M');
    expect(normalizeTournamentCode('K7PX2')).toBeNull();
    expect(normalizeTournamentCode('K7PXO1')).toBeNull();
  });
});

describe('turnaj – volání serveru', () => {
  it('posílá správné funkce a parametry, odpovědi kontroluje schématem', async () => {
    const call = vi.fn((fn: string) => {
      switch (fn) {
        case 'tournament_create':
          return Promise.resolve('K7PX2M');
        case 'tournament_join':
          return Promise.resolve('joined');
        case 'tournament_report':
          return Promise.resolve('pending');
        case 'tournament_state':
          return Promise.resolve(null);
        default:
          return Promise.resolve(null);
      }
    });
    const api = createTournamentApi(call);
    expect(await api.create()).toEqual({ kind: 'created', code: 'K7PX2M' });
    expect(await api.join('K7PX2M')).toBe('joined');
    expect(await api.state()).toBeNull();
    expect(await api.report({ round: 1, idx: 0 }, 0, 5, 3)).toBe('pending');
    expect(call).toHaveBeenCalledWith(
      'tournament_report',
      { p_round: 1, p_idx: 0, p_winner: 0, p_score_a: 5, p_score_b: 3 },
      true,
    );
    call.mockImplementationOnce(() => Promise.resolve('hacked'));
    await expect(api.join('K7PX2M')).rejects.toThrow();
  });
});

describe('rozvržení pavouka', () => {
  it.each([4, 8, 16] as const)(
    '%i hráčů: zápas je uprostřed mezi svými dvěma předchůdci',
    (size) => {
      const layout = bracketLayout(size);
      expect(layout.rounds).toBe(size === 4 ? 2 : size === 8 ? 3 : 4);
      for (let r = 2; r <= layout.rounds; r++) {
        const count = size >> r;
        for (let i = 0; i < count; i++) {
          expect(layout.center(r, i)).toBe(
            (layout.center(r - 1, 2 * i) + layout.center(r - 1, 2 * i + 1)) / 2,
          );
        }
      }
      // Zápas o 3. místo je pod finále a vejde se do výšky.
      expect(layout.center(layout.rounds, 1)).toBeGreaterThan(layout.center(layout.rounds, 0) + 40);
      expect(layout.height).toBeGreaterThan(layout.center(layout.rounds, 1) + 26);
      expect(layout.column(2)).toBeGreaterThan(layout.column(1));
    },
  );
});
