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
    showOnline: 'Ukazovat kamarádům, že jsem online',
    saveFailedTitle: 'Nepodařilo se uložit',
    saveFailed: 'Spojení se nepovedlo – nastavení zůstává, jak bylo. Zkus to znovu.',
    ok: 'Rozumím',
    showOnlineHint: 'Kamarádi uvidí „online“ nebo „ve hře“. Vypnuté = pro ně vždy offline.',
    music: 'Hudba',
    musicHint: 'V menu i ve hře, na konci zápasu výherní nebo prohraná skladba',
    volume: 'Hlasitost hudby',
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
    showOnline: 'Show friends that I am online',
    saveFailedTitle: 'Could not save',
    saveFailed: 'Connection failed – the setting stays as it was. Please try again.',
    ok: 'OK',
    showOnlineHint: 'Friends see “online” or “in a game”. Off = always offline for them.',
    music: 'Music',
    musicHint: 'In the menu and in games, a victory or defeat tune at the end of a match',
    volume: 'Music volume',
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
  onChange: (checked: boolean, input: HTMLInputElement) => void,
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
      onchange: (event: Event) => {
        const input = event.currentTarget as HTMLInputElement;
        onChange(input.checked, input);
      },
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
    const { sound, vibration, reducedMotion, music, musicVolume } = app.settings.current;
    const volume = h('input', {
      id: 'music-volume',
      type: 'range',
      min: 0,
      max: 100,
      step: 5,
      value: Math.round(musicVolume * 100),
      disabled: !music,
      oninput: () => {
        app.settings.update({ musicVolume: Number(volume.value) / 100 });
        app.music.refresh();
      },
    });
    const volumeValue = (): string => `${volume.value} %`;
    const volumeOutput = h('output', { for: 'music-volume', class: 'range-value' }, volumeValue());
    volume.addEventListener('input', () => {
      volumeOutput.textContent = volumeValue();
    });
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
          // Jen pro přihlášené s profilem (kamarádi jsou jen u účtů).
          app.account.state.kind === 'signed-in' && app.account.state.profile
            ? toggle(t.showOnline, t.showOnlineHint, app.account.state.showOnline, (on, input) => {
                // Nastavení soukromí: při chybě vrátit, ať hráč nežije v omylu, že je skrytý.
                input.disabled = true;
                app.account
                  .setShowOnline(on)
                  .catch(() => {
                    input.checked = !on;
                    const dialog = app.dialog({
                      title: t.saveFailedTitle,
                      body: [h('p', { class: 'dialog-text' }, t.saveFailed)],
                      actions: [button(t.ok, () => dialog.close(), 'btn btn-primary')],
                    });
                  })
                  .finally(() => {
                    input.disabled = false;
                  });
              })
            : null,
          toggle(t.music, t.musicHint, music, (on) => {
            app.settings.update({ music: on });
            volume.disabled = !on;
            app.music.refresh();
          }),
          h(
            'div',
            { class: 'range-field' },
            h('label', { for: 'music-volume', class: 'field-label' }, t.volume),
            h('div', { class: 'range-row' }, volume, volumeOutput),
          ),
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
