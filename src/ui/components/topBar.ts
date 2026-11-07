import { lang, translations } from '../../i18n';
import { formatHandle, type AccountState } from '../../net/account';
import type { App } from '../App';
import { openAccountDialog } from '../screens/account';
import { h, setText } from '../dom';
import { gearIcon, userIcon } from './icons';

const t = translations(
  {
    nav: 'Jazyk, nastavení a účet',
    settings: 'Nastavení',
    switchTo: 'Přepnout do angličtiny',
    signIn: 'Přihlásit',
    loading: 'Přihlašuji…',
    finish: 'Dokončit profil',
    account: (handle: string) => `Účet ${handle}`,
  },
  {
    nav: 'Language, settings and account',
    settings: 'Settings',
    switchTo: 'Switch to Czech',
    signIn: 'Sign in',
    loading: 'Signing in…',
    finish: 'Finish profile',
    account: (handle: string) => `Account ${handle}`,
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
 * Lišta vpravo nahoře: jazyk, nastavení, přihlášení. Během zápasu se skrývá
 * (přepnutí jazyka načte stránku znovu a rozehraný zápas by se ztratil).
 */
export function createTopBar(app: App): TopBar {
  const other = lang() === 'en' ? 'cs' : 'en';
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
  const accountButton = h(
    'button',
    {
      type: 'button',
      class: 'topbar-btn topbar-account',
      onclick: () => openAccountDialog(app),
    },
    userIcon(),
    accountText,
  );
  const el = h(
    'nav',
    { class: 'app-topbar', 'aria-label': t.nav },
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
      accountButton.setAttribute(
        'aria-label',
        state.kind === 'signed-in' && state.profile ? t.account(label) : label,
      );
      accountButton.classList.toggle('is-signed-in', state.kind === 'signed-in');
    },
  };
}
