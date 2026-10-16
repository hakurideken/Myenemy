import type { CurrentGame, ReportResult } from '../../core/match/MatchController';
import { MAX_DRAW_REPLAYS } from '../../core/match/MatchController';
import type { GameInfo, RoundEnd, Sfx, SfxName } from '../../core/MiniGame';
import type { GameMode, PerPlayer } from '../../core/types';
import type { Mount } from '../App';
import { bigScore, button, scoreBar } from '../components/common';
import { h } from '../dom';

interface RoundResultOptions {
  readonly report: ReportResult;
  readonly current: CurrentGame;
  readonly result: RoundEnd;
  readonly game: GameInfo;
  readonly names: PerPlayer<string>;
  readonly score: Readonly<PerPlayer<number>>;
  readonly mode: GameMode;
  readonly sfx: Sfx;
  readonly onContinue: () => void;
}

export function roundResultScreen(o: RoundResultOptions): Mount {
  return (root) => {
    const { report, names } = o;
    let title: string;
    let subtitle: string;
    let tone: string;
    let sound: SfxName;
    let next: string;

    if (report.kind === 'replay') {
      title = 'Remíza!';
      subtitle = `Remíza se nepočítá – hraje se rozhodující kolo ${report.replay}/${MAX_DRAW_REPLAYS}.`;
      tone = 'result--draw';
      sound = 'draw';
      next = 'Rozhodující kolo';
    } else {
      title = report.byCoin
        ? `Rozhodl los: ${names[report.winner]}`
        : `${names[report.winner]} vyhrává hru!`;
      subtitle = report.byCoin
        ? `Ani po ${MAX_DRAW_REPLAYS} rozhodujících kolech nikdo nevyhrál.`
        : o.game.name;
      tone = `result--${report.winner.toLowerCase()}`;
      sound = o.mode === 'pve' && report.winner === 'B' ? 'lose' : 'win';
      next = report.matchWinner ? 'Výsledek zápasu' : 'Další hra';
    }

    root.append(
      h(
        'main',
        { class: 'screen' },
        scoreBar({
          names,
          score: o.score,
          current: o.current,
          gameName: o.game.name,
          heading: false,
        }),
        h(
          'section',
          { class: `result-card ${tone}` },
          h('h1', { class: 'result-title', tabindex: '-1' }, title),
          h('p', { class: 'result-sub' }, subtitle),
          o.result.summary ? h('p', { class: 'result-summary' }, o.result.summary) : null,
          bigScore(o.score, report.kind === 'decided' ? report.winner : null),
          button(next, o.onContinue, 'btn btn-primary btn-lg', { 'data-autofocus': true }),
        ),
      ),
    );
    o.sfx.play(sound);
  };
}
