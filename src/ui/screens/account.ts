import { translations } from '../../i18n';
import {
  AccountError,
  AUTH_PROVIDERS,
  formatHandle,
  type AccountErrorCode,
  type AuthProvider,
} from '../../net/account';
import type { App, Mount } from '../App';
import { button } from '../components/common';
import { h, setText } from '../dom';
import { plural } from '../labels';

const t = translations(
  {
    signInTitle: 'Přihlášení',
    signInLead:
      'Účet je jen pro kamarády a vzájemné výsledky. Hrát můžeš dál i bez něj – jako host.',
    age: 'Účet si může založit jen hráč od 15 let.',
    via: { google: 'Přihlásit přes Google', discord: 'Přihlásit přes Discord' },
    privacy: 'Ochrana soukromí',
    close: 'Zavřít',
    accountTitle: 'Tvůj účet',
    signedInAs: 'Tvoje jméno pro kamarády:',
    handleHint: 'Kamarádům dej celé jméno i s kódem za #.',
    noProfile: 'Přezdívka zatím chybí.',
    friends: (n: number) =>
      n > 0
        ? `Kamarádi (${n} ${plural(n, 'nová žádost', 'nové žádosti', 'nových žádostí')})`
        : 'Kamarádi',
    changeNickname: 'Změnit přezdívku',
    chooseNickname: 'Zvolit přezdívku',
    signOut: 'Odhlásit',
    exportData: 'Stáhnout moje data',
    delete: 'Smazat účet',
    deleteTitle: 'Smazat účet?',
    deleteText:
      'Účet, přezdívka, kamarádi i výsledky se smažou hned a nejdou obnovit. Hrát můžeš dál jako host.',
    deleteConfirm: 'Smazat natrvalo',
    deleteKeep: 'Ponechat',
    errors: {
      invalid: 'Tahle přezdívka nejde použít.',
      full: 'Tahle přezdívka je obsazená se všemi kódy – zkus jinou.',
      'too-soon': 'Přezdívku jde měnit nejvýš jednou za 10 minut.',
      limit: 'Příliš mnoho pokusů za krátkou dobu – zkus to zase zítra.',
      network: 'Spojení se nepovedlo. Zkus to znovu za chvíli.',
      'login-failed': 'Přihlášení se nepovedlo. Zkus to znovu.',
      'sign-out-failed':
        'V tomhle prohlížeči je odhlášení hotové, ale přihlášení na serveru se zrušit nepovedlo. Pokud máš účet otevřený i jinde, odhlas se tam.',
    } satisfies Record<AccountErrorCode, string>,
    privacyTitle: 'Ochrana soukromí',
    privacyBack: 'Zpět',
    sections: [
      {
        title: 'Bez účtu (host)',
        text: 'Přezdívka a nastavení zůstávají jen v tomhle prohlížeči. Online hra posílá herní zprávy přes Supabase Realtime. Jsou podepsané (nikdo je nemůže podvrhnout), ale nejsou šifrované – kdo zná kód místnosti, může je číst. Nikde se neukládají.',
      },
      {
        title: 'Co ukládáme s účtem',
        text: 'Přihlašuješ se přes Google nebo Discord. Od poskytovatele dostaneme identifikátor účtu, e-mail a údaje z profilu, které předá (jméno, odkaz na obrázek, u Discordu uživatelské jméno). K tomu tvou přezdívku s kódem, data vytvoření a změn a časy přihlášení. Supabase u přihlášení eviduje i technické záznamy (IP adresa a prohlížeč) kvůli bezpečnosti. Dál seznam kamarádů a žádosti o přátelství (čekají, dokud na ně někdo neodpoví; odmítnutí nebo odebrání z kamarádů si pamatujeme 30 dní, aby stejný hráč nemohl žádosti opakovat). Po každém online zápasu přihlášeného hráče se uloží hlášení výsledku pod náhodným klíčem zápasu: když ho soupeř-kamarád shodně potvrdí, započte se do vašeho skóre (kdo vyhrál a kdy), jinak se asi po 2 dnech smaže. Kamarádi vidí jen tvé jméno s kódem, vaše vzájemné skóre a interní identifikátor účtu (kvůli odebrání z kamarádů); kdo ti poslal žádost, u ní vidí jen jméno z doby odeslání. Když jsi přihlášený(á) a hra je otevřená, ukládá se každých ~15 s čas posledního ozvání a jestli zrovna hraješ – kamarádi z toho vidí jen „online“, „ve hře“ (i proti AI) nebo „offline“, tedy i kdy hraješ (vypnout jde v Nastavení; pak se čas neukládá). Čas se po 10 minutách nečinnosti smaže při nejbližším úklidu. Pozvánka do hry nese kód online místnosti, po 10 minutách přestane platit a smaže se při nejbližším úklidu. Kvůli omezení spamu si den až dva pamatujeme, kdy jsi poslal(a) žádost, pozvánku nebo hlášení výsledku. Odebráním kamaráda se smaže i vaše vzájemné skóre a pozvánky.',
      },
      {
        title: 'Proč a na jakém základě',
        text: 'Jen kvůli přihlášení, kamarádům a vzájemným výsledkům – tedy kvůli službě, o kterou si řekneš založením účtu (plnění smlouvy, čl. 6 odst. 1 písm. b GDPR). Žádná reklama, profilování ani sledovací cookies; v prohlížeči se ukládá jen přihlášení (localStorage).',
      },
      {
        title: 'Kdo data zpracovává',
        text: 'Databáze a přihlášení běží u Supabase v datacentru v EU (Irsko). Přihlášení ověřuje Google nebo Discord podle tvé volby – ti můžou data zpracovávat i mimo EU podle svých pravidel.',
      },
      {
        title: 'Jak dlouho a tvoje práva',
        text: 'Data držíme, dokud máš účet. V okně účtu si je můžeš stáhnout („Stáhnout moje data“) a celý účet smazat („Smazat účet“) – profil i přihlášení zmizí okamžitě, bezpečnostní záznamy o přihlášení maže Supabase podle své doby uchování. Máš i právo na opravu a právo podat stížnost u Úřadu pro ochranu osobních údajů (uoou.cz).',
      },
      { title: 'Věk', text: 'Účet si může založit jen hráč od 15 let. Mladší hrají jako host.' },
      {
        title: 'Kontakt',
        text: 'Provozovatel hry: autor projektu Myenemy. Dotazy a žádosti: přes GitHub (hakurideken/Myenemy).',
      },
    ],
  },
  {
    signInTitle: 'Sign in',
    signInLead:
      'An account is only for friends and head-to-head results. You can keep playing without one, as a guest.',
    age: 'You must be at least 15 to create an account.',
    via: { google: 'Sign in with Google', discord: 'Sign in with Discord' },
    privacy: 'Privacy',
    close: 'Close',
    accountTitle: 'Your account',
    signedInAs: 'Your name for friends:',
    handleHint: 'Give your friends the full name including the code after #.',
    noProfile: 'No nickname yet.',
    friends: (n: number) => (n > 0 ? `Friends (${n} new)` : 'Friends'),
    changeNickname: 'Change nickname',
    chooseNickname: 'Pick a nickname',
    signOut: 'Sign out',
    exportData: 'Download my data',
    delete: 'Delete account',
    deleteTitle: 'Delete account?',
    deleteText:
      'Your account, nickname, friends and results are deleted right away and cannot be restored. You can keep playing as a guest.',
    deleteConfirm: 'Delete for good',
    deleteKeep: 'Keep',
    errors: {
      invalid: 'This nickname cannot be used.',
      full: 'This nickname is taken with every code – try another.',
      'too-soon': 'You can change your nickname at most once every 10 minutes.',
      limit: 'Too many attempts in a short time – try again tomorrow.',
      network: 'Could not connect. Try again in a moment.',
      'login-failed': 'Sign-in failed. Please try again.',
      'sign-out-failed':
        'You are signed out here, but the sign-in on the server could not be revoked. If you are signed in elsewhere, sign out there too.',
    } satisfies Record<AccountErrorCode, string>,
    privacyTitle: 'Privacy',
    privacyBack: 'Back',
    sections: [
      {
        title: 'Without an account (guest)',
        text: 'Your nickname and settings stay in this browser only. Online play sends game messages through Supabase Realtime. They are signed (nobody can forge them) but not encrypted – anyone who knows the room code can read them. Nothing is stored.',
      },
      {
        title: 'What we store with an account',
        text: 'You sign in with Google or Discord. From the provider we receive the account identifier, e-mail and the profile details it passes on (name, picture link, Discord username). Plus your nickname with its code, creation and change dates and sign-in times. Supabase also keeps technical sign-in records (IP address and browser) for security. Also your friends list and friend requests (kept until someone answers; a decline or removal from friends is remembered for 30 days so the same player cannot keep repeating requests). After every online match of a signed-in player, a result report is stored under a random match key: if the opponent – a friend – confirms it, it counts towards your score (who won and when), otherwise it is deleted after about 2 days. Friends only see your name with its code, your head-to-head score and an internal account identifier (used to remove a friend); someone you sent a request to only sees the name from when it was sent. While you are signed in and the game is open, the time you were last active and whether you are in a match are stored about every 15 s – friends only see “online”, “in a game” (also against the AI) or “offline”, i.e. also when you play (it can be turned off in Settings; then the time is not stored). The time is deleted after 10 minutes of inactivity at the next clean-up. A game invite carries the online room code, stops being valid after 10 minutes and is deleted at the next clean-up. To limit spam we remember for a day or two when you sent a request, an invite or a result report. Removing a friend deletes your head-to-head score and invites too.',
      },
      {
        title: 'Why and on what basis',
        text: 'Only for sign-in, friends and head-to-head results – the service you ask for by creating an account (performance of a contract, Art. 6(1)(b) GDPR). No ads, profiling or tracking cookies; the browser stores only your sign-in (localStorage).',
      },
      {
        title: 'Who processes the data',
        text: 'The database and sign-in run at Supabase in an EU data centre (Ireland). Sign-in is verified by Google or Discord, whichever you choose – they may process data outside the EU under their own terms.',
      },
      {
        title: 'How long and your rights',
        text: 'We keep the data while you have an account. In the account window you can download it (“Download my data”) and delete the whole account (“Delete account”) – the profile and sign-in disappear immediately; Supabase deletes security sign-in records after its retention period. You also have the right to rectification and to lodge a complaint with your data protection authority.',
      },
      {
        title: 'Age',
        text: 'You must be at least 15 to create an account. Younger players play as guests.',
      },
      {
        title: 'Contact',
        text: 'Operator: the author of the Myenemy project. Questions and requests: via GitHub (hakurideken/Myenemy).',
      },
    ],
  },
);

