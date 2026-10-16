import { canVibrate, prefersReducedMotion } from '../../platform/settings';
import type { App, Mount } from '../App';
import { button } from '../components/common';
import { h } from '../dom';

function toggle(
  label: string,
  hint: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
  disabled = false,
): HTMLLabelElement {
  return h(
    'label',
    { class: 'toggle' },
    h('input', {
      type: 'checkbox',
      role: 'switch',
      checked,
      disabled,
      onchange: (event: Event) => onChange((event.currentTarget as HTMLInputElement).checked),
    }),
    h('span', { class: 'toggle-track', 'aria-hidden': 'true' }),
    h(
      'span',
      { class: 'toggle-text' },
      h('span', { class: 'toggle-label' }, label),
      h('span', { class: 'toggle-hint' }, hint),
    ),
  );
}

export function settingsScreen(app: App): Mount {
  return (root) => {
    const { sound, vibration } = app.settings.current;
    const vibrationSupported = canVibrate();
    root.append(
      h(
        'main',
        { class: 'screen screen--narrow' },
        h('h1', { class: 'screen-title', tabindex: '-1' }, 'Nastavení'),
        h(
          'div',
          { class: 'stack' },
          toggle('Zvuky', 'Signály a efekty během her', sound, (on) => {
            app.settings.update({ sound: on });
            if (on) app.sfx.play('click');
          }),
          toggle(
            'Vibrace',
            vibrationSupported
              ? 'Krátké zavibrování při signálu'
              : 'Toto zařízení vibrace nepodporuje',
            vibration && vibrationSupported,
            (on) => {
              app.settings.update({ vibration: on });
              if (on) app.sfx.vibrate(40);
            },
            !vibrationSupported,
          ),
          h(
            'p',
            { class: 'note' },
            prefersReducedMotion()
              ? 'Animace jsou omezené podle nastavení systému („Omezit pohyb“).'
              : 'Animace se řídí systémovým nastavením „Omezit pohyb“.',
          ),
        ),
        button('Zpět do menu', () => app.goMenu(), 'btn btn-primary btn-lg', {
          'data-autofocus': true,
        }),
      ),
    );
  };
}
