import { describe, expect, it } from 'vitest';
import { AIMemory, type AIContext } from '../../core/MiniGame';
import { DRAW, win, type Difficulty, type PlayerSlot } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { DUCK_SKILL, duckAIDelay, duckAIMove } from './ai';
import {
  COUNTDOWN_MS,
  duckAt,
  duckLogic,
  DURATION_MS,
  FIELD_W,
  findTarget,
  goldenIndex,
  HIT_RADIUS,
  isTie,
  judgeDucks,
  MAX_FLYING,
  planDucks,
  scoreOf,
  type DuckMove,
  type DuckState,
} from './logic';

const fresh = (seed = 'kachny'): DuckState =>
  duckLogic.setup({ rng: createRng(seed), starter: 'A' });

/** Zásah ptáka v čase t přesně do středu. */
function hit(state: DuckState, duck: number, t: number): DuckMove {
  const d = state.ducks[duck];
  const at = d && duckAt(d, t);
  if (!at) throw new Error(`pták ${duck} v čase ${t} neletí`);
  return { kind: 'shot', duck, t, x: at.x, y: at.y };
}

const play = (state: DuckState, moves: [PlayerSlot, DuckMove][]): DuckState =>
  moves.reduce((s, [p, m]) => {
    expect(duckLogic.legal(s, p, m), JSON.stringify(m)).toBe(true);
    return duckLogic.apply(s, p, m);
  }, state);

/** Okamžik, kdy je pták uprostřed letu (a v minutě, kromě zlaté kachny). */
const mid = (state: DuckState, duck: number): number => {
  const d = state.ducks[duck];
  if (!d) throw new Error('chybí pták');
  const end = d.kind === 'golden' ? d.gone : Math.min(d.gone, DURATION_MS);
  return Math.round((Math.max(d.spawn, d.kind === 'golden' ? DURATION_MS : 0) + end) / 2);
};

const firstOf = (s: DuckState, kind: 'duck' | 'dove'): number => {
  const i = s.ducks.findIndex((d) => d.kind === kind);
  if (i < 0) throw new Error(`žádný ${kind}`);
  return i;
};

describe('Kachní hon – plán ptáků', () => {
  it('kachny létají celou minutu (najednou nejvýš 3), občas holubice, na konci zlatá kachna', () => {
    let doves = 0;
    let total = 0;
    for (let seed = 0; seed < 100; seed++) {
      const birds = planDucks(createRng(`seed-${seed}`));
      const golden = birds.at(-1);
      expect(golden?.kind).toBe('golden');
      expect(golden?.spawn).toBeGreaterThan(DURATION_MS);
      const regular = birds.slice(0, -1);
      expect(regular.length).toBeGreaterThan(18); // víc než dřív (15) – „neomezeně“ po minutu
      expect(regular.every((b) => b.kind !== 'golden' && b.spawn < DURATION_MS)).toBe(true);
      // Poslední pták vylétne těsně před koncem minuty.
      expect(Math.max(...regular.map((b) => b.spawn))).toBeGreaterThan(DURATION_MS - 9000);
      for (const { spawn } of regular) {
        const flying = regular.filter((d) => d.spawn <= spawn && d.gone > spawn).length;
        expect(flying).toBeLessThanOrEqual(MAX_FLYING);
      }
      doves += regular.filter((b) => b.kind === 'dove').length;
      total += regular.length;
    }
    expect(doves / total).toBeGreaterThan(0.08);
    expect(doves / total).toBeLessThan(0.3);
  });

  it('ptáci vylétají ze všech stran (z trávy, zleva, zprava i shora)', () => {
    const sides = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      for (const bird of planDucks(createRng(`s${seed}`))) {
        const start = bird.path[0];
        if (!start) continue;
        if (start.x < 0) sides.add('left');
        else if (start.x > FIELD_W) sides.add('right');
        else if (start.y < 0) sides.add('top');
        else sides.add('bottom');
      }
    }
    expect([...sides].sort()).toEqual(['bottom', 'left', 'right', 'top']);
  });

  it('stejný seed = stejné dráhy (online mají oba hráči totéž)', () => {
    expect(planDucks(createRng('x'))).toEqual(planDucks(createRng('x')));
    expect(planDucks(createRng('x'))).not.toEqual(planDucks(createRng('y')));
  });
});

