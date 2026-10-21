import { describe, expect, it } from 'vitest';
import { AIMemory } from '../../core/MiniGame';
import { DIFFICULTIES, DRAW, win, type Difficulty, type PlayerSlot } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { consistentCodes, logikAIMove } from './ai';
import {
  ALL_CODES,
  cracked,
  logikHidden,
  logikLogic as logic,
  MAX_ROUNDS,
  scoreGuess,
  type Code,
  type LogikMove,
  type LogikState,
  type Mark,
} from './logic';

const CODES: Record<PlayerSlot, Code> = { A: [0, 1, 2, 3], B: [5, 5, 4, 0] };

function play(state: LogikState, player: PlayerSlot, move: LogikMove): LogikState {
  expect(logic.legal(state, player, move)).toBe(true);
  return logic.apply(state, player, move);
}

/** Automatické tahy z tajných kódů (připraven, odpovědi). */
function respondAll(state: LogikState, codes = CODES): LogikState {
  let s = state;
  for (;;) {
    const next = logic
      .toMove(s)
      .map((p) => [p, logikHidden.respond(logic.view(s, p), p, codes[p])] as const)
      .find(([, move]) => move !== null);
    if (!next?.[1]) return s;
    s = play(s, next[0], next[1]);
  }
}

const started = (): LogikState => respondAll(logic.setup({ rng: createRng('lk'), starter: 'A' }));

/** Jedno kolo: oba tipnou, pak automatické odpovědi. */
const round = (s: LogikState, a: Code, b: Code): LogikState =>
  respondAll(play(play(s, 'A', { kind: 'guess', code: a }), 'B', { kind: 'guess', code: b }));

describe('Logik – vyhodnocení', () => {
  it.each([
    [
      [0, 1, 2, 3],
      [0, 1, 2, 3],
      ['exact', 'exact', 'exact', 'exact'],
    ],
    [
      [0, 0, 1, 1],
      [1, 1, 0, 0],
      ['color', 'color', 'color', 'color'],
    ],
    [
      [0, 0, 0, 0],
      [0, 1, 1, 1],
      ['exact', 'none', 'none', 'none'],
    ],
    [
      [1, 1, 0, 0],
      [0, 1, 2, 2],
      ['none', 'exact', 'color', 'none'],
    ],
    [
      [5, 4, 3, 2],
      [0, 1, 0, 1],
      ['none', 'none', 'none', 'none'],
    ],
    // Opakovaná barva: „jen barva“ zleva nejvýš tolikrát, kolikrát v kódu zbývá.
    [
      [0, 0, 1, 2],
      [2, 0, 0, 0],
      ['color', 'exact', 'none', 'color'],
    ],
    [
      [3, 3, 3, 0],
      [0, 3, 1, 1],
      ['none', 'exact', 'none', 'color'],
    ],
  ])('%j proti %j = %j', (guess, secret, marks) => {
    expect(scoreGuess(guess, secret)).toEqual(marks);
  });

  it('1296 kódů, konzistentní množina se zužuje', () => {
    expect(ALL_CODES).toHaveLength(1296);
    const left = consistentCodes([
      { code: [0, 0, 1, 1], feedback: scoreGuess([0, 0, 1, 1], CODES.B) },
    ]);
    expect(left.length).toBeLessThan(400);
    expect(left).toContainEqual(CODES.B);
  });
});

