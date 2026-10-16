import { describe, expect, it } from 'vitest';
import { AIMemory, type AIContext } from '../../core/MiniGame';
import { DRAW, win, type Difficulty } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { predictByFrequency, predictByMarkov, rpsAIMove, rpsAIObserve } from './ai';
import { describeRps, judgeRps, rpsLogic as logic, rpsMoveSchema, type RpsChoice } from './logic';

describe('Kámen-nůžky-papír – pravidla', () => {
  it.each([
    ['rock', 'scissors', win('A')],
    ['scissors', 'paper', win('A')],
    ['paper', 'rock', win('A')],
    ['scissors', 'rock', win('B')],
    ['paper', 'scissors', win('B')],
    ['rock', 'paper', win('B')],
    ['rock', 'rock', DRAW],
    ['paper', 'paper', DRAW],
    ['scissors', 'scissors', DRAW],
  ] as const)('%s proti %s', (a, b, expected) => {
    expect(judgeRps(a, b)).toEqual(expected);
  });

  it('volba soupeře zůstane skrytá, dokud nezvolí oba', () => {
    let s = logic.setup({ rng: createRng('x'), starter: 'B' });
    expect(logic.toMove(s)).toEqual(['B', 'A']);
    s = logic.apply(s, 'B', { choice: 'paper' });
    expect(logic.view(s, 'A')).toEqual({
      viewer: 'A',
      mine: null,
      opponentReady: true,
      revealed: null,
    });
    expect(logic.view(s, 'B')).toMatchObject({
      mine: 'paper',
      opponentReady: false,
      revealed: null,
    });
    expect(logic.legal(s, 'B', { choice: 'rock' })).toBe(false);
    s = logic.apply(s, 'A', { choice: 'scissors' });
    expect(logic.view(s, 'A').revealed).toEqual({ A: 'scissors', B: 'paper' });
    expect(logic.outcome(s)).toEqual(win('A'));
  });

  it('schéma přijme jen platnou volbu', () => {
    expect(rpsMoveSchema.safeParse({ choice: 'rock' }).success).toBe(true);
    expect(rpsMoveSchema.safeParse({ choice: 'dynamite' }).success).toBe(false);
    expect(rpsMoveSchema.safeParse({}).success).toBe(false);
  });

  it('popis výsledku', () => {
    expect(describeRps({ A: 'rock', B: 'scissors' })).toBe('Kámen tupí nůžky');
    expect(describeRps({ A: 'rock', B: 'paper' })).toBe('Papír balí kámen');
    expect(describeRps({ A: 'paper', B: 'paper' })).toBe('Oba zvolili papír');
  });
});

describe('Kámen-nůžky-papír – predikce', () => {
  it('frekvence: nejčastější volba', () => {
    expect(predictByFrequency([])).toBeNull();
    expect(predictByFrequency(['rock', 'paper', 'paper'])).toBe('paper');
  });

  it('Markov: co soupeř hraje po své poslední volbě', () => {
    expect(predictByMarkov(['rock', 'paper'])).toBeNull();
    expect(predictByMarkov(['rock', 'scissors', 'rock', 'scissors', 'rock'])).toBe('scissors');
  });
});

function duel(
  difficulty: Difficulty,
  opponent: (round: number) => RpsChoice,
  rounds = 300,
): number {
  const memory = new AIMemory();
  const rng = createRng(`rps-${difficulty}`);
  let wins = 0;
  for (let i = 0; i < rounds; i++) {
    const ctx: AIContext = { difficulty, rng, me: 'B', memory };
    let s = logic.setup({ rng, starter: 'A' });
    const aiMove = rpsAIMove(logic.view(s, 'B'), ctx);
    s = logic.apply(s, 'A', { choice: opponent(i) });
    s = logic.apply(s, 'B', aiMove);
    const outcome = logic.outcome(s);
    if (outcome?.kind === 'win' && outcome.winner === 'B') wins++;
    rpsAIObserve(logic.view(s, 'B'), ctx);
  }
  return wins / rounds;
}

describe('Kámen-nůžky-papír – AI', () => {
  const alwaysRock = (): RpsChoice => 'rock';
  const cycle = (i: number): RpsChoice => (['rock', 'scissors', 'paper'] as const)[i % 3] ?? 'rock';

  it('lehká hraje náhodně (zhruba třetinu výher proti komukoli)', () => {
    const rate = duel('easy', alwaysRock);
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.47);
  });

  it('střední potrestá hráče, který opakuje stejnou volbu', () => {
    expect(duel('medium', alwaysRock)).toBeGreaterThan(0.6);
  });

  it('těžká prokoukne opakování i pravidelný cyklus', () => {
    expect(duel('hard', alwaysRock)).toBeGreaterThan(0.75);
    expect(duel('hard', cycle)).toBeGreaterThan(0.7);
  });

  it('těžká nikdy nehraje úplně předvídatelně', () => {
    const memory = new AIMemory();
    const rng = createRng('variety');
    for (let i = 0; i < 10; i++) {
      rpsAIObserve(
        { viewer: 'B', mine: 'paper', opponentReady: true, revealed: { A: 'rock', B: 'paper' } },
        {
          difficulty: 'hard',
          rng,
          me: 'B',
          memory,
        },
      );
    }
    const choices = new Set(
      Array.from(
        { length: 100 },
        () =>
          rpsAIMove(
            { viewer: 'B', mine: null, opponentReady: false, revealed: null },
            {
              difficulty: 'hard',
              rng,
              me: 'B',
              memory,
            },
          ).choice,
      ),
    );
    expect(choices.size).toBe(3);
  });
});
