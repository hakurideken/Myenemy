import { lang, LANGS, translations, type Lang } from '../../i18n';
import { applyMotionPreference, canVibrate, prefersReducedMotion } from '../../platform/settings';
import type { App, Mount } from '../App';
import { button } from '../components/common';
import { radioGroup } from '../components/radioGroup';
import { h } from '../dom';

const t = translations(
  {
    title: 'Nastavení',
    language: 'Jazyk / Language',
    sound: 'Zvuky',
    soundHint: 'Signály a efekty během her',
    vibration: 'Vibrace',
    vibrationHint: 'Krátké zavibrování při signálu',
    vibrationNone: 'Toto zařízení vibrace nepodporuje',
    motion: 'Omezit animace',
    motionSystem: 'Zapnuto v systému („Omezit pohyb“)',
    motionHint: 'Bez létajících karet, otáčení a pulzování',
    back: 'Zpět do menu',
  },
  {
    title: 'Settings',
    language: 'Language / Jazyk',
    sound: 'Sounds',
    soundHint: 'Signals and effects during games',
    vibration: 'Vibration',
    vibrationHint: 'A short buzz on signals',
    vibrationNone: 'This device does not support vibration',
    motion: 'Reduce motion',
    motionSystem: 'Turned on in your system (“Reduce motion”)',
    motionHint: 'No flying cards, flipping or pulsing',
    back: 'Back to menu',
  },
);

/** Názvy jazyků vždy v daném jazyce, ať je pozná i ten, kdo druhému nerozumí. */
const LANG_NAMES: Record<Lang, string> = { cs: 'Čeština', en: 'English' };

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
    const { sound, vibration, reducedMotion } = app.settings.current;
    const vibrationSupported = canVibrate();
    const systemMotion = prefersReducedMotion();
    root.append(
      h(
        'main',
        { class: 'screen screen--narrow' },
        h('h1', { class: 'screen-title', tabindex: '-1' }, t.title),
        h(
          'div',
          { class: 'stack' },
          radioGroup<Lang>(
            t.language,
            'language',
            LANGS.map((value) => ({ value, label: LANG_NAMES[value] })),
            lang(),
            (value) => app.switchLanguage(value),
            true,
          ),
          toggle(t.sound, t.soundHint, sound, (on) => {
            app.settings.update({ sound: on });
            if (on) app.sfx.play('click');
          }),
          toggle(
            t.vibration,
            vibrationSupported ? t.vibrationHint : t.vibrationNone,
            vibration && vibrationSupported,
            (on) => {
              app.settings.update({ vibration: on });
              if (on) app.sfx.vibrate(40);
            },
            !vibrationSupported,
          ),
          toggle(
            t.motion,
            systemMotion ? t.motionSystem : t.motionHint,
            reducedMotion || systemMotion,
            (on) => {
              app.settings.update({ reducedMotion: on });
              applyMotionPreference(on);
            },
            systemMotion,
          ),
        ),
        button(t.back, () => app.goMenu(), 'btn btn-primary btn-lg', {
          'data-autofocus': true,
        }),
      ),
    );
  };
}