describe('Logik – průběh', () => {
  it('hádá se až po volbě kódů obou; tipují oba, odpovídá se až po obou tipech', () => {
    const s0 = logic.setup({ rng: createRng('a'), starter: 'B' });
    expect(logic.toMove(s0)).toEqual(['B', 'A']);
    expect(logic.legal(s0, 'A', { kind: 'guess', code: [0, 0, 0, 0] })).toBe(false);
    let s = respondAll(s0);
    expect(logic.toMove(s)).toEqual(['B', 'A']);
    s = play(s, 'A', { kind: 'guess', code: [1, 1, 1, 1] });
    // B dluží odpověď, ale nejdřív musí sám tipnout.
    expect(logic.toMove(s)).toEqual(['B']);
    expect(logic.legal(s, 'B', { kind: 'feedback', marks: ['none', 'none', 'none', 'none'] })).toBe(
      false,
    );
    expect(logikHidden.respond(s, 'B', CODES.B)).toBeNull();
    s = play(s, 'B', { kind: 'guess', code: [2, 2, 2, 2] });
    expect(logic.toMove(s)).toEqual(['B', 'A']);
    s = respondAll(s);
    expect(s.guesses.A[0]?.feedback).toEqual(['none', 'none', 'none', 'none']);
    expect(s.guesses.B[0]?.feedback).toEqual(['none', 'none', 'exact', 'none']);
  });

  it('kdo prolomí kód dřív, vyhrává; ve stejném kole je remíza', () => {
    const s = round(started(), [0, 0, 0, 0], CODES.A);
    expect(logic.outcome(s)).toEqual(win('B'));
    expect(logikHidden.outcome(s)).toEqual(win('B'));
    expect(logic.outcome(round(started(), CODES.B, CODES.A))).toEqual(DRAW);
  });

  it('po 10 kolech bez prolomení je remíza', () => {
    let s = started();
    for (let i = 0; i < MAX_ROUNDS; i++) {
      expect(logic.outcome(s)).toBeNull();
      s = round(s, [3, 3, 3, 3], [4, 4, 4, 4]);
    }
    expect(logic.outcome(s)).toEqual(DRAW);
    expect(logic.toMove(s)).toEqual([]);
  });

  it('nemožná odpověď je neplatná', () => {
    let s = started();
    s = play(play(s, 'A', { kind: 'guess', code: [5, 5, 4, 1] }), 'B', {
      kind: 'guess',
      code: [0, 0, 0, 0],
    });
    const legal = (...marks: Mark[]) => logic.legal(s, 'B', { kind: 'feedback', marks });
    expect(legal('exact', 'exact', 'exact', 'color')).toBe(false);
    // Jediná pětka v kódu sedí na 1. místě, 2. pětka tedy nemůže být „jen barva“.
    expect(legal('exact', 'color', 'exact', 'exact')).toBe(false);
    expect(legal('exact', 'exact', 'exact', 'none')).toBe(true);
    expect(legal('color', 'none', 'none', 'none')).toBe(true);
  });

  it('lež v odpovědi se po odhalení kódu pozná', () => {
    let s = started();
    s = play(play(s, 'A', { kind: 'guess', code: CODES.B }), 'B', {
      kind: 'guess',
      code: [0, 0, 0, 0],
    });
    s = play(s, 'B', { kind: 'feedback', marks: ['none', 'none', 'none', 'none'] }); // lež – A uhodl
    s = respondAll(s);
    expect(logikHidden.consistent(s, 'B', CODES.B)).toBe(false);
    expect(logikHidden.consistent(s, 'A', CODES.A)).toBe(true);
  });
});

describe('Logik – AI', () => {
  function guessesToCrack(difficulty: Difficulty, secret: Code, seed: string): number {
    const rng = createRng(seed);
    const codes: Record<PlayerSlot, Code> = { A: [0, 0, 0, 0], B: secret };
    let s = respondAll(logic.setup({ rng, starter: 'A' }), codes);
    while (logic.outcome(s) === null) {
      const move = logikAIMove(logic.view(s, 'A'), {
        difficulty,
        rng,
        me: 'A',
        memory: new AIMemory(),
      });
      s = play(s, 'A', move);
      s = respondAll(play(s, 'B', { kind: 'guess', code: [5, 5, 5, 5] }), codes);
    }
    const last = s.guesses.A.at(-1);
    return cracked(last) ? s.guesses.A.length : MAX_ROUNDS + 1;
  }

  it.each(DIFFICULTIES)('%s vrací platný tip', (difficulty) => {
    const rng = createRng(`v-${difficulty}`);
    const move = logikAIMove(started(), { difficulty, rng, me: 'A', memory: new AIMemory() });
    expect(move.kind).toBe('guess');
  });

  it('těžká AI prolomí každý kód nejvýš na 7 pokusů, v průměru pod 5', () => {
    const rng = createRng('codes');
    let total = 0;
    const samples = 25;
    for (let i = 0; i < samples; i++) {
      const secret = rng.pick(ALL_CODES);
      const n = guessesToCrack('hard', secret, `hard-${i}`);
      expect(n).toBeLessThanOrEqual(7);
      total += n;
    }
    expect(total / samples).toBeLessThan(5);
  });

  it('střední AI hraje vždy konzistentně a prolomí kód do 10 pokusů', () => {
    const rng = createRng('codes-m');
    for (let i = 0; i < 15; i++) {
      expect(guessesToCrack('medium', rng.pick(ALL_CODES), `m-${i}`)).toBeLessThanOrEqual(
        MAX_ROUNDS,
      );
    }
  });
});
