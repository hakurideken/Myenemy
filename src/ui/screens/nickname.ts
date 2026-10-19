import { NICKNAME_MAX, NICKNAME_MIN, validateNickname } from '../../core/nickname';
import type { App, Mount } from '../App';
import { button, logo } from '../components/common';
import { h, setText } from '../dom';
import { translations } from '../../i18n';

const t = translations(
  {
    title: 'Kdo jsi, bojovníku?',
    lead: 'Přezdívka se uloží jen v tomhle prohlížeči. Žádný účet ani registrace.',
    label: 'Přezdívka',
    hint: (min: number, max: number) => `${min}–${max} znaků, diakritika je v pořádku.`,
    submit: 'Do arény',
    back: 'Zpět do menu',
  },
  {
    title: 'Who are you, warrior?',
    lead: 'Your nickname is saved only in this browser. No account, no sign-up.',
    label: 'Nickname',
    hint: (min: number, max: number) => `${min}–${max} characters, accents are fine.`,
    submit: 'Enter the arena',
    back: 'Back to menu',
  },
);

export function nicknameScreen(app: App): Mount {
  return (root) => {
    const input = h('input', {
      id: 'nickname',
      name: 'nickname',
      type: 'text',
      autocomplete: 'nickname',
      maxlength: 40,
      spellcheck: 'false',
      'aria-describedby': 'nickname-hint nickname-error',
      'data-autofocus': true,
      value: app.nickname ?? '',
    });
    const error = h('p', { id: 'nickname-error', class: 'field-error', 'aria-live': 'polite' });

    const submit = (event: SubmitEvent): void => {
      event.preventDefault();
      const result = validateNickname(input.value);
      if (!result.ok) {
        setText(error, result.error);
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      app.setNickname(result.value);
      app.continueAfterNickname();
    };

    root.append(
      h(
        'main',
        { class: 'screen screen--narrow screen--center' },
        logo(true),
        h('h1', { class: 'screen-title', tabindex: '-1' }, t.title),
        h('p', { class: 'lead' }, t.lead),
        h(
          'form',
          { class: 'card form', novalidate: true, onsubmit: submit },
          h('label', { for: 'nickname', class: 'field-label' }, t.label),
          input,
          h('p', { id: 'nickname-hint', class: 'field-hint' }, t.hint(NICKNAME_MIN, NICKNAME_MAX)),
          error,
          h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, t.submit),
          app.nickname ? button(t.back, () => app.goMenu(), 'btn btn-ghost') : null,
        ),
      ),
    );
  };
}
