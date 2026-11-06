import { describe, expect, it } from 'vitest';
import { AIMemory, type AIContext } from '../../core/MiniGame';
import { DRAW, win, type Difficulty, type PlayerSlot } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { DUCK_SKILL, duckAIDelay, duckAIMove } from './ai';
import {
  COUNTDOWN_MS,
  duckAt,
  duckLogic,
  DUCK_COUNT,
  DURATION_MS,
  FIELD_W,
  findTarget,
  GROUND_Y,
  HIT_RADIUS,
  judgeDucks,
  MAX_FLYING,
  MIN_REACTION_MS,
  planDucks,
  scoreOf,
  type DuckMove,
  type DuckState,
} from './logic';

const fresh = (seed = 'kachny'): DuckState =>
  duckLogic.setup({ rng: createRng(seed), starter: 'A' });

/** Zásah kachny v čase t přesně do středu. */
function hit(state: DuckState, duck: number, t: number): DuckMove {
  const d = state.ducks[duck];
  const at = d && duckAt(d, t);
  if (!at) throw new Error(`kachna ${duck} v čase ${t} neletí`);
  return { kind: 'shot', duck, t, x: at.x, y: at.y };
}

const play = (state: DuckState, moves: [PlayerSlot, DuckMove][]): DuckState =>
  moves.reduce((s, [p, m]) => {
    expect(duckLogic.legal(s, p, m), JSON.stringify(m)).toBe(true);
    return duckLogic.apply(s, p, m);
  }, state);

const mid = (state: DuckState, duck: number): number => {
  const d = state.ducks[duck];
  if (!d) throw new Error('chybí kachna');
  return Math.round((d.spawn + d.gone) / 2);
};

describe('Kachní hon – plán kachen', () => {
  it('15 kachen, najednou nejvýš 3, všechny zmizí do konce minuty', () => {
    for (let seed = 0; seed < 200; seed++) {
      const ducks = planDucks(createRng(`seed-${seed}`));
      expect(ducks).toHaveLength(DUCK_COUNT);
      for (const duck of ducks) {
        expect(duck.spawn).toBeGreaterThanOrEqual(0);
        expect(duck.gone).toBeLessThanOrEqual(DURATION_MS);
        expect(duck.gone - duck.spawn).toBeGreaterThan(1500);
        expect(duck.path.length).toBeGreaterThanOrEqual(3); // aspoň jedna změna směru
      }
      for (const { spawn } of ducks) {
        const flying = ducks.filter((d) => d.spawn <= spawn && d.gone >= spawn).length;
        expect(flying).toBeLessThanOrEqual(MAX_FLYING);
      }
      // Pořadí vylétnutí odpovídá pořadí v plánu.
      expect(ducks.map((d) => d.spawn)).toEqual(
        [...ducks.map((d) => d.spawn)].sort((a, b) => a - b),
      );
    }
  });

  it('stejný seed = stejné dráhy (online mají oba hráči totéž)', () => {
    expect(planDucks(createRng('x'))).toEqual(planDucks(createRng('x')));
    expect(planDucks(createRng('x'))).not.toEqual(planDucks(createRng('y')));
  });

  it('kachna vylétne z trávy, létá na obloze a odletí nahoru za okraj', () => {
    const [duck] = planDucks(createRng('dráha'));
    if (!duck) throw new Error('chybí kachna');
    expect(duckAt(duck, duck.spawn - 1)).toBeNull();
    expect(duckAt(duck, duck.spawn)?.y).toBeGreaterThan(GROUND_Y);
    expect(duckAt(duck, duck.gone)?.y).toBeLessThan(0);
    expect(duckAt(duck, duck.gone + 1)).toBeNull();
    for (let t = duck.spawn; t <= duck.gone; t += 50) {
      const at = duckAt(duck, t);
      expect(at?.x).toBeGreaterThanOrEqual(-8);
      expect(at?.x).toBeLessThanOrEqual(FIELD_W + 8);
    }
  });
});

