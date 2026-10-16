import { describe, expect, it } from 'vitest';
import { AIMemory } from '../../core/MiniGame';
import { DRAW, win, type Difficulty, type PlayerSlot } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { capturingLines, dotsAIMove, giveaway, isSafe, solveEndgame } from './ai';
import {
  BOX_COUNT,
  BOX_LINES,
  boxIndex,
  dotsLogic as logic,
  hLine,
  LINE_BOXES,
  LINE_COUNT,
  vLine,
  type DotsState,
  type Owner,
} from './logic';

const fresh = (starter: PlayerSlot = 'A'): DotsState =>
  logic.setup({ rng: createRng('x'), starter });

const drawAll = (s: DotsState, lines: number[]): DotsState =>
  lines.reduce((acc, line) => logic.apply(acc, acc.turn, { line }), s);

describe('Tečky a čtverečky – geometrie', () => {
  it('40 čar, 16 políček; každé políčko má 4 čáry, krajní čáry 1 políčko, vnitřní 2', () => {
    expect(LINE_COUNT).toBe(40);
    expect(BOX_COUNT).toBe(16);
    expect(BOX_LINES[boxIndex(0, 0)]).toEqual([hLine(0, 0), hLine(1, 0), vLine(0, 0), vLine(0, 1)]);
    expect(LINE_BOXES[hLine(0, 0)]).toEqual([0]);
    expect(LINE_BOXES[hLine(1, 0)]).toEqual([0, 4]);
    expect(LINE_BOXES[vLine(0, 4)]).toEqual([3]);
    expect(LINE_BOXES.every((b) => b.length === 1 || b.length === 2)).toBe(true);
  });
});

describe('Tečky a čtverečky – pravidla', () => {
  it('uzavřené políčko dá bod a další tah, jinak se střídá', () => {
    let s = drawAll(fresh('A'), [hLine(0, 0), hLine(1, 0), vLine(0, 0)]);
    expect(s.turn).toBe('B');
    s = logic.apply(s, 'B', { line: vLine(0, 1) });
    expect(s.boxes[0]).toBe('B');
    expect(s.score).toEqual({ A: 0, B: 1 });
    expect(s.turn).toBe('B');
  });

  it('jedna čára může uzavřít dvě políčka najednou', () => {
    // Políčka 0 a 1 mají vše kromě společné svislé čáry.
    const around = [hLine(0, 0), hLine(1, 0), vLine(0, 0), hLine(0, 1), hLine(1, 1), vLine(0, 2)];
    let s = drawAll(fresh('A'), around);
    const player = s.turn;
    s = logic.apply(s, player, { line: vLine(0, 1) });
    expect(s.score[player]).toBe(2);
  });

  it('nakreslenou čáru nejde kreslit znovu ani mimo pořadí', () => {
    const s = logic.apply(fresh('A'), 'A', { line: 5 });
    expect(logic.legal(s, 'B', { line: 5 })).toBe(false);
    expect(logic.legal(s, 'A', { line: 6 })).toBe(false);
  });

  it('po zaplnění vyhrává víc políček, 8:8 je remíza', () => {
    const full = (a: number): DotsState => ({
      ...fresh(),
      lines: Array.from({ length: LINE_COUNT }, (): Owner => 'A'),
      boxes: Array.from({ length: BOX_COUNT }, (_, i): Owner => (i < a ? 'A' : 'B')),
      score: { A: a, B: BOX_COUNT - a },
    });
    expect(logic.outcome(full(9))).toEqual(win('A'));
    expect(logic.outcome(full(8))).toEqual(DRAW);
    expect(logic.outcome(full(3))).toEqual(win('B'));
    expect(logic.toMove(full(8))).toEqual([]);
  });
});

describe('Tečky a čtverečky – AI', () => {
  it('pozná uzavíratelná políčka, bezpečné čáry a cenu oběti', () => {
    const s = drawAll(fresh(), [hLine(0, 0), hLine(1, 0), vLine(0, 0)]);
    expect(capturingLines(s.lines)).toEqual([vLine(0, 1)]);
    expect(isSafe(s.lines, vLine(0, 1))).toBe(false);
    expect(isSafe(s.lines, hLine(4, 3))).toBe(true);
    // Oběť: čára dá soupeři řetězec dvou políček 0 a 1.
    const chain = drawAll(fresh(), [
      hLine(0, 0),
      hLine(1, 0),
      vLine(0, 0),
      hLine(0, 1),
      hLine(1, 1),
    ]);
    expect(giveaway(chain.lines, vLine(0, 2))).toBe(2);
  });

  it('přesné řešení koncovky odpovídá skutečnému výsledku při hře obou podle něj', () => {
    const rng = createRng('endgame');
    for (let round = 0; round < 6; round++) {
      // Náhodná rozehraná pozice s 12 volnými čarami.
      let s = fresh(round % 2 === 0 ? 'A' : 'B');
      while (s.lines.filter((l) => l === null).length > 12) {
        const free = s.lines.flatMap((l, i) => (l === null ? [i] : []));
        s = logic.apply(s, s.turn, { line: rng.pick(free) });
      }
      const mover = s.turn;
      const predicted = Math.max(...solveEndgame(s.lines).map((x) => x.value));
      const before = s.score[mover] - s.score[mover === 'A' ? 'B' : 'A'];
      while (logic.outcome(s) === null) {
        const scored = solveEndgame(s.lines);
        const best = Math.max(...scored.map((x) => x.value));
        s = logic.apply(s, s.turn, { line: scored.find((x) => x.value === best)?.line ?? -1 });
      }
      const after = s.score[mover] - s.score[mover === 'A' ? 'B' : 'A'];
      expect(after - before).toBe(predicted);
    }
  });

  const match = (a: Difficulty, b: Difficulty, seed: string, starter: PlayerSlot) => {
    const rng = createRng(seed);
    let s = fresh(starter);
    while (logic.outcome(s) === null) {
      const me = s.turn;
      const move = dotsAIMove(logic.view(s, me), {
        difficulty: me === 'A' ? a : b,
        rng,
        me,
        memory: new AIMemory(),
      });
      expect(logic.legal(s, me, move)).toBe(true);
      s = logic.apply(s, me, move);
    }
    return logic.outcome(s);
  };

  it('těžká porazí střední většinu zápasů a střední lehkou', () => {
    let hard = 0;
    let medium = 0;
    for (let i = 0; i < 10; i++) {
      const starter: PlayerSlot = i % 2 === 0 ? 'A' : 'B';
      const h = match('hard', 'medium', `hm-${i}`, starter);
      if (h?.kind === 'win' && h.winner === 'A') hard++;
      const m = match('medium', 'easy', `me-${i}`, starter);
      if (m?.kind === 'win' && m.winner === 'A') medium++;
    }
    expect(hard).toBeGreaterThanOrEqual(7);
    expect(medium).toBeGreaterThanOrEqual(7);
  });
});
