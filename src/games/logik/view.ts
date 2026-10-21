import type { GameView, RenderFrame, ViewContext } from '../../core/MiniGame';
import { otherPlayer, type PerPlayer, type PlayerSlot } from '../../core/types';
import { createRng, randomSeed } from '../../core/util/rng';
import { translations } from '../../i18n';
import { h, setText, svg } from '../../ui/dom';
import { outcomeMessage } from '../shared/board';
import {
  COLORS,
  countMarks,
  cracked,
  MAX_ROUNDS,
  PEGS,
  randomCode,
  type Code,
  type Feedback,
  type Guess,
  type LogikMove,
  type LogikView,
} from './logic';

const t = translations(
  {
    colorNames: ['červená', 'modrá', 'zelená', 'žlutá', 'fialová', 'oranžová'],
    feedback: (black: number, white: number) => `${black} přesně, ${white} jen barvou`,
    markNames: { exact: 'barva i místo', color: 'jen barva', none: 'nic' },
    feedbackPositions: (parts: string[]) => parts.map((p, i) => `${i + 1}. ${p}`).join(', '),
    awaitingAnswer: 'čeká na odpověď',
    attemptRow: (n: number, code: string, result: string) => `Pokus ${n}: ${code} – ${result}`,
    addColor: (name: string, key: number) => `Přidat barvu ${name} (klávesa ${key})`,
    random: 'Náhodně',
    done: 'Hotovo',
    draftCode: 'Sestavovaný kód',
    colors: 'Barvy',
    legendExact: 'barva i místo',
    legendColor: 'jen barva',
    slotEmpty: (n: number) => `Pozice ${n}: prázdná`,
    slotFilled: (n: number, name: string) => `Pozice ${n}: ${name} (klepnutím smažeš)`,
    setCode: 'Zvolit kód',
    guess: 'Tipnout',
    secretTitle: 'Tvůj tajný kód pro soupeře',
    attemptOf: (round: number, max: number) => `Pokus ${round} z ${max}`,
    noAttempts: 'Zatím žádný pokus.',
    crackedOn: (name: string, attempt: number) => `${name} prolomil(a) kód na ${attempt}. pokus`,
    nobodyCracked: 'Kód nikdo neprolomil. ',
    chooseSecret: 'Zvol tajný kód, který bude soupeř hádat.',
    sendingHash: 'Odesílám otisk kódu…',
    waitingForCode: (name: string) => `Kód je zvolený. Čekám, až si ${name} zvolí svůj…`,
    lastGuess: (feedback: string) => `minulý tip – ${feedback}. Sestav další.`,
    firstGuess: 'sestav svůj první tip.',
    thinking: (name: string) => `${name} přemýšlí…`,
    waitingForGuess: (name: string) => `Čekám na tip: ${name}…`,
    guessesCode: (guesser: string, owner: string) => `${guesser} hádá kód: ${owner}`,
    yourAttempts: 'Tvoje pokusy',
    attemptsOf: (name: string) => `Pokusy: ${name}`,
    secretCodeLabel: 'Tajný kód: ',
    yourCodeLabel: 'Tvůj kód: ',
    yourCode: (code: string) => `Tvůj kód: ${code}`,
    noCodeYet: 'Kód zatím není zvolený',
  },
  {
    colorNames: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'],
    feedback: (black: number, white: number) => `${black} exact, ${white} color only`,
    markNames: { exact: 'color and place', color: 'color only', none: 'nothing' },
    feedbackPositions: (parts: string[]) => parts.map((p, i) => `${i + 1}: ${p}`).join(', '),
    awaitingAnswer: 'awaiting answer',
    attemptRow: (n: number, code: string, result: string) => `Attempt ${n}: ${code} – ${result}`,
    addColor: (name: string, key: number) => `Add ${name} (key ${key})`,
    random: 'Random',
    done: 'Done',
    draftCode: 'Code being built',
    colors: 'Colors',
    legendExact: 'color and place',
    legendColor: 'color only',
    slotEmpty: (n: number) => `Position ${n}: empty`,
    slotFilled: (n: number, name: string) => `Position ${n}: ${name} (tap to clear)`,
    setCode: 'Set code',
    guess: 'Guess',
    secretTitle: 'Your secret code for the opponent',
    attemptOf: (round: number, max: number) => `Attempt ${round} of ${max}`,
    noAttempts: 'No attempts yet.',
    crackedOn: (name: string, attempt: number) => `${name} cracked the code on attempt ${attempt}`,
    nobodyCracked: 'Nobody cracked the code. ',
    chooseSecret: 'Choose a secret code for the opponent to guess.',
    sendingHash: 'Sending the code hash…',
    waitingForCode: (name: string) => `Code set. Waiting for ${name} to set theirs…`,
    lastGuess: (feedback: string) => `last guess – ${feedback}. Build the next one.`,
    firstGuess: 'build your first guess.',
    thinking: (name: string) => `${name} is thinking…`,
    waitingForGuess: (name: string) => `Waiting for a guess from ${name}…`,
    guessesCode: (guesser: string, owner: string) => `${guesser} guesses the code of ${owner}`,
    yourAttempts: 'Your attempts',
    attemptsOf: (name: string) => `Attempts: ${name}`,
    secretCodeLabel: 'Secret code: ',
    yourCodeLabel: 'Your code: ',
    yourCode: (code: string) => `Your code: ${code}`,
    noCodeYet: 'No code set yet',
  },
);

