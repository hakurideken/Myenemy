import type { MatchFormat, MatchPlan } from '../../core/match/planMatch';
import type { PerPlayer } from '../../core/types';
import { normalizeRoomCode } from '../../net/room';
import type { App, Mount } from '../App';
import { button, versus } from '../components/common';
import { slotList } from '../components/slotList';
import { h, setText } from '../dom';
import { formatTitle } from '../labels';
import { bestOfLead, RULES_NOTE } from './matchIntro';

export function onlineMenuScreen(app: App, available: boolean): Mount {
  return (root) => {
    const main = h(
      'main',
      { class: 'screen screen--narrow' },
      h('p', { class: 'kicker' }, 'Online 1v1'),
      h('h1', { class: 'screen-title', tabindex: '-1' }, 'Online souboj'),
    );
    root.append(main);

    if (!available) {
      main.append(
        h(
          'section',
          { class: 'card stack' },
          h('p', { class: 'lead' }, 'Online hra není na tomhle webu nastavená.'),
          h(
            'p',
            { class: 'note' },
            'Chybí připojení k serveru (Supabase). Mezitím si můžeš zahrát proti AI nebo ve dvou na jednom zařízení.',
          ),
          h(
            'div',
            { class: 'actions' },
            button('Proti AI', () => app.goSetup('pve'), 'btn btn-primary', {
              'data-autofocus': true,
            }),
            button('Dva hráči', () => app.goSetup('local'), 'btn'),
          ),
        ),
        button('Zpět do menu', () => app.goMenu(), 'btn btn-ghost'),
      );
      return;
    }

    const input = h('input', {
      id: 'room-code',
      type: 'text',
      maxlength: 7,
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
      class: 'code-input',
      'aria-describedby': 'room-code-hint room-code-error',
      value: app.suggestedRoom() ?? '',
    });
    const error = h('p', { id: 'room-code-error', class: 'field-error', 'aria-live': 'polite' });
    const join = (event: SubmitEvent): void => {
      event.preventDefault();
      const code = normalizeRoomCode(input.value);
      if (!code) {
        setText(error, 'Kód má 5 znaků – písmena a číslice (bez 0, O, 1 a I).');
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      app.joinOnline(code);
    };

    main.append(
      h(
        'section',
        { class: 'card stack' },
        h('h2', { class: 'card-title' }, 'Založit místnost'),
        h('p', { class: 'note' }, 'Vybereš formát a dostaneš kód a odkaz, který pošleš soupeři.'),
        button('Vytvořit místnost', () => app.goSetup('online'), 'btn btn-primary btn-lg', {
          'data-autofocus': true,
        }),
      ),
      h(
        'form',
        { class: 'card form', novalidate: true, onsubmit: join },
        h('h2', { class: 'card-title' }, 'Připojit se'),
        h('label', { for: 'room-code', class: 'field-label' }, 'Kód místnosti'),
        input,
        h(
          'p',
          { id: 'room-code-hint', class: 'field-hint' },
          'Kód ti pošle hostitel, třeba XY7KP.',
        ),
        error,
        h('button', { type: 'submit', class: 'btn btn-lg' }, 'Připojit se'),
      ),
      button('Zpět do menu', () => app.goMenu(), 'btn btn-ghost'),
    );
  };
}

export function connectingScreen(text: string, onCancel: () => void): Mount {
  return (root) => {
    root.append(
      h(
        'main',
        { class: 'screen screen--narrow screen--center' },
        h('div', { class: 'spinner', 'aria-hidden': 'true' }),
        h('h1', { class: 'screen-title', tabindex: '-1' }, 'Připojuji…'),
        h('p', { class: 'lead', role: 'status' }, text),
        button('Zrušit', onCancel, 'btn btn-ghost'),
      ),
    );
  };
}

interface WaitingOptions {
  readonly code: string;
  readonly link: string;
  readonly format: MatchFormat;
  readonly onCancel: () => void;
}

export function waitingScreen(o: WaitingOptions): Mount {
  return (root) => {
    const linkInput = h('input', {
      type: 'text',
      readonly: true,
      value: o.link,
      class: 'link-input',
      'aria-label': 'Odkaz do místnosti',
      onfocus: (event: FocusEvent) => (event.currentTarget as HTMLInputElement).select(),
    });
    const copyStatus = h('span', { class: 'copy-status', 'aria-live': 'polite' });
    const copy = async (): Promise<void> => {
      try {
        await navigator.clipboard.writeText(o.link);
        setText(copyStatus, '✓ Zkopírováno');
      } catch {
        linkInput.focus();
        linkInput.select();
        setText(copyStatus, 'Zkopíruj odkaz ručně (Ctrl+C).');
      }
    };
    root.append(
      h(
        'main',
        { class: 'screen screen--narrow' },
        h('p', { class: 'kicker' }, 'Online · hostitel'),
        h('h1', { class: 'screen-title', tabindex: '-1' }, 'Místnost je připravená'),
        h(
          'section',
          { class: 'card stack room-card' },
          h('p', { class: 'field-label' }, 'Kód místnosti'),
          h(
            'p',
            { class: 'room-code', 'aria-label': `Kód místnosti ${o.code.split('').join(' ')}` },
            o.code,
          ),
          h('p', { class: 'field-label' }, 'Nebo pošli odkaz'),
          h(
            'div',
            { class: 'link-row' },
            linkInput,
            button('Kopírovat', () => void copy(), 'btn', { 'data-autofocus': true }),
          ),
          copyStatus,
        ),
        h(
          'p',
          { class: 'waiting', role: 'status' },
          h('span', { class: 'pulse', 'aria-hidden': 'true' }),
          'Čekám na soupeře…',
        ),
        h('p', { class: 'note' }, `Formát: ${formatTitle(o.format)}`),
        button('Zrušit místnost', o.onCancel, 'btn btn-ghost'),
      ),
    );
  };
}

interface LobbyOptions {
  readonly isHost: boolean;
  readonly names: PerPlayer<string>;
  readonly format: MatchFormat;
  /** null = ještě se losuje společný seed. */
  readonly plan: MatchPlan | null;
  readonly onStart: () => void;
  readonly onLeave: () => void;
}

export function lobbyScreen(o: LobbyOptions): Mount {
  return (root) => {
    let action: HTMLElement;
    if (!o.plan) {
      action = h(
        'p',
        { class: 'waiting', role: 'status' },
        h('span', { class: 'pulse', 'aria-hidden': 'true' }),
        'Losujeme společný seed…',
      );
    } else if (o.isHost) {
      action = button('Do boje!', o.onStart, 'btn btn-primary btn-lg', { 'data-autofocus': true });
    } else {
      action = h(
        'p',
        { class: 'waiting', role: 'status' },
        h('span', { class: 'pulse', 'aria-hidden': 'true' }),
        'Čekám, až hostitel spustí souboj…',
      );
    }
    root.append(
      h(
        'main',
        { class: 'screen' },
        h('p', { class: 'kicker' }, `Online · ${o.isHost ? 'hostitel' : 'host'}`),
        h('h1', { class: 'screen-title', tabindex: '-1' }, formatTitle(o.format)),
        versus(o.names),
        o.plan ? h('p', { class: 'lead' }, bestOfLead(o.plan)) : null,
        o.plan ? slotList(o.plan) : null,
        h('p', { class: 'note' }, RULES_NOTE),
        h(
          'p',
          { class: 'note' },
          'Pořadí her i veškerá náhoda vychází ze seedu, ke kterému přispěli oba hráči – nemůže ho ovlivnit ani hostitel.',
        ),
        h('div', { class: 'actions' }, button('Odejít', o.onLeave, 'btn btn-ghost'), action),
      ),
    );
  };
}

export interface MessageAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly primary?: boolean;
}

export function messageScreen(
  title: string,
  text: string,
  actions: readonly MessageAction[],
): Mount {
  return (root) => {
    root.append(
      h(
        'main',
        { class: 'screen screen--narrow screen--center' },
        h('h1', { class: 'screen-title', tabindex: '-1' }, title),
        h('p', { class: 'lead' }, text),
        h(
          'div',
          { class: 'actions' },
          actions.map((a, i) =>
            button(a.label, a.onClick, a.primary ? 'btn btn-primary btn-lg' : 'btn btn-lg', {
              'data-autofocus': i === 0,
            }),
          ),
        ),
      ),
    );
  };
}
