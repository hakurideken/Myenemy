import type { EndReason, RoundRecord } from '../../core/match/MatchController';
import type { Sfx } from '../../core/MiniGame';
import { otherPlayer, type PerPlayer, type PlayerSlot } from '../../core/types';
import { getGame } from '../../games/registry';
import type { Mount } from '../App';
import { bigScore, button } from '../components/common';
import { trophyIcon } from '../components/icons';
import { h } from '../dom';
import { endReasonText } from '../labels';

interface MatchResultOptions {
  readonly names: PerPlayer<string>;
  readonly winner: PlayerSlot;
  readonly score: Readonly<PerPlayer<number>>;
  readonly history: readonly RoundRecord[];
  /** Hráč na tomto zařízení (PvE, online); null = lokálně dva hráči. */
  readonly me: PlayerSlot | null;
  readonly sfx: Sfx;
  readonly onRematch: () => void;
  readonly onMenu: () => void;
  readonly online?: {
    readonly reason: EndReason;
    readonly detail: string | null;
    readonly rematch: PerPlayer<boolean>;
    readonly canRematch: boolean;
  };
}

function describeRecord(record: RoundRecord, names: PerPlayer<string>): string {
  if (record.outcome.kind === 'draw') return 'remíza';
  const name = names[record.outcome.winner];
  return record.byCoin ? `${name} (los)` : name;
}

function rematchControls(o: MatchResultOptions): HTMLElement[] {
  const online = o.online;
  if (!online || o.me === null) {
    return [
      button('Hrát znovu', o.onRematch, 'btn btn-primary btn-lg', { 'data-autofocus': true }),
    ];
  }
  if (!online.canRematch) {
    return [button('Odveta není možná', () => undefined, 'btn btn-lg', { disabled: true })];
  }
  const opponentWants = online.rematch[otherPlayer(o.me)];
  const status = opponentWants
    ? h('p', { class: 'ready-status is-ready', 'aria-live': 'polite' }, '✓ Soupeř chce odvetu!')
    : null;
  const action = online.rematch[o.me]
    ? button('Čekám na soupeře…', () => undefined, 'btn btn-primary btn-lg', { disabled: true })
    : button(
        opponentWants ? 'Přijmout odvetu' : 'Hrát znovu',
        o.onRematch,
        'btn btn-primary btn-lg',
        {
          'data-autofocus': true,
        },
      );
  return status ? [status, action] : [action];
}

export function matchResultScreen(o: MatchResultOptions): Mount {
  return (root) => {
    const { names, winner } = o;
    const reasonText = o.online
      ? endReasonText(o.online.reason, o.me === winner, o.online.detail)
      : null;
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
          reasonText ? h('p', { class: 'result-summary' }, reasonText) : null,
          bigScore(o.score, null),
          o.history.length > 0
            ? h(
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
                      record.replay > 0 && !record.byCoin
                        ? ` · rozhodující kolo ${record.replay}`
                        : '',
                    ),
                    h('span', { class: 'history-result' }, describeRecord(record, names)),
                  ),
                ),
              )
            : null,
          h(
            'div',
            { class: 'actions' },
            button('Do menu', o.onMenu, 'btn btn-ghost'),
            rematchControls(o),
          ),
        ),
      ),
    );
    o.sfx.play(o.me !== null && winner !== o.me ? 'lose' : 'win');
  };
}
