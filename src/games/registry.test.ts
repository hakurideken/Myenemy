import { describe, expect, it } from 'vitest';
import { AIMemory, type AnyMiniGameModule } from '../core/MiniGame';
import { DIFFICULTIES, type Difficulty, type PlayerSlot } from '../core/types';
import { createRng, type Rng } from '../core/util/rng';
import { GAME_INFOS, GAMES, getGame } from './registry';

const MODES = ['pve', 'local', 'online'] as const;

/** Tajná data obou hráčů (u her se skrytou informací), jinak null. */
function secretsFor(game: AnyMiniGameModule, rng: Rng): Record<PlayerSlot, unknown> | null {
  const hidden = game.hidden;
  return hidden ? { A: hidden.randomSecret(rng), B: hidden.randomSecret(rng) } : null;
}

/** Tah hráče: z tajných dat (odpověď), jinak tah AI. */
function playerMove(
  game: AnyMiniGameModule,
  state: unknown,
  player: PlayerSlot,
  secrets: Record<PlayerSlot, unknown> | null,
  rng: Rng,
  difficulty: Difficulty = 'easy',
): unknown {
  const view = game.logic.view(state, player);
  const answer = secrets ? game.hidden?.respond(view, player, secrets[player]) : null;
  if (answer !== null && answer !== undefined) return answer;
  return game.getAIMove(view, { difficulty, rng, me: player, memory: new AIMemory() });
}

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
        let state = game.logic.setup({ rng, starter: round % 2 === 0 ? 'A' : 'B' });
        const secrets = secretsFor(game, rng);
        // U skryté informace nejdřív tahy z tajných dat (rozmístění, volba kódu).
        for (;;) {
          const player = game.logic.toMove(state)[0];
          const view = player ? game.logic.view(state, player) : null;
          const answer =
            player && secrets ? game.hidden?.respond(view, player, secrets[player]) : null;
          if (!player || answer === null || answer === undefined) break;
          state = game.logic.apply(state, player, answer);
        }
        for (const player of game.logic.toMove(state)) {
          const move = playerMove(game, state, player, null, rng, difficulty);
          expect(game.moveSchema.safeParse(move).success).toBe(true);
          expect(game.logic.legal(state, player, move)).toBe(true);
        }
      }
    });

    it('každý pohled během hry projde viewSchema (online ho host validuje)', () => {
      const rng = createRng(`views-${game.id}`);
      for (let round = 0; round < 10; round++) {
        let state = game.logic.setup({ rng, starter: round % 2 === 0 ? 'A' : 'B' });
        const secrets = secretsFor(game, rng);
        for (let step = 0; step < 400 && game.logic.outcome(state) === null; step++) {
          for (const viewer of ['A', 'B'] as const) {
            const parsed = game.viewSchema.safeParse(game.logic.view(state, viewer));
            expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
          }
          const player = game.logic.toMove(state)[0];
          if (!player) break;
          const move = playerMove(game, state, player, secrets, rng);
          expect(game.logic.legal(state, player, move)).toBe(true);
          state = game.logic.apply(state, player, move);
        }
        expect(game.logic.outcome(state)).not.toBeNull();
        for (const viewer of ['A', 'B'] as const) {
          const final = game.logic.view(state, viewer);
          expect(game.viewSchema.safeParse(final).success).toBe(true);
          if (game.sealed) expect(game.sealed.moveOf(final, viewer)).not.toBeNull();
          if (game.hidden && secrets) {
            // Poctivé odpovědi musí projít kontrolou a výsledek plyne z veřejného pohledu.
            expect(game.hidden.consistent(final, viewer, secrets[viewer])).toBe(true);
            expect(game.hidden.outcome(final)).toEqual(game.logic.outcome(state));
          }
        }
      }
    });
  });
});
