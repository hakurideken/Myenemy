import { NICKNAME_MAX, NICKNAME_MIN, validateNickname } from '../../core/nickname';
import type { App, Mount } from '../App';
import { button, logo } from '../components/common';
import { h, setText } from '../dom';

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
        h('h1', { class: 'screen-title', tabindex: '-1' }, 'Kdo jsi, bojovníku?'),
        h(
          'p',
          { class: 'lead' },
          'Přezdívka se uloží jen v tomhle prohlížeči. Žádný účet ani registrace.',
        ),
        h(
          'form',
          { class: 'card form', novalidate: true, onsubmit: submit },
          h('label', { for: 'nickname', class: 'field-label' }, 'Přezdívka'),
          input,
          h(
            'p',
            { id: 'nickname-hint', class: 'field-hint' },
            `${NICKNAME_MIN}–${NICKNAME_MAX} znaků, diakritika je v pořádku.`,
          ),
          error,
          h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, 'Do arény'),
          app.nickname ? button('Zpět do menu', () => app.goMenu(), 'btn btn-ghost') : null,
        ),
      ),
    );
  };
}
