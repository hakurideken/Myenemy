import { GAMES } from '../../games/registry';
import type { App, Mount } from '../App';
import { button, logo } from '../components/common';
import { h } from '../dom';
import { lang, translations } from '../../i18n';
import { plural } from '../labels';

const t = translations(
  {
    heading: 'Myenemy – hlavní menu',
    greeting: 'Vítej v aréně, ',
    nav: 'Hlavní menu',
    pve: 'Proti AI',
    pveSub: 'Lehká, střední nebo těžká obtížnost',
    local: 'Dva hráči',
    localSub: 'Souboj na jednom zařízení',
    online: 'Online 1v1',
    onlineSub: 'Založ místnost nebo se připoj kódem',
    onlineOff: 'Na tomhle webu zatím nenastaveno',
    settings: 'Nastavení',
    nickname: 'Změnit přezdívku',
    games: (n: number) => `${n} ${plural(n, 'minihra', 'minihry', 'miniher')} v arzenálu: `,
  },
  {
    heading: 'Myenemy – main menu',
    greeting: 'Welcome to the arena, ',
    nav: 'Main menu',
    pve: 'Vs. AI',
    pveSub: 'Easy, medium or hard',
    local: 'Two players',
    localSub: 'Duel on one device',
    online: 'Online 1v1',
    onlineSub: 'Create a room or join with a code',
    onlineOff: 'Not set up on this site yet',
    settings: 'Settings',
    nickname: 'Change nickname',
    games: (n: number) => `${n} ${n === 1 ? 'minigame' : 'minigames'} in the arsenal: `,
  },
);

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
        h('h1', { class: 'sr-only', tabindex: '-1' }, t.heading),
        h('p', { class: 'menu-greeting' }, t.greeting, h('strong', null, app.nickname ?? ''), '!'),
        h(
          'nav',
          { class: 'menu', 'aria-label': t.nav },
          menuButton(t.pve, t.pveSub, () => app.goSetup('pve'), true),
          menuButton(t.local, t.localSub, () => app.goSetup('local')),
          menuButton(t.online, app.onlineAvailable ? t.onlineSub : t.onlineOff, () =>
            app.goOnline(),
          ),
          h(
            'div',
            { class: 'menu-row' },
            button(t.settings, () => app.goSettings(), 'btn btn-ghost'),
            button(t.nickname, () => app.goNickname(), 'btn btn-ghost'),
          ),
          // Přepínač jazyka hned v menu – v jazyce, na který se přepne.
          button(
            lang() === 'en' ? 'Čeština' : 'English',
            () => app.switchLanguage(lang() === 'en' ? 'cs' : 'en'),
            'btn btn-ghost menu-lang',
            { lang: lang() === 'en' ? 'cs' : 'en' },
          ),
        ),
        h('p', { class: 'menu-games' }, t.games(count), GAMES.map((g) => g.name).join(', ')),
      ),
    );
  };
}
