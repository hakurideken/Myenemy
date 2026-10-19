import {
  CUSTOM_BEST_OF,
  isFormatAvailable,
  MatchFormatError,
  planMatch,
  type BestOf,
  type FormatKind,
  type MatchFormat,
} from '../../core/match/planMatch';
import { validateNickname } from '../../core/nickname';
import { DIFFICULTIES, type Difficulty, type GameId } from '../../core/types';
import { createRng } from '../../core/util/rng';
import { GAME_INFOS } from '../../games/registry';
import { translations } from '../../i18n';
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

const t = translations(
  {
    player1: 'Hráč 1',
    player2: 'Hráč 2',
    hostNote: (name: string) =>
      `Hraješ jako ${name} (hostitel). Soupeře pozveš kódem místnosti nebo odkazem.`,
    difficulty: 'Obtížnost AI',
    opponentName: 'Jméno druhého hráče',
    youAre: (name: string) => `Ty hraješ jako ${name} (hráč A).`,
    pickOrder: 'Klikej v pořadí, v jakém se mají hrát.',
    pickGroup: 'Výběr her',
    picked: (count: number, of: number) => `Vybráno ${count} z ${of}.`,
    rest: (n: number) =>
      ` ${n} ${plural(n, 'hra se doplní', 'hry se doplní', 'her se doplní')} náhodně bez opakování.`,
    bestOf: 'Počet her (best of)',
    wins: (n: number) => `${n} ${plural(n, 'výhra', 'výhry', 'výher')}`,
    which: 'Které hry',
    random: 'Náhodně ze všech',
    randomHint: 'Losuje se bez opakování',
    pick: 'Vybrat hry',
    pickHint: 'Konkrétní hry v tvém pořadí',
    format: 'Formát zápasu',
    unavailable: 'Zatím nejsou k dispozici žádné delší hry.',
    ai: (label: string) => `AI · ${label}`,
    secondPlayer: (error: string) => `Druhý hráč: ${error}`,
    sameNames: 'Hráči musí mít různá jména.',
    title: 'Příprava souboje',
    back: 'Zpět',
    createRoom: 'Vytvořit místnost',
    next: 'Pokračovat',
  },
  {
    player1: 'Player 1',
    player2: 'Player 2',
    hostNote: (name: string) =>
      `You play as ${name} (host). Invite your opponent with the room code or a link.`,
    difficulty: 'AI difficulty',
    opponentName: 'Second player’s name',
    youAre: (name: string) => `You play as ${name} (player A).`,
    pickOrder: 'Click the games in the order they should be played.',
    pickGroup: 'Game selection',
    picked: (count: number, of: number) => `Selected ${count} of ${of}.`,
    rest: (n: number) =>
      ` ${n} more ${n === 1 ? 'game' : 'games'} will be drawn at random without repeats.`,
    bestOf: 'Number of games (best of)',
    wins: (n: number) => `${n} ${n === 1 ? 'win' : 'wins'}`,
    which: 'Which games',
    random: 'Random from all',
    randomHint: 'Drawn without repeats',
    pick: 'Choose games',
    pickHint: 'Specific games in your order',
    format: 'Match format',
    unavailable: 'No longer games are available yet.',
    ai: (label: string) => `AI · ${label}`,
    secondPlayer: (error: string) => `Second player: ${error}`,
    sameNames: 'The players must have different names.',
    title: 'Get ready',
    back: 'Back',
    createRoom: 'Create room',
    next: 'Continue',
  },
);

export type SetupMode = LocalMode | 'online';

export function setupScreen(app: App, mode: SetupMode): Mount {
  return (root) => {
    const nickname = app.nickname ?? t.player1;
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
      value: loadLocalOpponent() ?? t.player2,
    });
    const opponentSection =
      mode === 'online'
        ? h('p', { class: 'note' }, t.hostNote(nickname))
        : mode === 'pve'
          ? radioGroup(
              t.difficulty,
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
              h('label', { for: 'opponent', class: 'field-label' }, t.opponentName),
              opponentInput,
              h('p', { class: 'field-hint' }, t.youAre(nickname)),
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
      h('p', { class: 'field-hint' }, t.pickOrder),
      h('div', { class: 'pick-list', role: 'group', 'aria-label': t.pickGroup }, pickButtons),
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
      setText(pickCounter, t.picked(picks.length, bestOf) + (rest > 0 ? t.rest(rest) : ''));
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
        t.bestOf,
        'best-of',
        CUSTOM_BEST_OF.map((n) => ({
          value: String(n),
          label: String(n),
          hint: t.wins((n + 1) / 2),
        })),
        String(bestOf),
        (value) => {
          bestOf = Number(value) as BestOf;
          refreshPicks();
        },
        true,
      ),
      radioGroup(
        t.which,
        'pick-mode',
        [
          { value: 'random', label: t.random, hint: t.randomHint },
          { value: 'pick', label: t.pick, hint: t.pickHint },
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
      t.format,
      'format',
      FORMAT_KINDS.map((k) => {
        const available = isFormatAvailable(k, GAME_INFOS);
        return {
          value: k,
          label: FORMAT_INFO[k].name,
          hint: available ? FORMAT_INFO[k].description : t.unavailable,
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
      let opponentName = t.ai(DIFFICULTY_LABEL[difficulty]);
      if (mode === 'local') {
        const result = validateNickname(opponentInput.value);
        if (!result.ok) {
          setText(error, t.secondPlayer(result.error));
          opponentInput.focus();
          return;
        }
        if (result.value.toLocaleLowerCase('cs') === nickname.toLocaleLowerCase('cs')) {
          setText(error, t.sameNames);
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
        if (mode === 'online') {
          // Ověří formát předem – skutečné pořadí her se vylosuje až ze společného seedu.
          planMatch(format, GAME_INFOS, createRng('kontrola-formatu'));
          app.createOnlineRoom(format);
        } else {
          app.startMatch({ mode, format, names: { A: nickname, B: opponentName }, difficulty });
        }
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
        h('h1', { class: 'screen-title', tabindex: '-1' }, t.title),
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
            button(
              t.back,
              () => (mode === 'online' ? app.goOnline() : app.goMenu()),
              'btn btn-ghost',
            ),
            h(
              'button',
              { type: 'submit', class: 'btn btn-primary btn-lg', 'data-autofocus': true },
              mode === 'online' ? t.createRoom : t.next,
            ),
          ),
        ),
      ),
    );
  };
}
