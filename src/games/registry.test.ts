import { describe, expect, it } from 'vitest';
import { AIMemory } from '../core/MiniGame';
import { DIFFICULTIES, type GameMode } from '../core/types';
import { createRng } from '../core/util/rng';
import { GAME_INFOS, GAMES, getGame } from './registry';

const MODES: readonly GameMode[] = ['pve', 'local', 'online'];

describe('registr miniher', () => {
  it('id jsou unikátní a getGame je najde', () => {
    const ids = GAMES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(getGame(id).id).toBe(id);
    expect(() => getGame('neexistuje')).toThrow();
    expect(GAME_INFOS.map((g) => g.id)).toEqual(ids);
  });

  // Kontrakt, který musí splnit každá nová minihra.
  describe.each(GAMES.map((g) => [g.name, g] as const))('%s', (_name, game) => {
    it('má pravidla a ovládání pro všechny režimy', () => {
      expect(game.rules.length).toBeGreaterThan(0);
      for (const mode of MODES) expect(game.controls(mode).length).toBeGreaterThan(0);
    });

    it.each(DIFFICULTIES)('AI (%s) vrací validní a platný tah', (difficulty) => {
      const rng = createRng(`contract-${game.id}-${difficulty}`);
      for (let round = 0; round < 20; round++) {
        const state = game.logic.setup({ rng, starter: round % 2 === 0 ? 'A' : 'B' });
        for (const player of game.logic.toMove(state)) {
          const move = game.getAIMove(game.logic.view(state, player), {
            difficulty,
            rng,
            me: player,
            memory: new AIMemory(),
          });
          expect(game.moveSchema.safeParse(move).success).toBe(true);
          expect(game.logic.legal(state, player, move)).toBe(true);
        }
      }
    });
  });
});
