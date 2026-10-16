import { GAMES } from '../../games/registry';
import type { App, Mount } from '../App';
import { button, logo } from '../components/common';
import { h } from '../dom';
import { plural } from '../labels';

function menuButton(
  title: string,
  subtitle: string,
  onclick: (() => void) | null,
  autofocus = false,
): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: 'menu-btn',
      disabled: onclick === null,
      onclick: onclick ?? undefined,
      'data-autofocus': autofocus,
    },
    h('span', { class: 'menu-btn-title' }, title),
    h('span', { class: 'menu-btn-sub' }, subtitle),
  );
}

export function menuScreen(app: App): Mount {
  return (root) => {
    const count = GAMES.length;
    root.append(
      h(
        'main',
        { class: 'screen screen--menu screen--center' },
        logo(true),
        h('h1', { class: 'sr-only', tabindex: '-1' }, 'Myenemy – hlavní menu'),
        h(
          'p',
          { class: 'menu-greeting' },
          'Vítej v aréně, ',
          h('strong', null, app.nickname ?? ''),
          '!',
        ),
        h(
          'nav',
          { class: 'menu', 'aria-label': 'Hlavní menu' },
          menuButton(
            'Proti AI',
            'Lehká, střední nebo těžká obtížnost',
            () => app.goSetup('pve'),
            true,
          ),
          menuButton('Dva hráči', 'Souboj na jednom zařízení', () => app.goSetup('local')),
          menuButton('Online 1v1', 'Připravujeme – přijde v další fázi', null),
          h(
            'div',
            { class: 'menu-row' },
            button('Nastavení', () => app.goSettings(), 'btn btn-ghost'),
            button('Změnit přezdívku', () => app.goNickname(), 'btn btn-ghost'),
          ),
        ),
        h(
          'p',
          { class: 'menu-games' },
          `${count} ${plural(count, 'minihra', 'minihry', 'miniher')} v arzenálu: `,
          GAMES.map((g) => g.name).join(', '),
        ),
      ),
    );
  };
}
