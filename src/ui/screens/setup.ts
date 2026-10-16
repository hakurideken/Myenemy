import {
  CUSTOM_BEST_OF,
  isFormatAvailable,
  MatchFormatError,
  type BestOf,
  type FormatKind,
  type MatchFormat,
} from '../../core/match/planMatch';
import { validateNickname } from '../../core/nickname';
import { DIFFICULTIES, type Difficulty, type GameId } from '../../core/types';
import { GAME_INFOS } from '../../games/registry';
import { loadLocalOpponent, saveLocalOpponent } from '../../platform/profile';
import type { App, Mount } from '../App';
import { button } from '../components/common';
import { radioGroup } from '../components/radioGroup';
import { h, setText } from '../dom';
import {
  DIFFICULTY_HINT,
  DIFFICULTY_LABEL,
  FORMAT_INFO,
  LENGTH_LABEL,
  MODE_LABEL,
  plural,
  TYPE_LABEL,
} from '../labels';
import type { LocalMode } from '../MatchFlow';

const FORMAT_KINDS: readonly FormatKind[] = ['rychlovka', 'velky-souboj', 'vlastni'];

export function setupScreen(app: App, mode: LocalMode): Mount {
  return (root) => {
    const nickname = app.nickname ?? 'Hráč 1';
    let difficulty: Difficulty = 'medium';
    let kind: FormatKind = FORMAT_KINDS.find((k) => isFormatAvailable(k, GAME_INFOS)) ?? 'vlastni';
    let bestOf: BestOf = 5;
    let pickRandom = true;
    const picks: GameId[] = [];

    const error = h('p', { class: 'field-error', 'aria-live': 'polite' });

    // --- soupeř ---
    const opponentInput = h('input', {
      id: 'opponent',
      type: 'text',
      maxlength: 40,
      spellcheck: 'false',
      autocomplete: 'off',
      value: loadLocalOpponent() ?? 'Hráč 2',
    });
    const opponentSection =
      mode === 'pve'
        ? radioGroup(
            'Obtížnost AI',
            'difficulty',
            DIFFICULTIES.map((d) => ({
              value: d,
              label: DIFFICULTY_LABEL[d],
              hint: DIFFICULTY_HINT[d],
            })),
            difficulty,
            (value) => {
              difficulty = value;
            },
          )
        : h(
            'div',
            { class: 'form' },
            h('label', { for: 'opponent', class: 'field-label' }, 'Jméno druhého hráče'),
            opponentInput,
            h('p', { class: 'field-hint' }, `Ty hraješ jako ${nickname} (hráč A).`),
          );

    // --- vlastní výběr ---
    const pickCounter = h('p', { class: 'pick-counter', 'aria-live': 'polite' });
    const pickButtons = GAME_INFOS.map((game) =>
      h(
        'button',
        {
          type: 'button',
          class: 'pick',
          'aria-pressed': 'false',
          'data-game': game.id,
          onclick: () => togglePick(game.id),
        },
        h('span', { class: 'pick-order', 'aria-hidden': 'true' }),
        h('span', { class: 'pick-name' }, game.name),
        h(
          'span',
          { class: 'pick-meta' },
          `${TYPE_LABEL[game.type]} · ${LENGTH_LABEL[game.length]}`,
        ),
      ),
    );
    const pickList = h(
      'div',
      { class: 'pick-section' },
      h('p', { class: 'field-hint' }, 'Klikej v pořadí, v jakém se mají hrát.'),
      h('div', { class: 'pick-list', role: 'group', 'aria-label': 'Výběr her' }, pickButtons),
      pickCounter,
    );

    function refreshPicks(): void {
      if (picks.length > bestOf) picks.length = bestOf;
      for (const btn of pickButtons) {
        const index = picks.indexOf(btn.dataset.game ?? '');
        btn.setAttribute('aria-pressed', String(index >= 0));
        btn.disabled = index < 0 && picks.length >= bestOf;
        setText(btn.querySelector('.pick-order') ?? btn, index >= 0 ? String(index + 1) : '');
      }
      const rest = bestOf - picks.length;
      setText(
        pickCounter,
        `Vybráno ${picks.length} z ${bestOf}.` +
          (rest > 0
            ? ` ${rest} ${plural(rest, 'hra se doplní', 'hry se doplní', 'her se doplní')} náhodně bez opakování.`
            : ''),
      );
      pickList.hidden = pickRandom;
    }

    function togglePick(id: GameId): void {
      const index = picks.indexOf(id);
      if (index >= 0) picks.splice(index, 1);
      else if (picks.length < bestOf) picks.push(id);
      refreshPicks();
    }

    const customSection = h(
      'div',
      { class: 'custom' },
      radioGroup(
        'Počet her (best of)',
        'best-of',
        CUSTOM_BEST_OF.map((n) => ({
          value: String(n),
          label: String(n),
          hint: `${(n + 1) / 2} ${plural((n + 1) / 2, 'výhra', 'výhry', 'výher')}`,
        })),
        String(bestOf),
        (value) => {
          bestOf = Number(value) as BestOf;
          refreshPicks();
        },
        true,
      ),
      radioGroup(
        'Které hry',
        'pick-mode',
        [
          { value: 'random', label: 'Náhodně ze všech', hint: 'Losuje se bez opakování' },
          { value: 'pick', label: 'Vybrat hry', hint: 'Konkrétní hry v tvém pořadí' },
        ],
        'random',
        (value) => {
          pickRandom = value === 'random';
          refreshPicks();
        },
      ),
      pickList,
    );

    const formatSection = radioGroup(
      'Formát zápasu',
      'format',
      FORMAT_KINDS.map((k) => {
        const available = isFormatAvailable(k, GAME_INFOS);
        return {
          value: k,
          label: FORMAT_INFO[k].name,
          hint: available
            ? FORMAT_INFO[k].description
            : 'Zatím nejsou k dispozici žádné delší hry.',
          disabled: !available,
        };
      }),
      kind,
      (value) => {
        kind = value;
        customSection.hidden = kind !== 'vlastni';
      },
    );
    customSection.hidden = kind !== 'vlastni';
    refreshPicks();

    function submit(event: SubmitEvent): void {
      event.preventDefault();
      setText(error, '');
      let opponentName = `AI · ${DIFFICULTY_LABEL[difficulty]}`;
      if (mode === 'local') {
        const result = validateNickname(opponentInput.value);
        if (!result.ok) {
          setText(error, `Druhý hráč: ${result.error}`);
          opponentInput.focus();
          return;
        }
        if (result.value.toLocaleLowerCase('cs') === nickname.toLocaleLowerCase('cs')) {
          setText(error, 'Hráči musí mít různá jména.');
          opponentInput.focus();
          return;
        }
        opponentName = result.value;
        saveLocalOpponent(result.value);
      }
      const format: MatchFormat =
        kind === 'vlastni'
          ? { kind, bestOf, picks: pickRandom || picks.length === 0 ? 'random' : [...picks] }
          : { kind };
      try {
        app.startMatch({ mode, format, names: { A: nickname, B: opponentName }, difficulty });
      } catch (err) {
        if (!(err instanceof MatchFormatError)) throw err;
        setText(error, err.message);
      }
    }

    root.append(
      h(
        'main',
        { class: 'screen' },
        h('p', { class: 'kicker' }, MODE_LABEL[mode]),
        h('h1', { class: 'screen-title', tabindex: '-1' }, 'Příprava souboje'),
        h(
          'form',
          { class: 'setup', novalidate: true, onsubmit: submit },
          opponentSection,
          formatSection,
          customSection,
          error,
          h(
            'div',
            { class: 'actions' },
            button('Zpět', () => app.goMenu(), 'btn btn-ghost'),
            h(
              'button',
              { type: 'submit', class: 'btn btn-primary btn-lg', 'data-autofocus': true },
              'Pokračovat',
            ),
          ),
        ),
      ),
    );
  };
}
