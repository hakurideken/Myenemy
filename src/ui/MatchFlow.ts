import { GameRunner } from '../core/GameRunner';
import { MatchController, type CurrentGame } from '../core/match/MatchController';
import { planMatch, type MatchFormat } from '../core/match/planMatch';
import type { RoundEnd, SeatConfig } from '../core/MiniGame';
import type { Difficulty, PerPlayer, PlayerSlot } from '../core/types';
import { systemClock } from '../core/util/clock';
import { deriveRng, randomSeed } from '../core/util/rng';
import { GAME_INFOS, getGame } from '../games/registry';
import type { App } from './App';
import { gameScreen } from './screens/game';
import { gameIntroScreen } from './screens/gameIntro';
import { matchIntroScreen } from './screens/matchIntro';
import { matchResultScreen } from './screens/matchResult';
import { roundResultScreen } from './screens/roundResult';

export type LocalMode = 'pve' | 'local';

export interface MatchSetup {
  readonly mode: LocalMode;
  readonly format: MatchFormat;
  readonly names: PerPlayer<string>;
  readonly difficulty: Difficulty;
}

/** Průchod zápasem v PvE a lokálním režimu: přehled → (pravidla → hra → výsledek kola)* → výsledek. */
export class MatchFlow {
  private readonly seed = randomSeed();
  private readonly controller: MatchController;

  constructor(
    private readonly app: App,
    private readonly setup: MatchSetup,
  ) {
    const plan = planMatch(setup.format, GAME_INFOS, deriveRng(this.seed, 'plan'));
    this.controller = new MatchController(plan, deriveRng(this.seed, 'match'));
  }

  start(): void {
    this.app.show(
      matchIntroScreen({
        setup: this.setup,
        plan: this.controller.plan,
        onStart: () => this.showGameIntro(),
        onBack: () => this.app.goMenu(),
      }),
    );
  }

  /** Hráč u tohoto zařízení – kvůli zvuku výhry/prohry. Lokálně hrají oba. */
  private get me(): PlayerSlot | null {
    return this.setup.mode === 'pve' ? 'A' : null;
  }

  private get seats(): PerPlayer<SeatConfig> {
    return this.setup.mode === 'pve'
      ? { A: { kind: 'human' }, B: { kind: 'ai', difficulty: this.setup.difficulty } }
      : { A: { kind: 'human' }, B: { kind: 'human' } };
  }

  private showGameIntro(): void {
    const current = this.controller.current();
    this.app.show(
      gameIntroScreen({
        game: getGame(current.gameId),
        current,
        mode: this.setup.mode,
        names: this.setup.names,
        score: this.controller.score,
        onStart: () => this.playRound(),
        onLeave: () => this.leave(),
      }),
    );
  }

  private playRound(): void {
    const current = this.controller.current();
    const game = getGame(current.gameId);
    this.app.show(
      gameScreen({
        game,
        current,
        names: this.setup.names,
        score: this.controller.score,
        onLeave: () => this.leave(),
        start: (parts) => {
          const runner = new GameRunner(game);
          runner.init({
            root: parts.root,
            mode: this.setup.mode,
            names: this.setup.names,
            seats: this.seats,
            starter: current.starter,
            rng: deriveRng(this.seed, 'game', current.gameNo, current.replay),
            aiRng: deriveRng(this.seed, 'ai', current.gameNo, current.replay),
            aiMemory: this.app.aiMemory(game.id),
            clock: systemClock,
            prefs: this.app.prefs(),
            sfx: this.app.sfx,
            handoff: (to) => parts.handoff(to),
            showTurnTimer: (deadline, total) => parts.showTurnTimer(deadline, total),
          });
          runner.onEnd((result) => this.onRoundEnd(current, result));
          runner.start();
          return () => runner.destroy();
        },
      }),
    );
  }

  private onRoundEnd(current: CurrentGame, result: RoundEnd): void {
    const report = this.controller.report(result.outcome);
    this.app.show(
      roundResultScreen({
        report,
        current,
        result,
        game: getGame(current.gameId),
        names: this.setup.names,
        score: this.controller.score,
        me: this.me,
        sfx: this.app.sfx,
        onContinue: () => (this.controller.isOver ? this.showMatchResult() : this.showGameIntro()),
      }),
    );
  }

  private showMatchResult(): void {
    const winner = this.controller.winner;
    if (!winner) return;
    this.app.show(
      matchResultScreen({
        names: this.setup.names,
        winner,
        score: this.controller.score,
        history: this.controller.history,
        me: this.me,
        sfx: this.app.sfx,
        onRematch: () => this.app.startMatch(this.setup),
        onMenu: () => this.app.goMenu(),
      }),
    );
  }

  private leave(): void {
    void this.app
      .confirm({
        title: 'Opustit zápas?',
        message: 'Výsledek se nikam nezapočítá.',
        confirm: 'Opustit',
      })
      .then((ok) => {
        if (ok) this.app.goMenu();
      });
  }
}
