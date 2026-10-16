import type { CurrentGame } from '../../core/match/MatchController';
import type { PerPlayer, PlayerSlot } from '../../core/types';
import { h, type Attrs, type Child } from '../dom';
import { gameProgress } from '../labels';
import { swordsIcon } from './icons';

export function logo(big = false): HTMLElement {
  return h(
    'div',
    { class: big ? 'logo logo--big' : 'logo' },
    swordsIcon(),
    h(
      'span',
      { class: 'logo-text' },
      h('span', { class: 'logo-my' }, 'MY'),
      h('span', { class: 'logo-enemy' }, 'ENEMY'),
    ),
  );
}

export function button(
  label: Child,
  onclick: () => void,
  variant = 'btn',
  attrs: Attrs = {},
): HTMLButtonElement {
  return h('button', { type: 'button', class: variant, onclick, ...attrs }, label);
}

export function versus(names: PerPlayer<string>): HTMLElement {
  return h(
    'div',
    { class: 'versus' },
    h('span', { class: 'versus-name versus-name--a' }, names.A),
    h('span', { class: 'versus-vs', 'aria-label': 'proti' }, 'VS'),
    h('span', { class: 'versus-name versus-name--b' }, names.B),
  );
}

export interface ScoreBarOptions {
  readonly names: PerPlayer<string>;
  readonly score: Readonly<PerPlayer<number>>;
  readonly current: CurrentGame;
  readonly gameName: string;
  /** Na herní obrazovce je název hry hlavním nadpisem stránky. */
  readonly heading: boolean;
  readonly onLeave?: () => void;
}

export function scoreBar(o: ScoreBarOptions): HTMLElement {
  const title = o.heading
    ? h('h1', { class: 'scorebar-game', tabindex: '-1' }, o.gameName)
    : h('p', { class: 'scorebar-game' }, o.gameName);
  return h(
    'header',
    { class: 'scorebar', 'aria-label': 'Skóre zápasu' },
    h(
      'div',
      { class: 'scorebar-player scorebar-player--a' },
      h('span', { class: 'scorebar-name' }, o.names.A),
      h('span', { class: 'scorebar-score', 'aria-label': `${o.names.A}: ${o.score.A}` }, o.score.A),
    ),
    h(
      'div',
      { class: 'scorebar-center' },
      title,
      h('p', { class: 'scorebar-meta' }, gameProgress(o.current)),
    ),
    h(
      'div',
      { class: 'scorebar-player scorebar-player--b' },
      h('span', { class: 'scorebar-score', 'aria-label': `${o.names.B}: ${o.score.B}` }, o.score.B),
      h('span', { class: 'scorebar-name' }, o.names.B),
    ),
    o.onLeave
      ? h(
          'button',
          {
            type: 'button',
            class: 'scorebar-leave btn-icon',
            'aria-label': 'Opustit zápas',
            title: 'Opustit zápas',
            onclick: o.onLeave,
          },
          '✕',
        )
      : null,
  );
}

export function bigScore(score: Readonly<PerPlayer<number>>, bump: PlayerSlot | null): HTMLElement {
  const part = (p: PlayerSlot): HTMLElement =>
    h('span', { class: `big-score-${p.toLowerCase()}${bump === p ? ' is-bump' : ''}` }, score[p]);
  return h(
    'p',
    { class: 'big-score', 'aria-label': `Skóre ${score.A} : ${score.B}` },
    part('A'),
    h('span', { class: 'big-score-sep', 'aria-hidden': 'true' }, ':'),
    part('B'),
  );
}

export function chip(text: string): HTMLElement {
  return h('span', { class: 'chip' }, text);
}
