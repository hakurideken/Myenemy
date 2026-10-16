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

    it('každý pohled během hry projde viewSchema (online ho host validuje)', () => {
      const rng = createRng(`views-${game.id}`);
      for (let round = 0; round < 10; round++) {
        let state = game.logic.setup({ rng, starter: round % 2 === 0 ? 'A' : 'B' });
        for (let step = 0; step < 200 && game.logic.outcome(state) === null; step++) {
          for (const viewer of ['A', 'B'] as const) {
            const parsed = game.viewSchema.safeParse(game.logic.view(state, viewer));
            expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
          }
          const player = game.logic.toMove(state)[0];
          if (!player) break;
          const ai = { difficulty: 'easy' as const, rng, me: player, memory: new AIMemory() };
          state = game.logic.apply(
            state,
            player,
            game.getAIMove(game.logic.view(state, player), ai),
          );
        }
        for (const viewer of ['A', 'B'] as const) {
          const final = game.logic.view(state, viewer);
          expect(game.viewSchema.safeParse(final).success).toBe(true);
          if (game.sealed) expect(game.sealed.moveOf(final, viewer)).not.toBeNull();
        }
      }
    });
  });
});