describe('Kachní hon – zásahy a vyhodnocení', () => {
  it('platný je jen zásah, kde pták v tu chvíli opravdu je', () => {
    const s = fresh();
    const duck = firstOf(s, 'duck');
    const shot = hit(s, duck, mid(s, duck));
    expect(duckLogic.legal(s, 'A', shot)).toBe(true);
    if (shot.kind !== 'shot') throw new Error();
    expect(duckLogic.legal(s, 'A', { ...shot, x: shot.x + HIT_RADIUS + 1 })).toBe(false);
    expect(duckLogic.legal(s, 'A', { ...shot, duck: 99 })).toBe(false);
    const after = duckLogic.apply(s, 'A', shot);
    expect(duckLogic.legal(after, 'A', shot)).toBe(false);
  });

  it('zlatá kachna jde trefit jen po minutě, běžní ptáci jen v minutě', () => {
    const s = fresh();
    const g = goldenIndex(s.ducks);
    expect(duckLogic.legal(s, 'A', hit(s, g, mid(s, g)))).toBe(true);
    const late = s.ducks.findIndex((d) => d.kind === 'duck' && d.gone > DURATION_MS + 300);
    if (late >= 0) {
      expect(duckLogic.legal(s, 'A', hit(s, late, DURATION_MS + 200))).toBe(false);
    }
  });

  it('kachna +1 (dřívější zásah), holubice −1 každému, kdo ji trefil', () => {
    const s = fresh();
    const duck = firstOf(s, 'duck');
    const dove = firstOf(s, 'dove');
    const state = play(s, [
      ['A', hit(s, duck, mid(s, duck))],
      ['B', hit(s, duck, mid(s, duck) - 30)],
      ['A', hit(s, dove, mid(s, dove))],
      ['B', hit(s, dove, mid(s, dove) + 10)],
    ]);
    expect(scoreOf(state.ducks, state.shots)).toEqual({
      A: { ducks: 0, doves: 1, points: -1 },
      B: { ducks: 1, doves: 1, points: 0 },
    });
  });

  it('víc bodů vyhrává; při shodě rozstřel (zlatá kachna), jinak remíza', () => {
    const s = fresh();
    const [d1, d2] = s.ducks.flatMap((d, i) => (d.kind === 'duck' ? [i] : [])).slice(0, 2);
    if (d1 === undefined || d2 === undefined) throw new Error('málo kachen');
    const g = goldenIndex(s.ducks);
    const tied = play(s, [
      ['A', hit(s, d1, mid(s, d1))],
      ['B', hit(s, d2, mid(s, d2))],
    ]);
    expect(isTie(duckLogic.view(tied, 'A'))).toBe(true);
    expect(judgeDucks(tied.ducks, tied.shots)).toEqual(DRAW);
    const golden = play(tied, [
      ['A', hit(s, g, mid(s, g))],
      ['B', hit(s, g, mid(s, g) - 40)],
    ]);
    expect(judgeDucks(golden.ducks, golden.shots)).toEqual(win('B'));
    // Bez remízy zlatá kachna nic nemění.
    const ahead = play(s, [
      ['A', hit(s, d1, mid(s, d1))],
      ['A', hit(s, d2, mid(s, d2))],
      ['B', hit(s, g, mid(s, g))],
    ]);
    expect(judgeDucks(ahead.ducks, ahead.shots)).toEqual(win('A'));
  });

  it('hra končí, až mají hotovo oba', () => {
    let s = fresh();
    s = play(s, [['A', { kind: 'done' }]]);
    expect(duckLogic.outcome(s)).toBeNull();
    expect(duckLogic.toMove(s)).toEqual(['B']);
    s = play(s, [['B', { kind: 'done' }]]);
    expect(duckLogic.outcome(s)).toEqual(DRAW);
  });

  it('findTarget vybere nejbližšího ptáka a vynechá ty, co už patří soupeři', () => {
    const s = fresh();
    const duck = firstOf(s, 'duck');
    const t = mid(s, duck);
    const shot = hit(s, duck, t);
    if (shot.kind !== 'shot') throw new Error();
    expect(findTarget(duckLogic.view(s, 'A'), 'A', t, shot.x + 1, shot.y)).toBe(duck);
    const taken = duckLogic.apply(s, 'B', hit(s, duck, t - 10));
    expect(findTarget(duckLogic.view(taken, 'A'), 'A', t, shot.x, shot.y)).toBeNull();
  });
});

describe('Kachní hon – AI', () => {
  const ai = (difficulty: Difficulty, seed: string, me: PlayerSlot = 'B'): AIContext => ({
    difficulty,
    rng: createRng(seed),
    me,
    memory: new AIMemory(),
  });

  /** AI odehraje celé kolo sama; vrátí body a ověří časování tahů. */
  function solo(difficulty: Difficulty, seed: string): { points: number; doves: number } {
    let state = fresh(`kolo-${seed}`);
    const ctx = ai(difficulty, seed);
    let clock = 0;
    for (let i = 0; i < 120; i++) {
      const view = duckLogic.view(state, 'B');
      const move = duckAIMove(view, ctx);
      clock += duckAIDelay(view, move, ctx);
      if (move.kind === 'shot') expect(clock).toBe(COUNTDOWN_MS + move.t);
      expect(duckLogic.legal(state, 'B', move)).toBe(true);
      state = duckLogic.apply(state, 'B', move);
      if (move.kind === 'done') {
        expect(clock).toBeGreaterThanOrEqual(COUNTDOWN_MS + DURATION_MS);
        const score = scoreOf(state.ducks, state.shots).B;
        return { points: score.points, doves: score.doves };
      }
    }
    throw new Error('AI neskončila');
  }

  it('tahy jsou platné, načasované podle zásahu; těžká má víc bodů a míň holubic', () => {
    let easy = { points: 0, doves: 0 };
    let hard = { points: 0, doves: 0 };
    for (let i = 0; i < 20; i++) {
      const e = solo('easy', `e${i}`);
      const h = solo('hard', `h${i}`);
      easy = { points: easy.points + e.points, doves: easy.doves + e.doves };
      hard = { points: hard.points + h.points, doves: hard.doves + h.doves };
    }
    expect(hard.points).toBeGreaterThan(easy.points * 1.5);
    expect(hard.doves).toBeLessThan(easy.doves);
    expect(DUCK_SKILL.hard.doveMistake).toBeLessThan(DUCK_SKILL.easy.doveMistake);
  });
});