/** Barvy mají i vlastní symbol – rozliší je i barvoslepý hráč. */
export const COLOR_NAMES: readonly string[] = t.colorNames;

const SYMBOLS: readonly string[] = [
  // kruh, čtverec, trojúhelník, kosočtverec, hvězda, kříž
  'M20 13a7 7 0 1 1 0 14a7 7 0 1 1 0-14z',
  'M13.5 13.5h13v13h-13z',
  'M20 12.5l8 14h-16z',
  'M20 11.5l8.5 8.5l-8.5 8.5l-8.5-8.5z',
  'M20 11.5l2.4 5.4l5.8.6l-4.4 3.9l1.3 5.7L20 24.2l-5.1 2.9l1.3-5.7l-4.4-3.9l5.8-.6z',
  'M17 12h6v5h5v6h-5v5h-6v-5h-5v-6h5z',
];

export function pegIcon(color: number | null): SVGSVGElement {
  const attrs = {
    viewBox: '0 0 40 40',
    class: `lk-peg-icon${color === null ? ' is-empty' : ` lk-c${color}`}`,
    'aria-hidden': 'true',
    focusable: 'false',
  };
  if (color === null) return svg('svg', attrs, svg('circle', { cx: '20', cy: '20', r: '8' }));
  return svg(
    'svg',
    attrs,
    svg('circle', { class: 'lk-peg-body', cx: '20', cy: '20', r: '17' }),
    svg('path', { class: 'lk-peg-symbol', d: SYMBOLS[color] ?? '' }),
  );
}

const codeText = (code: Code): string => code.map((c) => COLOR_NAMES[c] ?? '?').join(', ');

export const feedbackText = (f: Feedback): string =>
  t.feedback(countMarks(f, 'exact'), countMarks(f, 'color'));

const positionsText = (f: Feedback): string => t.feedbackPositions(f.map((m) => t.markNames[m]));

const FB_CLASS = { exact: 'black', color: 'white', none: 'none' } as const;

// Tečka i patří k pozici i tipu.
function feedbackPegs(f: Feedback | null): HTMLElement {
  const pegs = Array.from({ length: PEGS }, (_, i) => {
    const mark = f?.[i];
    return h('span', { class: `lk-fb lk-fb--${mark ? FB_CLASS[mark] : 'wait'}` });
  });
  return h(
    'span',
    { class: 'lk-feedback', role: 'img', 'aria-label': f ? positionsText(f) : t.awaitingAnswer },
    pegs,
  );
}

function guessRow(index: number, guess: Guess): HTMLElement {
  return h(
    'li',
    {
      class: `lk-row${cracked(guess) ? ' is-cracked' : ''}`,
      'aria-label': t.attemptRow(
        index + 1,
        codeText(guess.code),
        guess.feedback ? positionsText(guess.feedback) : t.awaitingAnswer,
      ),
    },
    h('span', { class: 'lk-row-no', 'aria-hidden': 'true' }, index + 1),
    h(
      'span',
      { class: 'lk-row-code', 'aria-hidden': 'true' },
      guess.code.map((c) => pegIcon(c)),
    ),
    feedbackPegs(guess.feedback),
  );
}

type Draft = (number | null)[];
const emptyDraft = (): Draft => new Array<number | null>(PEGS).fill(null);

