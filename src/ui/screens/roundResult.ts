import type { CurrentGame, ReportResult } from '../../core/match/MatchController';
import { MAX_DRAW_REPLAYS } from '../../core/match/MatchController';
import type { GameInfo, RoundEnd, Sfx, SfxName } from '../../core/MiniGame';
import type { PerPlayer, PlayerSlot } from '../../core/types';
import type { Mount } from '../App';
import { bigScore, button, scoreBar } from '../components/common';
import { h } from '../dom';
import { translations } from '../../i18n';

const t = translations(
  {
    draw: 'Remíza!',
    drawSub: (replay: number, max: number) =>
      `Remíza se nepočítá – hraje se rozhodující kolo ${replay}/${max}.`,
    deciding: 'Rozhodující kolo',
    coin: (name: string) => `Rozhodl los: ${name}`,
    wins: (name: string) => `${name} vyhrává hru!`,
    coinSub: (max: number) => `Ani po ${max} rozhodujících kolech nikdo nevyhrál.`,
    matchResult: 'Výsledek zápasu',
    next: 'Další hra',
  },
  {
    draw: 'Draw!',
    drawSub: (replay: number, max: number) =>
      `A draw does not count – deciding round ${replay}/${max} follows.`,
    deciding: 'Deciding round',
    coin: (name: string) => `Decided by a coin flip: ${name}`,
    wins: (name: string) => `${name} wins the game!`,
    coinSub: (max: number) => `Nobody won even after ${max} deciding rounds.`,
    matchResult: 'Match result',
    next: 'Next game',
  },
);

interface RoundResultOptions {
  readonly report: ReportResult;
  readonly current: CurrentGame;
  readonly result: RoundEnd;
  readonly game: GameInfo;
  readonly names: PerPlayer<string>;
  readonly score: Readonly<PerPlayer<number>>;
  /** Hráč na tomto zařízení (PvE, online); null = lokálně dva hráči. */
  readonly me: PlayerSlot | null;
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
      title = t.draw;
      subtitle = t.drawSub(report.replay, MAX_DRAW_REPLAYS);
      tone = 'result--draw';
      sound = 'draw';
      next = t.deciding;
    } else {
      title = report.byCoin ? t.coin(names[report.winner]) : t.wins(names[report.winner]);
      subtitle = report.byCoin ? t.coinSub(MAX_DRAW_REPLAYS) : o.game.name;
      tone = `result--${report.winner.toLowerCase()}`;
      sound = o.me !== null && report.winner !== o.me ? 'lose' : 'win';
      next = report.matchWinner ? t.matchResult : t.next;
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
