import { describe, expect, it } from 'vitest';
import { LocalDealer } from '../core/cards/LocalDealer';
import { AIMemory, type AnyMiniGameModule } from '../core/MiniGame';
import { DIFFICULTIES, type Difficulty, type PlayerSlot } from '../core/types';
import { createRng, type Rng } from '../core/util/rng';
import { GAME_INFOS, GAMES, getGame } from './registry';

const MODES = ['pve', 'local', 'online'] as const;

/** Simulace hry bez runneru: tajná data (skrytá informace) a rozdávající (karty). */
interface Sim {
  state: unknown;
  readonly secrets: Record<PlayerSlot, unknown> | null;
  readonly dealer: LocalDealer | null;
}

function simulate(game: AnyMiniGameModule, rng: Rng, starter: PlayerSlot): Sim {
  const hidden = game.hidden;
  const sim: Sim = {
    state: game.logic.setup({ rng, starter }),
    secrets: hidden ? { A: hidden.randomSecret(rng), B: hidden.randomSecret(rng) } : null,
    dealer: game.cards ? new LocalDealer(game.cards.deckSize, rng) : null,
  };
  settleCards(game, sim);
  return sim;
}

/** Karty: rozdá nároky a odhalí, na co hra čeká (jako GameRunner). */
function settleCards(game: AnyMiniGameModule, sim: Sim): void {
  const { cards, logic } = game;
  const dealer = sim.dealer;
  if (!cards || !dealer) return;
  for (;;) {
    const views = { A: logic.view(sim.state, 'A'), B: logic.view(sim.state, 'B') };
    const pending = cards.pendingPublic(views.A);
    const shared = [...cards.publicCards(views.A).map((c) => c.pos), ...pending];
    dealer.entitle({
      A: [...cards.privateFor(views.A, 'A'), ...shared],
      B: [...cards.privateFor(views.B, 'B'), ...shared],
    });
    const revealed = pending.length > 0 ? dealer.peek(pending) : null;
    if (!revealed) return;
    sim.state = cards.reveal(sim.state, revealed);
  }
}

/** Tah, který hraje automatika (z tajných dat nebo vlastních karet), jinak null. */
function forcedMove(game: AnyMiniGameModule, sim: Sim, player: PlayerSlot): unknown {
  const view = game.logic.view(sim.state, player);
  const answer = sim.secrets ? game.hidden?.respond(view, player, sim.secrets[player]) : null;
  if (answer !== null && answer !== undefined) return answer;
  if (sim.dealer) return game.cards?.autoMove?.(view, player, sim.dealer.known(player)) ?? null;
  return null;
}

function aiMove(
  game: AnyMiniGameModule,
  sim: Sim,
  player: PlayerSlot,
  rng: Rng,
  difficulty: Difficulty,
): unknown {
  const cards = sim.dealer?.known(player);
  return game.getAIMove(game.logic.view(sim.state, player), {
    difficulty,
    rng,
    me: player,
    memory: new AIMemory(),
    ...(cards && { cards }),
  });
}

function apply(game: AnyMiniGameModule, sim: Sim, player: PlayerSlot, move: unknown): void {
  expect(game.logic.legal(sim.state, player, move)).toBe(true);
  const claims = game.cards?.claims(move) ?? [];
  if (sim.dealer) expect(sim.dealer.check(claims)).toBe(true);
  sim.state = game.logic.apply(sim.state, player, move);
  settleCards(game, sim);
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
        const sim = simulate(game, rng, round % 2 === 0 ? 'A' : 'B');
        // Nejdřív automatické tahy (rozmístění, volba kódu, vynucené tahy z karet).
        for (;;) {
          const player = game.logic.toMove(sim.state)[0];
          const forced = player ? forcedMove(game, sim, player) : null;
          if (!player || forced === null) break;
          apply(game, sim, player, forced);
        }
        for (const player of game.logic.toMove(sim.state)) {
          const move = aiMove(game, sim, player, rng, difficulty);
          expect(game.moveSchema.safeParse(move).success).toBe(true);
          expect(game.logic.legal(sim.state, player, move)).toBe(true);
          expect(sim.dealer?.check(game.cards?.claims(move) ?? []) ?? true).toBe(true);
        }
      }
    });

    it('celá hra: každý pohled projde viewSchema a hra skončí', () => {
      const rng = createRng(`views-${game.id}`);
      for (let round = 0; round < 10; round++) {
        const sim = simulate(game, rng, round % 2 === 0 ? 'A' : 'B');
        for (let step = 0; step < 600 && game.logic.outcome(sim.state) === null; step++) {
          for (const viewer of ['A', 'B'] as const) {
            const parsed = game.viewSchema.safeParse(game.logic.view(sim.state, viewer));
            expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
          }
          const player = game.logic.toMove(sim.state)[0];
          if (!player) break;
          const move = forcedMove(game, sim, player) ?? aiMove(game, sim, player, rng, 'easy');
          apply(game, sim, player, move);
        }
        expect(game.logic.outcome(sim.state)).not.toBeNull();
        for (const viewer of ['A', 'B'] as const) {
          const final = game.logic.view(sim.state, viewer);
          expect(game.viewSchema.safeParse(final).success).toBe(true);
          if (game.sealed) expect(game.sealed.moveOf(final, viewer)).not.toBeNull();
          if (game.hidden && sim.secrets) {
            // Poctivé odpovědi musí projít kontrolou a výsledek plyne z veřejného pohledu.
            expect(game.hidden.consistent(final, viewer, sim.secrets[viewer])).toBe(true);
            expect(game.hidden.outcome(final)).toEqual(game.logic.outcome(sim.state));
          }
        }
      }
    });
  });
});
