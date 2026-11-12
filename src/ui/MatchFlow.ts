import { GameRunner } from '../core/GameRunner';
import { MatchController, type CurrentGame } from '../core/match/MatchController';
import { planMatch, type MatchFormat } from '../core/match/planMatch';
import type { RoundEnd, SeatConfig } from '../core/MiniGame';
import type { Difficulty, PerPlayer, PlayerSlot } from '../core/types';
import { systemClock } from '../core/util/clock';
import { deriveRng, randomSeed } from '../core/util/rng';
import { GAME_INFOS, getGame } from '../games/registry';
import { translations } from '../i18n';
import type { App } from './App';
import { gameScreen } from './screens/game';
import { gameIntroScreen } from './screens/gameIntro';
import { matchIntroScreen } from './screens/matchIntro';
import { matchResultScreen } from './screens/matchResult';
import { roundResultScreen } from './screens/roundResult';
import type { TournamentLink } from './TournamentFlow';

const t = translations(
  {
    title: 'Opustit zápas?',
    message: 'Výsledek se nikam nezapočítá.',
    tournamentMessage: 'Prohraješ tento turnajový zápas kontumací a AI postoupí.',
    confirm: 'Opustit',
  },
  {
    title: 'Leave the match?',
    message: 'The result will not count anywhere.',
    tournamentMessage: 'You lose this tournament match by forfeit and the AI advances.',
    confirm: 'Leave',
  },
);

export interface MatchSetup {
  readonly mode: 'pve';
  readonly format: MatchFormat;
  readonly names: PerPlayer<string>;
  readonly difficulty: Difficulty;
  /** Turnajový zápas proti AI: výsledek jde do pavouku (mySlot = moje pozice). */
  readonly tournament?: { readonly link: TournamentLink; readonly mySlot: number };
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
        onBack: () => this.home(),
      }),
      { chrome: false },
    );
  }

  private reported = false;

  /** Kam po zápase: turnaj, nebo menu. */
  private home(): void {
    if (this.setup.tournament) this.setup.tournament.link.back();
    else this.app.goMenu();
  }

  /** Výsledek do pavouku (já = A v zápase, v pavouku můžu být nahoře i dole). */
  private reportTournament(winner: PlayerSlot): void {
    const tour = this.setup.tournament;
    if (!tour || this.reported) return;
    this.reported = true;
    const { link, mySlot } = tour;
    const opponentSlot = link.slots.A === mySlot ? link.slots.B : link.slots.A;
    // (slots: A = já, B = AI)
    const score = this.controller.score;
    const meOnTop = link.top === mySlot;
    link.finish(
      winner === 'A' ? mySlot : opponentSlot,
      meOnTop ? score.A : score.B,
      meOnTop ? score.B : score.A,
    );
  }

  /** Hráč u tohoto zařízení – kvůli zvuku výhry/prohry. Lokálně hrají oba. */
  private get me(): PlayerSlot {
    return 'A';
  }

  private get seats(): PerPlayer<SeatConfig> {
    return { A: { kind: 'human' }, B: { kind: 'ai', difficulty: this.setup.difficulty } };
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
      { chrome: false },
    );
  }

  /** Zápas začal (první hra) – odchod se počítá jako prohra. */
  private started = false;

  private playRound(): void {
    this.started = true;
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
            showTurnTimer: (deadline, total) => parts.showTurnTimer(deadline, total),
          });
          runner.onEnd((result) => this.onRoundEnd(current, result));
          runner.start();
          return () => runner.destroy();
        },
      }),
      { chrome: false },
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
        mode: this.setup.mode,
        names: this.setup.names,
        score: this.controller.score,
        me: this.me,
        sfx: this.app.sfx,
        onContinue: () => (this.controller.isOver ? this.showMatchResult() : this.showGameIntro()),
      }),
      { chrome: false },
    );
  }

  private showMatchResult(): void {
    const winner = this.controller.winner;
    if (!winner) return;
    this.reportTournament(winner);
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
        tournament: this.setup.tournament ? { onBack: () => this.home() } : undefined,
      }),
      { music: winner === this.me ? 'victory' : 'defeat' },
    );
  }

  private leave(): void {
    void this.app
      .confirm({
        title: t.title,
        message: this.setup.tournament ? t.tournamentMessage : t.message,
        confirm: t.confirm,
      })
      .then((ok) => {
        if (!ok) return;
        // Turnaj: odchod z rozehraného zápasu = prohra (AI je B).
        if (this.controller.history.length > 0 || this.started) this.reportTournament('B');
        this.home();
      });
  }
}
