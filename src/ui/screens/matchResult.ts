import type { RoundRecord } from '../../core/match/MatchController';
import type { Sfx } from '../../core/MiniGame';
import type { GameMode, PerPlayer, PlayerSlot } from '../../core/types';
import { getGame } from '../../games/registry';
import type { Mount } from '../App';
import { bigScore, button } from '../components/common';
import { trophyIcon } from '../components/icons';
import { h } from '../dom';

interface MatchResultOptions {
  readonly names: PerPlayer<string>;
  readonly winner: PlayerSlot;
  readonly score: Readonly<PerPlayer<number>>;
  readonly history: readonly RoundRecord[];
  readonly mode: GameMode;
  readonly sfx: Sfx;
  readonly onRematch: () => void;
  readonly onMenu: () => void;
}

function describeRecord(record: RoundRecord, names: PerPlayer<string>): string {
  if (record.outcome.kind === 'draw') return 'remíza';
  const name = names[record.outcome.winner];
  return record.byCoin ? `${name} (los)` : name;
}

export function matchResultScreen(o: MatchResultOptions): Mount {
  return (root) => {
    const { names, winner } = o;
    root.append(
      h(
        'main',
        { class: 'screen' },
        h(
          'section',
          { class: `result-card result--${winner.toLowerCase()}` },
          h('div', { class: 'trophy' }, trophyIcon()),
          h('p', { class: 'kicker' }, 'Konec zápasu'),
          h('h1', { class: 'result-title', tabindex: '-1' }, `${names[winner]} vyhrává zápas!`),
          bigScore(o.score, null),
          h(
            'ol',
            { class: 'history', 'aria-label': 'Průběh zápasu' },
            o.history.map((record) =>
              h(
                'li',
                null,
                h('span', { class: 'history-no' }, `${record.gameNo}.`),
                h(
                  'span',
                  null,
                  getGame(record.gameId).name,
                  record.replay > 0 && !record.byCoin ? ` · rozhodující kolo ${record.replay}` : '',
                ),
                h('span', { class: 'history-result' }, describeRecord(record, names)),
              ),
            ),
          ),
          h(
            'div',
            { class: 'actions' },
            button('Do menu', o.onMenu, 'btn btn-ghost'),
            button('Hrát znovu', o.onRematch, 'btn btn-primary btn-lg', { 'data-autofocus': true }),
          ),
        ),
      ),
    );
    o.sfx.play(o.mode === 'pve' && winner === 'B' ? 'lose' : 'win');
  };
}
