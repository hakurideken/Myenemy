import { lang, translations } from '../../i18n';
import { formatHandle, type AccountState } from '../../net/account';
import type { App } from '../App';
import { openAccountDialog } from '../screens/account';
import { h, setText } from '../dom';
import { plural } from '../labels';
import { logo } from './common';
import { gearIcon, userIcon } from './icons';

const t = translations(
  {
    nav: 'Jazyk, nastavení a účet',
    home: 'Myenemy – hlavní menu',
    settings: 'Nastavení',
    switchTo: 'Přepnout do angličtiny',
    signIn: 'Přihlásit',
    loading: 'Přihlašuji…',
    finish: 'Dokončit profil',
    account: (handle: string) => `Účet ${handle}`,
    requests: (n: number) =>
      `${n} ${plural(n, 'nová žádost', 'nové žádosti', 'nových žádostí')} o přátelství`,
  },
  {
    nav: 'Language, settings and account',
    home: 'Myenemy – main menu',
    settings: 'Settings',
    switchTo: 'Switch to Czech',
    signIn: 'Sign in',
    loading: 'Signing in…',
    finish: 'Finish profile',
    account: (handle: string) => `Account ${handle}`,
    requests: (n: number) => (n === 1 ? '1 new friend request' : `${n} new friend requests`),
  },
);

export interface TopBar {
  readonly el: HTMLElement;
  update(): void;
}

function accountLabel(state: AccountState): string {
  switch (state.kind) {
    case 'unavailable':
    case 'guest':
      return t.signIn;
    case 'loading':
      return t.loading;
    case 'signed-in':
      return state.profile ? formatHandle(state.profile) : t.finish;
  }
}

/**
 * Lišta nahoře: vlevo logo (návrat do menu), vpravo jazyk, nastavení, přihlášení. Během zápasu se skrývá
 * (přepnutí jazyka načte stránku znovu a rozehraný zápas by se ztratil).
 */
export function createTopBar(app: App): TopBar {
  const other = lang() === 'en' ? 'cs' : 'en';
  // Odkaz na úvodní adresu (funguje i otevřením v nové záložce), v aplikaci přepne do menu.
  const home = h(
    'a',
    {
      href: window.location.pathname,
      class: 'topbar-home',
      'aria-label': t.home,
      title: t.home,
      onclick: (event: MouseEvent) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        app.goMenu();
      },
    },
    logo(),
  );
  const langButton = h(
    'button',
    {
      type: 'button',
      class: 'topbar-btn topbar-lang',
      lang: other,
      'aria-label': t.switchTo,
      onclick: () => app.switchLanguage(other),
    },
    other.toUpperCase(),
  );
  const settingsButton = h(
    'button',
    {
      type: 'button',
      class: 'topbar-btn',
      'aria-label': t.settings,
      title: t.settings,
      onclick: () => app.goSettings(),
    },
    gearIcon(),
  );
  const accountText = h('span', { class: 'topbar-account-text' });
  const dot = h('span', { class: 'topbar-dot', 'aria-hidden': 'true', hidden: true });
  const accountButton = h(
    'button',
    {
      type: 'button',
      class: 'topbar-btn topbar-account',
      onclick: () => openAccountDialog(app),
    },
    userIcon(),
    accountText,
    dot,
  );
  const el = h(
    'nav',
    { class: 'app-topbar', 'aria-label': t.nav },
    home,
    langButton,
    settingsButton,
    accountButton,
  );

  return {
    el,
    update() {
      const state = app.account.state;
      accountButton.hidden = state.kind === 'unavailable';
      accountButton.disabled = state.kind === 'loading';
      const label = accountLabel(state);
      setText(accountText, label);
      const incoming = state.kind === 'signed-in' ? state.incoming : 0;
      dot.hidden = incoming === 0;
      const name = state.kind === 'signed-in' && state.profile ? t.account(label) : label;
      accountButton.setAttribute(
        'aria-label',
        incoming > 0 ? `${name}, ${t.requests(incoming)}` : name,
      );
      accountButton.classList.toggle('is-signed-in', state.kind === 'signed-in');
    },
  };
}
