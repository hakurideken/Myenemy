import { describe, expect, it } from 'vitest';
import { DRAW, win } from '../types';
import { createRng } from '../util/rng';
import { MatchController, MAX_DRAW_REPLAYS } from './MatchController';
import type { BestOf, MatchPlan } from './planMatch';

const plan = (bestOf: BestOf): MatchPlan => ({
  format: { kind: 'vlastni', bestOf, picks: 'random' },
  bestOf,
  winsNeeded: (bestOf + 1) / 2,
  slots: Array.from({ length: bestOf }, (_, i) => ({ gameId: `g${i + 1}`, picked: false })),
});

const controller = (bestOf: BestOf, seed = 'm'): MatchController =>
  new MatchController(plan(bestOf), createRng(seed));

describe('MatchController', () => {
  it('best of 5 končí při 3 výhrách – zbylé hry se nehrají', () => {
    const m = controller(5);
    expect(m.current()).toMatchObject({ gameId: 'g1', gameNo: 1, maxGames: 5, replay: 0 });
    expect(m.report(win('A'))).toEqual({
      kind: 'decided',
      winner: 'A',
      byCoin: false,
      matchWinner: null,
    });
    expect(m.current().gameId).toBe('g2');
    m.report(win('A'));
    const last = m.report(win('A'));
    expect(last).toEqual({ kind: 'decided', winner: 'A', byCoin: false, matchWinner: 'A' });
    expect(m.isOver).toBe(true);
    expect(m.winner).toBe('A');
    expect(m.endReason).toBe('score');
    expect(m.score).toEqual({ A: 3, B: 0 });
    expect(() => m.current()).toThrow();
  });

  it('střídavé výsledky dojdou až k poslední hře', () => {
    const m = controller(5);
    for (const w of ['A', 'B', 'A', 'B'] as const) m.report(win(w));
    expect(m.current()).toMatchObject({ gameId: 'g5', gameNo: 5 });
    expect(m.report(win('B'))).toMatchObject({ matchWinner: 'B' });
    expect(m.score).toEqual({ A: 2, B: 3 });
  });

  it('remíza se nepočítá: stejná hra, stejné pořadí, zvýší se jen počítadlo rozhodujících kol', () => {
    const m = controller(3);
    expect(m.report(DRAW)).toEqual({ kind: 'replay', replay: 1 });
    expect(m.current()).toMatchObject({ gameId: 'g1', gameNo: 1, replay: 1 });
    expect(m.score).toEqual({ A: 0, B: 0 });
    m.report(win('B'));
    expect(m.current()).toMatchObject({ gameId: 'g2', gameNo: 2, replay: 0 });
  });

  it(`po ${MAX_DRAW_REPLAYS} rozhodujících kolech rozhodne los a počítá se jako výhra`, () => {
    const m = controller(3);
    for (let i = 1; i <= MAX_DRAW_REPLAYS; i++) {
      expect(m.report(DRAW)).toEqual({ kind: 'replay', replay: i });
    }
    const result = m.report(DRAW);
    expect(result.kind).toBe('decided');
    if (result.kind !== 'decided') return;
    expect(result.byCoin).toBe(true);
    expect(m.score[result.winner]).toBe(1);
    expect(m.current()).toMatchObject({ gameNo: 2, replay: 0 });
    const history = m.history;
    expect(history).toHaveLength(MAX_DRAW_REPLAYS + 2);
    expect(history.at(-1)).toMatchObject({ byCoin: true, outcome: win(result.winner) });
  });

  it('los je deterministický podle seedu a padá na obě strany', () => {
    const coin = (seed: string): string => {
      const m = controller(1, seed);
      for (let i = 0; i <= MAX_DRAW_REPLAYS; i++) m.report(DRAW);
      return m.winner ?? '';
    };
    expect(coin('s1')).toBe(coin('s1'));
    const winners = new Set(Array.from({ length: 30 }, (_, i) => coin(`seed-${i}`)));
    expect(winners).toEqual(new Set(['A', 'B']));
  });

  it('začínající hráč se střídá mezi hrami i rozhodujícími koly', () => {
    const m = controller(5);
    const s1 = m.current().starter;
    m.report(DRAW);
    const s2 = m.current().starter;
    m.report(win('A'));
    const s3 = m.current().starter;
    expect(s2).not.toBe(s1);
    expect(s3).not.toBe(s2);
  });

  it('kontumace ukončí zápas s důvodem', () => {
    const m = controller(5);
    m.report(win('A'));
    m.forfeit('A', 'disconnect');
    expect(m.winner).toBe('B');
    expect(m.endReason).toBe('disconnect');
    m.forfeit('B', 'cheat');
    expect(m.winner).toBe('B');
  });

  it('best of 1 rozhodne jediná výhra', () => {
    const m = controller(1);
    expect(m.report(win('B'))).toMatchObject({ matchWinner: 'B' });
  });
});
