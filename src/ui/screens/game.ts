import type { CurrentGame } from '../../core/match/MatchController';
import type { GameInfo } from '../../core/MiniGame';
import type { PerPlayer, PlayerSlot } from '../../core/types';
import { systemClock } from '../../core/util/clock';
import type { Mount } from '../App';
import { scoreBar } from '../components/common';
import { showHandoff } from '../components/handoff';
import { createTurnTimer } from '../components/turnTimer';
import { h } from '../dom';

export interface GameScreenParts {
  readonly root: HTMLElement;
  handoff(to: PlayerSlot): Promise<void>;
  showTurnTimer(deadline: number | null, totalMs: number): void;
}

interface GameScreenOptions {
  readonly game: GameInfo;
  readonly current: CurrentGame;
  readonly names: PerPlayer<string>;
  readonly score: Readonly<PerPlayer<number>>;
  readonly onLeave: () => void;
  /** Spustí hru do připravené plochy; vrací úklid. */
  readonly start: (parts: GameScreenParts) => () => void;
}

export function gameScreen(o: GameScreenOptions): Mount {
  return (root) => {
    const timer = createTurnTimer(systemClock);
    const stage = h('div', { class: 'game-stage' });
    const screen = h(
      'main',
      { class: `screen screen--game game--${o.game.id}` },
      scoreBar({
        names: o.names,
        score: o.score,
        current: o.current,
        gameName: o.game.name,
        heading: true,
        onLeave: o.onLeave,
      }),
      timer.el,
      stage,
    );
    root.append(screen);
    const stop = o.start({
      root: stage,
      handoff: (to) => showHandoff(screen, o.names[to], to),
      showTurnTimer: (deadline, total) => timer.set(deadline, total),
    });
    return () => {
      stop();
      timer.destroy();
    };
  };
}