/** Texty zásad soukromí (stejné jsou i ve statické public/privacy.html pro Google). */
export function privacySections(): readonly { title: string; text: string }[] {
  return t.sections;
}

export function accountErrorText(err: unknown): string {
  return t.errors[err instanceof AccountError ? err.code : 'network'];
}

/** Stáhne data účtu jako JSON soubor. */
function download(data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: 'myenemy-data.json' });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Okno účtu z lišty: host se přihlásí, přihlášený vidí svůj #kód a správu účtu. */
export function openAccountDialog(app: App): void {
  // Ve vloženém rámu cizí stránky (clickjacking) se akce účtu vůbec nenabízí.
  if (window.top !== window.self) return;
  const state = app.account.state;
  const error = h('p', { class: 'field-error', 'aria-live': 'polite' });
  const showError = (err: unknown): void => setText(error, accountErrorText(err));

  if (state.kind !== 'signed-in') {
    const providerButtons = AUTH_PROVIDERS.map((provider: AuthProvider) =>
      button(
        t.via[provider],
        () => {
          for (const b of providerButtons) b.disabled = true;
          app.account.signIn(provider).catch((err: unknown) => {
            showError(err);
            for (const b of providerButtons) b.disabled = false;
          });
        },
        `btn btn-provider btn-provider--${provider}`,
      ),
    );
    const dialog = app.dialog({
      title: t.signInTitle,
      body: [
        h('p', { class: 'dialog-text' }, t.signInLead),
        h('p', { class: 'dialog-text' }, t.age),
        error,
      ],
      actions: [
        ...providerButtons,
        button(
          t.privacy,
          () => {
            dialog.close();
            app.goPrivacy();
          },
          'btn btn-ghost',
        ),
        button(t.close, () => dialog.close(), 'btn btn-ghost'),
      ],
    });
    if (state.kind === 'guest' && state.error) setText(error, t.errors[state.error]);
    return;
  }

  const profile = state.profile;
  const dialog = app.dialog({
    title: t.accountTitle,
    body: profile
      ? [
          h('p', { class: 'dialog-text' }, t.signedInAs),
          h('p', { class: 'account-handle' }, formatHandle(profile)),
          h('p', { class: 'dialog-text' }, t.handleHint),
          error,
        ]
      : [h('p', { class: 'dialog-text' }, t.noProfile), error],
    actions: [
      ...(profile
        ? [
            button(
              t.friends(state.incoming),
              () => {
                dialog.close();
                app.goFriends();
              },
              'btn btn-primary',
            ),
          ]
        : []),
      button(
        profile ? t.changeNickname : t.chooseNickname,
        () => {
          dialog.close();
          app.goNickname();
        },
        profile ? 'btn' : 'btn btn-primary',
      ),
      button(t.signOut, () => {
        app.account.signOut().then(
          () => dialog.close(),
          (err: unknown) => showError(err),
        );
      }),
      button(t.exportData, () => {
        app.account.exportData().then(download, showError);
      }),
      button(
        t.delete,
        () => {
          dialog.close();
          void app
            .confirm({
              title: t.deleteTitle,
              message: t.deleteText,
              confirm: t.deleteConfirm,
              cancel: t.deleteKeep,
            })
            .then((yes) => {
              if (!yes) return;
              app.account.deleteAccount().catch((err: unknown) => {
                const retry = app.dialog({
                  title: t.accountTitle,
                  body: [h('p', { class: 'field-error' }, accountErrorText(err))],
                  actions: [button(t.close, () => retry.close())],
                });
              });
            });
        },
        'btn btn-danger',
      ),
      button(
        t.privacy,
        () => {
          dialog.close();
          app.goPrivacy();
        },
        'btn btn-ghost',
      ),
      button(t.close, () => dialog.close(), 'btn btn-ghost'),
    ],
  });
}

export function privacyScreen(app: App): Mount {
  return (root) => {
    root.append(
      h(
        'main',
        { class: 'screen screen--narrow' },
        h('h1', { class: 'screen-title', tabindex: '-1' }, t.privacyTitle),
        ...t.sections.map(({ title, text }) =>
          h('section', { class: 'card privacy-section' }, h('h2', null, title), h('p', null, text)),
        ),
        button(t.privacyBack, () => app.goMenu(), 'btn btn-primary btn-lg', {
          'data-autofocus': true,
        }),
      ),
    );
  };
}