describe('Kachní hon – zásahy a vyhodnocení', () => {
  it('platný je jen zásah, kde kachna v tu chvíli opravdu je', () => {
    const s = fresh();
    const t = mid(s, 0);
    const shot = hit(s, 0, t);
    expect(duckLogic.legal(s, 'A', shot)).toBe(true);
    if (shot.kind !== 'shot') throw new Error();
    expect(duckLogic.legal(s, 'A', { ...shot, x: shot.x + HIT_RADIUS + 1 })).toBe(false);
    expect(duckLogic.legal(s, 'A', { ...shot, t: (s.ducks[0]?.gone ?? 0) + 10 })).toBe(false);
    expect(duckLogic.legal(s, 'A', { ...shot, duck: 99 })).toBe(false);
    // Nelidsky rychlá „reakce“ hned po vylétnutí z trávy neplatí.
    const spawn = s.ducks[0]?.spawn ?? 0;
    expect(duckLogic.legal(s, 'A', hit(s, 0, spawn + MIN_REACTION_MS - 1))).toBe(false);
    expect(duckLogic.legal(s, 'A', hit(s, 0, spawn + MIN_REACTION_MS))).toBe(true);
    // Stejnou kachnu dvakrát ne, ale soupeř ji trefit smí (rozhodne čas).
    const after = duckLogic.apply(s, 'A', shot);
    expect(duckLogic.legal(after, 'A', shot)).toBe(false);
    expect(duckLogic.legal(after, 'B', hit(s, 0, t + 5))).toBe(true);
  });

  it('kachnu získá dřívější zásah bez ohledu na pořadí, v jakém zásahy dorazily', () => {
    const s = fresh();
    const t = mid(s, 1);
    const early = hit(s, 1, t - 40);
    const late = hit(s, 1, t);
    const ab = play(s, [
      ['A', late],
      ['B', early],
    ]);
    const ba = play(s, [
      ['B', early],
      ['A', late],
    ]);
    expect(duckLogic.view(ab, 'A').owners[1]).toBe('B');
    expect(duckLogic.view(ab, 'A')).toEqual(duckLogic.view(ba, 'A'));
  });

  it('víc kachen vyhrává, při shodě kratší součet reakcí, úplná shoda je remíza', () => {
    expect(judgeDucks({ A: { hits: 3, reaction: 9000 }, B: { hits: 2, reaction: 100 } })).toEqual(
      win('A'),
    );
    expect(judgeDucks({ A: { hits: 2, reaction: 2100 }, B: { hits: 2, reaction: 2000 } })).toEqual(
      win('B'),
    );
    expect(judgeDucks({ A: { hits: 2, reaction: 2000 }, B: { hits: 2, reaction: 2000 } })).toEqual(
      DRAW,
    );
    expect(judgeDucks({ A: { hits: 0, reaction: 0 }, B: { hits: 0, reaction: 0 } })).toEqual(DRAW);
  });

  it('reakce se počítá od vylétnutí kachny a hra končí, až mají hotovo oba', () => {
    const s = fresh();
    const spawn = s.ducks[2]?.spawn ?? 0;
    let state = play(s, [
      ['A', hit(s, 2, spawn + 900)],
      ['B', hit(s, 3, (s.ducks[3]?.spawn ?? 0) + 700)],
      ['A', { kind: 'done' }],
    ]);
    expect(duckLogic.outcome(state)).toBeNull();
    expect(duckLogic.toMove(state)).toEqual(['B']);
    expect(duckLogic.legal(state, 'A', hit(s, 4, mid(s, 4)))).toBe(false);
    state = play(state, [['B', { kind: 'done' }]]);
    expect(scoreOf(state.ducks, state.shots)).toEqual({
      A: { hits: 1, reaction: 900 },
      B: { hits: 1, reaction: 700 },
    });
    expect(duckLogic.outcome(state)).toEqual(win('B'));
  });

  it('findTarget vybere nejbližší kachnu a vynechá ty, které už patří soupeři', () => {
    const s = fresh();
    const t = mid(s, 0);
    const shot = hit(s, 0, t);
    if (shot.kind !== 'shot') throw new Error();
    expect(findTarget(duckLogic.view(s, 'A'), 'A', t, shot.x + 1, shot.y)).toBe(0);
    expect(findTarget(duckLogic.view(s, 'A'), 'A', t, shot.x + 20, shot.y + 20)).toBeNull();
    const taken = duckLogic.apply(s, 'B', hit(s, 0, t - 10));
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

  /** AI odehraje celé kolo sama; vrátí počet zásahů a ověří časování tahů. */
  function solo(difficulty: Difficulty, seed: string): number {
    let state = fresh(`kolo-${seed}`);
    const ctx = ai(difficulty, seed);
    let clock = 0;
    for (let i = 0; i < 40; i++) {
      const view = duckLogic.view(state, 'B');
      const move = duckAIMove(view, ctx);
      clock += duckAIDelay(view, move, ctx);
      if (move.kind === 'shot') expect(clock).toBe(COUNTDOWN_MS + move.t);
      expect(duckLogic.legal(state, 'B', move)).toBe(true);
      state = duckLogic.apply(state, 'B', move);
      if (move.kind === 'done') {
        expect(clock).toBeGreaterThanOrEqual(COUNTDOWN_MS + DURATION_MS);
        return state.shots.B.length;
      }
    }
    throw new Error('AI neskončila');
  }

  it('tahy jsou platné, načasované podle zásahu a těžká trefí víc než lehká', () => {
    let easy = 0;
    let hard = 0;
    for (let i = 0; i < 20; i++) {
      easy += solo('easy', `e${i}`);
      hard += solo('hard', `h${i}`);
    }
    expect(hard).toBeGreaterThan(easy * 1.4);
    expect(hard / 20).toBeLessThanOrEqual(DUCK_COUNT);
  });

  it('těžká AI reaguje rychleji než lehká', () => {
    expect(DUCK_SKILL.hard.reaction[1]).toBeLessThan(DUCK_SKILL.easy.reaction[0]);
    const s = fresh('reakce');
    const view = duckLogic.view(s, 'B');
    const first = (d: Difficulty): number => {
      const move = duckAIMove(view, { ...ai(d, 'r'), memory: new AIMemory() });
      return move.kind === 'shot' ? move.t - (s.ducks[move.duck]?.spawn ?? 0) : Infinity;
    };
    expect(first('hard')).toBeLessThan(1200);
  });

  it('kachnu, kterou už má soupeř, AI nechá být', () => {
    const s = fresh('obsazeno');
    const taken = duckLogic.apply(s, 'A', hit(s, 0, mid(s, 0)));
    const move = duckAIMove(duckLogic.view(taken, 'B'), ai('hard', 'z'));
    expect(move.kind === 'shot' && move.duck === 0).toBe(false);
  });
});
