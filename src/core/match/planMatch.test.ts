import { describe, expect, it } from 'vitest';
import type { GameInfo } from '../MiniGame';
import type { GameLength } from '../types';
import { createRng } from '../util/rng';
import {
  drawSequence,
  isFormatAvailable,
  MatchFormatError,
  planMatch,
  type MatchFormat,
} from './planMatch';

const game = (id: string, length: GameLength): GameInfo => ({ id, name: id, type: 'turn', length });
const QUICK = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'].map((id) => game(id, 'quick'));
const LONG = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'].map((id) => game(id, 'long'));
const ALL = [...QUICK, ...LONG];

const ids = (format: MatchFormat, games = ALL, seed = 'plan'): string[] =>
  planMatch(format, games, createRng(seed)).slots.map((s) => s.gameId);

const unique = (xs: readonly string[]): boolean => new Set(xs).size === xs.length;

describe('planMatch – předvolby', () => {
  it('rychlovka: best of 5 z rychlých her bez opakování, na 3 výhry', () => {
    const plan = planMatch({ kind: 'rychlovka' }, ALL, createRng('r'));
    expect(plan.bestOf).toBe(5);
    expect(plan.winsNeeded).toBe(3);
    expect(plan.slots).toHaveLength(5);
    expect(plan.slots.every((s) => s.gameId.startsWith('q') && !s.picked)).toBe(true);
    expect(unique(plan.slots.map((s) => s.gameId))).toBe(true);
  });

  it('velký souboj: best of 3 z delších her bez opakování, na 2 výhry', () => {
    const plan = planMatch({ kind: 'velky-souboj' }, ALL, createRng('v'));
    expect(plan.bestOf).toBe(3);
    expect(plan.winsNeeded).toBe(2);
    expect(plan.slots.map((s) => s.gameId).every((id) => id.startsWith('l'))).toBe(true);
    expect(unique(plan.slots.map((s) => s.gameId))).toBe(true);
  });

  it('je deterministický pro stejný seed a liší se pro jiný', () => {
    expect(ids({ kind: 'rychlovka' }, ALL, 'x')).toEqual(ids({ kind: 'rychlovka' }, ALL, 'x'));
    const variants = new Set(
      ['a', 'b', 'c', 'd', 'e'].map((s) => ids({ kind: 'rychlovka' }, ALL, s).join()),
    );
    expect(variants.size).toBeGreaterThan(1);
  });

  it('bez her dané délky formát není dostupný a planMatch vyhodí chybu', () => {
    expect(isFormatAvailable('velky-souboj', QUICK)).toBe(false);
    expect(isFormatAvailable('rychlovka', QUICK)).toBe(true);
    expect(() => planMatch({ kind: 'velky-souboj' }, QUICK, createRng('x'))).toThrow(
      MatchFormatError,
    );
  });

  it('při malé nabídce se hry opakují, ale nikdy dvakrát za sebou', () => {
    const small = QUICK.slice(0, 2);
    for (const seed of ['1', '2', '3', '4', '5', '6']) {
      const seq = ids({ kind: 'rychlovka' }, small, seed);
      expect(seq).toHaveLength(5);
      for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    }
  });
});

describe('planMatch – vlastní výběr', () => {
  it('náhodně ze všech: N her bez opakování z obou délek', () => {
    const plan = planMatch({ kind: 'vlastni', bestOf: 9, picks: 'random' }, ALL, createRng('n'));
    expect(plan.slots).toHaveLength(9);
    expect(plan.winsNeeded).toBe(5);
    expect(unique(plan.slots.map((s) => s.gameId))).toBe(true);
  });

  it('vybrané hry jdou v pořadí výběru a zbytek se doplní náhodně bez opakování', () => {
    const plan = planMatch(
      { kind: 'vlastni', bestOf: 5, picks: ['l3', 'q1'] },
      ALL,
      createRng('p'),
    );
    expect(plan.slots.slice(0, 2)).toEqual([
      { gameId: 'l3', picked: true },
      { gameId: 'q1', picked: true },
    ]);
    const filled = plan.slots.slice(2);
    expect(filled.every((s) => !s.picked)).toBe(true);
    expect(unique(plan.slots.map((s) => s.gameId))).toBe(true);
  });

  it('když hostitel vybere všech N her, nic se nelosuje', () => {
    const plan = planMatch(
      { kind: 'vlastni', bestOf: 3, picks: ['q2', 'l1', 'q5'] },
      ALL,
      createRng('p'),
    );
    expect(plan.slots.map((s) => s.gameId)).toEqual(['q2', 'l1', 'q5']);
    expect(plan.slots.every((s) => s.picked)).toBe(true);
  });

  it('best of 1', () => {
    const plan = planMatch({ kind: 'vlastni', bestOf: 1, picks: ['l2'] }, ALL, createRng('p'));
    expect(plan.winsNeeded).toBe(1);
    expect(plan.slots).toEqual([{ gameId: 'l2', picked: true }]);
  });

  it('odmítne neplatný výběr', () => {
    const rng = createRng('e');
    expect(() => planMatch({ kind: 'vlastni', bestOf: 1, picks: ['q1', 'q2'] }, ALL, rng)).toThrow(
      MatchFormatError,
    );
    expect(() => planMatch({ kind: 'vlastni', bestOf: 3, picks: ['q1', 'q1'] }, ALL, rng)).toThrow(
      /jen jednou/,
    );
    expect(() => planMatch({ kind: 'vlastni', bestOf: 3, picks: ['nope'] }, ALL, rng)).toThrow(
      /Neznámá hra/,
    );
    expect(() => planMatch({ kind: 'vlastni', bestOf: 4 as 3, picks: 'random' }, ALL, rng)).toThrow(
      MatchFormatError,
    );
  });

  it('s malou nabídkou se doplní opakováním, ne bezprostředně po sobě', () => {
    const plan = planMatch(
      { kind: 'vlastni', bestOf: 5, picks: ['q1'] },
      QUICK.slice(0, 2),
      createRng('s'),
    );
    const seq = plan.slots.map((s) => s.gameId);
    expect(seq).toHaveLength(5);
    expect(seq[0]).toBe('q1');
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  });
});

describe('drawSequence', () => {
  it('nevylosuje už použité hry, dokud nabídka nedojde', () => {
    const seq = drawSequence(['a', 'b', 'c', 'd'], 2, createRng('d'), ['a', 'b']);
    expect([...seq].sort()).toEqual(['c', 'd']);
  });

  it('prázdná nabídka je chyba, nulový počet ne', () => {
    expect(drawSequence([], 0, createRng('x'))).toEqual([]);
    expect(() => drawSequence([], 1, createRng('x'))).toThrow(MatchFormatError);
  });
});