export function createLogikView(ctx: ViewContext<LogikMove>): GameView<LogikView> {
  let frame: RenderFrame | null = null;
  let latest: LogikView | null = null;
  const drafts: PerPlayer<Draft> = { A: emptyDraft(), B: emptyDraft() };
  const rendered = { mine: '', theirs: '' };
  const rng = createRng(randomSeed());

  const status = h('p', { class: 'board-status', 'aria-live': 'polite' });

  // Editor kódu (tajný kód i pokusy).
  const slots = Array.from({ length: PEGS }, (_, i) =>
    h('button', { type: 'button', class: 'lk-slot', onclick: () => clearSlot(i) }),
  );
  const palette = Array.from({ length: COLORS }, (_, color) =>
    h(
      'button',
      {
        type: 'button',
        class: 'lk-color',
        'aria-label': t.addColor(COLOR_NAMES[color] ?? '', color + 1),
        onclick: () => addColor(color),
      },
      pegIcon(color),
      h('kbd', { 'aria-hidden': 'true' }, String(color + 1)),
    ),
  );
  const randomButton = h(
    'button',
    { type: 'button', class: 'btn btn-ghost', onclick: () => randomize() },
    t.random,
  );
  const submitButton = h(
    'button',
    { type: 'button', class: 'btn btn-primary', onclick: () => submitDraft() },
    t.done,
  );
  const editorTitle = h('h3', { class: 'lk-editor-title' });
  const editor = h(
    'div',
    { class: 'lk-editor' },
    editorTitle,
    h('div', { class: 'lk-slots', role: 'group', 'aria-label': t.draftCode }, slots),
    h('div', { class: 'lk-palette', role: 'group', 'aria-label': t.colors }, palette),
    h('div', { class: 'lk-editor-actions' }, randomButton, submitButton),
  );

  const myTitle = h('h3', { class: 'lk-board-title' });
  const myRows = h('ol', { class: 'lk-rows' });
  const myBoard = h('section', { class: 'lk-board' }, myTitle, myRows);
  const theirTitle = h('h3', { class: 'lk-board-title' });
  const secretCode = h('p', { class: 'lk-secret' });
  const theirRows = h('ol', { class: 'lk-rows' });
  const theirBoard = h(
    'section',
    { class: 'lk-board lk-board--theirs' },
    theirTitle,
    secretCode,
    theirRows,
  );
  const boards = h('div', { class: 'lk-boards' }, myBoard, theirBoard);
  const legend = h(
    'p',
    { class: 'lk-legend' },
    h('span', null, h('span', { class: 'lk-fb lk-fb--black' }), t.legendExact),
    h('span', null, h('span', { class: 'lk-fb lk-fb--white' }), t.legendColor),
  );
  const container = h('div', { class: 'board-game lk' }, status, editor, boards, legend);
  ctx.root.append(container);

  const me = (): PlayerSlot => frame?.perspective ?? 'A';
  const mySecret = (): Code | null => (frame?.secret as Code | null | undefined) ?? null;
  const canAct = (): boolean =>
    frame !== null && frame.finished === null && frame.canAct.includes(frame.perspective);
  /** Režim editoru: tajný kód (před začátkem), pokus, nebo nic. */
  const editing = (): 'secret' | 'guess' | null => {
    if (!latest || !canAct()) return null;
    if (!latest.ready[me()]) return mySecret() === null ? 'secret' : null;
    const mine = latest.guesses[me()].length;
    const theirs = latest.guesses[otherPlayer(me())].length;
    const answered = latest.guesses[me()].every((g) => g.feedback !== null);
    return mine <= theirs && answered && mine < MAX_ROUNDS ? 'guess' : null;
  };

  function draft(): Draft {
    return drafts[me()];
  }

  function addColor(color: number): void {
    if (!editing()) return;
    const d = draft();
    const free = d.indexOf(null);
    if (free < 0) return;
    ctx.sfx.play('click');
    d[free] = color;
    renderEditor();
  }

  function clearSlot(index: number): void {
    if (!editing()) return;
    draft()[index] = null;
    renderEditor();
  }

  function backspace(): void {
    if (!editing()) return;
    const d = draft();
    for (let i = PEGS - 1; i >= 0; i--) {
      if (d[i] !== null) {
        d[i] = null;
        break;
      }
    }
    renderEditor();
  }

  function randomize(): void {
    if (!editing()) return;
    drafts[me()] = [...randomCode(rng)];
    renderEditor();
  }

  function submitDraft(): void {
    const mode = editing();
    if (!mode || !frame) return;
    const d = draft();
    if (d.some((c) => c === null)) return;
    const code = d.map((c) => c ?? 0);
    ctx.sfx.play('click');
    drafts[me()] = emptyDraft();
    if (mode === 'secret') ctx.submitSecret(frame.perspective, code);
    else ctx.submit(frame.perspective, { kind: 'guess', code });
  }

  function renderEditor(): void {
    const mode = editing();
    editor.hidden = mode === null;
    if (!mode) return;
    const d = draft();
    slots.forEach((slot, i) => {
      const color = d[i] ?? null;
      const key = color === null ? '' : String(color);
      if (slot.dataset.color !== key) {
        slot.dataset.color = key;
        slot.replaceChildren(pegIcon(color));
      }
      slot.setAttribute(
        'aria-label',
        color === null ? t.slotEmpty(i + 1) : t.slotFilled(i + 1, COLOR_NAMES[color] ?? ''),
      );
    });
    const complete = d.every((c) => c !== null);
    submitButton.disabled = !complete;
    setText(submitButton, mode === 'secret' ? t.setCode : t.guess);
    randomButton.hidden = mode !== 'secret';
    const round = latest ? latest.guesses[me()].length + 1 : 1;
    setText(editorTitle, mode === 'secret' ? t.secretTitle : t.attemptOf(round, MAX_ROUNDS));
  }

  function renderRows(list: HTMLElement, guesses: readonly Guess[], key: 'mine' | 'theirs'): void {
    const signature = JSON.stringify(guesses);
    if (rendered[key] === signature) return;
    rendered[key] = signature;
    list.replaceChildren(...guesses.map((g, i) => guessRow(i, g)));
    if (guesses.length === 0) {
      list.append(h('li', { class: 'lk-empty' }, t.noAttempts));
    }
  }

  function statusText(view: LogikView, f: RenderFrame): string {
    const mine = me();
    const opp = otherPlayer(mine);
    const local = ctx.localPlayers.length > 1;
    if (f.finished) {
      const parts = (['A', 'B'] as const)
        .filter((p) => cracked(view.guesses[p].at(-1)))
        .map((p) => t.crackedOn(ctx.names[p], view.guesses[p].length));
      const detail = parts.length > 0 ? `${parts.join(', ')}. ` : t.nobodyCracked;
      return `${detail}${outcomeMessage(ctx, f.finished)}`;
    }
    const mode = editing();
    if (mode === 'secret') return t.chooseSecret;
    if (!view.ready[mine]) return t.sendingHash;
    if (!view.ready[opp]) return t.waitingForCode(ctx.names[opp]);
    if (mode === 'guess') {
      const last = view.guesses[mine].at(-1);
      const text = last?.feedback ? t.lastGuess(feedbackText(last.feedback)) : t.firstGuess;
      return local
        ? `${ctx.names[mine]}: ${text}`
        : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
    }
    return ctx.mode === 'pve' ? t.thinking(ctx.names[opp]) : t.waitingForGuess(ctx.names[opp]);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!editing()) return;
    const digit = /^(?:Digit|Numpad)([1-6])$/.exec(event.code);
    if (digit?.[1]) {
      event.preventDefault();
      addColor(Number(digit[1]) - 1);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      backspace();
    } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      submitDraft();
    }
  }
  window.addEventListener('keydown', onKey);

  return {
    render(view, f) {
      const before = latest ? latest.guesses[me()].filter((g) => g.feedback).length : 0;
      latest = view;
      frame = f;
      const mine = me();
      const opp = otherPlayer(mine);
      renderEditor();
      const started = view.ready.A && view.ready.B;
      boards.hidden = !started && editing() === 'secret';
      renderRows(myRows, view.guesses[mine], 'mine');
      renderRows(theirRows, view.guesses[opp], 'theirs');
      const local = ctx.localPlayers.length > 1;
      setText(myTitle, local ? t.guessesCode(ctx.names[mine], ctx.names[opp]) : t.yourAttempts);
      setText(
        theirTitle,
        local ? t.guessesCode(ctx.names[opp], ctx.names[mine]) : t.attemptsOf(ctx.names[opp]),
      );
      const secret = mySecret();
      secretCode.replaceChildren(
        h('span', null, local ? t.secretCodeLabel : t.yourCodeLabel),
        ...(secret ? secret.map((c) => pegIcon(c)) : [h('span', null, '—')]),
      );
      secretCode.setAttribute('aria-label', secret ? t.yourCode(codeText(secret)) : t.noCodeYet);
      setText(status, statusText(view, f));
      const after = view.guesses[mine].filter((g) => g.feedback).length;
      if (after > before && !f.finished) ctx.sfx.play('tick');
    },
    destroy() {
      window.removeEventListener('keydown', onKey);
      container.remove();
    },
  };
}
