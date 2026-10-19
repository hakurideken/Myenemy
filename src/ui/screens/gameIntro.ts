import type { CurrentGame } from '../../core/match/MatchController';
import { MAX_DRAW_REPLAYS } from '../../core/match/MatchController';
import type { AnyMiniGameModule } from '../../core/MiniGame';
import { otherPlayer, type GameMode, type PerPlayer, type PlayerSlot } from '../../core/types';
import type { Mount } from '../App';
import { button, chip, scoreBar } from '../components/common';
import { h } from '../dom';
import { translations } from '../../i18n';
import { LENGTH_LABEL, TYPE_LABEL } from '../labels';

const t = translations(
  {
    start: 'Start',
    opponentReady: '✓ Soupeř je připravený',
    opponentReading: '… Soupeř si čte pravidla',
    waiting: 'Čekám na soupeře…',
    ready: 'Připraven',
    replay: (replay: number, max: number) => `Remíza → rozhodující kolo ${replay}/${max}`,
    progress: (gameNo: number, max: number) => `Hra ${gameNo} z max. ${max}`,
    rules: 'Pravidla',
    controls: 'Ovládání',
  },
  {
    start: 'Start',
    opponentReady: '✓ Your opponent is ready',
    opponentReading: '… Your opponent is reading the rules',
    waiting: 'Waiting for the opponent…',
    ready: 'Ready',
    replay: (replay: number, max: number) => `Draw → deciding round ${replay}/${max}`,
    progress: (gameNo: number, max: number) => `Game ${gameNo} of max. ${max}`,
    rules: 'Rules',
    controls: 'Controls',
  },
);

interface GameIntroOptions {
  readonly game: AnyMiniGameModule;
  readonly current: CurrentGame;
  readonly mode: GameMode;
  readonly names: PerPlayer<string>;
  readonly score: Readonly<PerPlayer<number>>;
  readonly onStart: () => void;
  readonly onLeave: () => void;
  /** Online: kolo začne, až budou připravení oba. */
  readonly online?: { readonly me: PlayerSlot; readonly ready: PerPlayer<boolean> };
}

function startControls(o: GameIntroOptions): HTMLElement[] {
  if (!o.online) {
    return [button(t.start, o.onStart, 'btn btn-primary btn-lg', { 'data-autofocus': true })];
  }
  const { me, ready } = o.online;
  const opponentReady = ready[otherPlayer(me)];
  const status = h(
    'p',
    { class: `ready-status${opponentReady ? ' is-ready' : ''}`, 'aria-live': 'polite' },
    opponentReady ? t.opponentReady : t.opponentReading,
  );
  const action = ready[me]
    ? button(t.waiting, () => undefined, 'btn btn-primary btn-lg', { disabled: true })
    : button(t.ready, o.onStart, 'btn btn-primary btn-lg', { 'data-autofocus': true });
  return [status, action];
}

export function gameIntroScreen(o: GameIntroOptions): Mount {
  return (root) => {
    const { game, current } = o;
    const kicker =
      current.replay > 0
        ? t.replay(current.replay, MAX_DRAW_REPLAYS)
        : t.progress(current.gameNo, current.maxGames);
    root.append(
      h(
        'main',
        { class: 'screen' },
        scoreBar({
          names: o.names,
          score: o.score,
          current,
          gameName: game.name,
          heading: false,
          onLeave: o.onLeave,
        }),
        h(
          'section',
          { class: 'card intro' },
          h('p', { class: 'kicker' }, kicker),
          h('h1', { class: 'intro-title', tabindex: '-1' }, game.name),
          h('p', { class: 'chips' }, chip(TYPE_LABEL[game.type]), chip(LENGTH_LABEL[game.length])),
          h('h2', { class: 'intro-heading' }, t.rules),
          h(
            'ul',
            { class: 'rules' },
            game.rules.map((rule) => h('li', null, rule)),
          ),
          h('h2', { class: 'intro-heading' }, t.controls),
          h(
            'ul',
            { class: 'rules' },
            game.controls(o.mode).map((line) => h('li', null, line)),
          ),
          startControls(o),
        ),
      ),
    );
  };
}
