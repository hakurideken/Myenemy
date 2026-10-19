import type { EndReason, RoundRecord } from '../../core/match/MatchController';
import type { Sfx } from '../../core/MiniGame';
import { otherPlayer, type PerPlayer, type PlayerSlot } from '../../core/types';
import { getGame } from '../../games/registry';
import type { Mount } from '../App';
import { bigScore, button } from '../components/common';
import { trophyIcon } from '../components/icons';
import { h } from '../dom';
import { translations } from '../../i18n';
import { endReasonText } from '../labels';

const t = translations(
  {
    draw: 'remíza',
    coin: (name: string) => `${name} (los)`,
    playAgain: 'Hrát znovu',
    noRematch: 'Odveta není možná',
    opponentWants: '✓ Soupeř chce odvetu!',
    waiting: 'Čekám na soupeře…',
    accept: 'Přijmout odvetu',
    end: 'Konec zápasu',
    winner: (name: string) => `${name} vyhrává zápas!`,
    history: 'Průběh zápasu',
    replay: (n: number) => ` · rozhodující kolo ${n}`,
    menu: 'Do menu',
  },
  {
    draw: 'draw',
    coin: (name: string) => `${name} (coin flip)`,
    playAgain: 'Play again',
    noRematch: 'Rematch not possible',
    opponentWants: '✓ Your opponent wants a rematch!',
    waiting: 'Waiting for the opponent…',
    accept: 'Accept rematch',
    end: 'Match over',
    winner: (name: string) => `${name} wins the match!`,
    history: 'Match history',
    replay: (n: number) => ` · deciding round ${n}`,
    menu: 'Menu',
  },
);

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
  if (record.outcome.kind === 'draw') return t.draw;
  const name = names[record.outcome.winner];
  return record.byCoin ? t.coin(name) : name;
}

function rematchControls(o: MatchResultOptions): HTMLElement[] {
  const online = o.online;
  if (!online || o.me === null) {
    return [button(t.playAgain, o.onRematch, 'btn btn-primary btn-lg', { 'data-autofocus': true })];
  }
  if (!online.canRematch) {
    return [button(t.noRematch, () => undefined, 'btn btn-lg', { disabled: true })];
  }
  const opponentWants = online.rematch[otherPlayer(o.me)];
  const status = opponentWants
    ? h('p', { class: 'ready-status is-ready', 'aria-live': 'polite' }, t.opponentWants)
    : null;
  const action = online.rematch[o.me]
    ? button(t.waiting, () => undefined, 'btn btn-primary btn-lg', { disabled: true })
    : button(opponentWants ? t.accept : t.playAgain, o.onRematch, 'btn btn-primary btn-lg', {
        'data-autofocus': true,
      });
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
          h('p', { class: 'kicker' }, t.end),
          h('h1', { class: 'result-title', tabindex: '-1' }, t.winner(names[winner])),
          reasonText ? h('p', { class: 'result-summary' }, reasonText) : null,
          bigScore(o.score, null),
          o.history.length > 0
            ? h(
                'ol',
                { class: 'history', 'aria-label': t.history },
                o.history.map((record) =>
                  h(
                    'li',
                    null,
                    h('span', { class: 'history-no' }, `${record.gameNo}.`),
                    h(
                      'span',
                      null,
                      getGame(record.gameId).name,
                      record.replay > 0 && !record.byCoin ? t.replay(record.replay) : '',
                    ),
                    h('span', { class: 'history-result' }, describeRecord(record, names)),
                  ),
                ),
              )
            : null,
          h(
            'div',
            { class: 'actions' },
            button(t.menu, o.onMenu, 'btn btn-ghost'),
            rematchControls(o),
          ),
        ),
      ),
    );
    o.sfx.play(o.me !== null && winner !== o.me ? 'lose' : 'win');
  };
}
