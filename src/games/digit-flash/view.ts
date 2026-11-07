import type { GameView, ViewContext } from '../../core/MiniGame';
import { otherPlayer, type Outcome, type PlayerSlot } from '../../core/types';
import type { TimerHandle } from '../../core/util/clock';
import { translations } from '../../i18n';
import { h, setText } from '../../ui/dom';
import { plural } from '../../ui/labels';
import {
  ANSWER_MS,
  COUNTDOWN_MS,
  FEEDBACK_MS,
  MAX_POINTS,
  ROUNDS,
  roundPoints,
  showMs,
  type DigitAnswer,
  type DigitMove,
  type DigitResult,
  type DigitView,
} from './logic';

const t = translations(
  {
    getReady: 'Připrav se…',
    watch: (round: number, length: number) =>
      `Kolo ${round}/${ROUNDS} · zapamatuj si ${length} ${plural(length, 'číslici', 'číslice', 'číslic')}`,
    type: (round: number) => `Kolo ${round}/${ROUNDS} · napiš číslo a potvrď (Enter)`,
    got: (points: number, length: number) => `${points} z ${length} správně.`,
    timeUp: 'Čas vypršel.',
    waiting: 'čeká na start',
    playing: 'hraje…',
    done: 'má hotovo',
    waitingFor: (name: string) => `Hotovo – čekám na ${name}…`,
    you: 'Ty',
    result: (r: DigitResult | undefined) =>
      !r ? '…' : r.kind === 'invalid' ? 'neplatné' : `${r.points}/${MAX_POINTS} b.`,
    draw: 'Remíza',
    winner: (name: string) => `Vítěz: ${name}`,
    keypad: 'Číselná klávesnice',
    erase: 'Smazat číslici',
    confirm: 'Potvrdit',
    answer: 'Tvoje odpověď',
  },
  {
    getReady: 'Get ready…',
    watch: (round: number, length: number) =>
      `Round ${round}/${ROUNDS} · remember ${length} digits`,
    type: (round: number) => `Round ${round}/${ROUNDS} · type the number and confirm (Enter)`,
    got: (points: number, length: number) => `${points} of ${length} correct.`,
    timeUp: 'Time is up.',
    waiting: 'waiting for the start',
    playing: 'playing…',
    done: 'done',
    waitingFor: (name: string) => `Done – waiting for ${name}…`,
    you: 'You',
    result: (r: DigitResult | undefined) =>
      !r ? '…' : r.kind === 'invalid' ? 'invalid' : `${r.points}/${MAX_POINTS} pts`,
    draw: 'Draw',
    winner: (name: string) => `Winner: ${name}`,
    keypad: 'Number pad',
    erase: 'Delete a digit',
    confirm: 'Confirm',
    answer: 'Your answer',
  },
);

type Phase = 'waiting' | 'countdown' | 'show' | 'type' | 'feedback' | 'done';

export function createDigitView(ctx: ViewContext<DigitMove>): GameView<DigitView> {
  const me: PlayerSlot = ctx.localPlayers[0] ?? 'A';
  const opp = otherPlayer(me);
  const timers: TimerHandle[] = [];
  let phase: Phase = 'waiting';
  let latest: DigitView | null = null;
  let canAct: readonly PlayerSlot[] = [];
  let outcome: Outcome | null = null;
  let round = 0;
  let typed = '';
  let typeAt = 0;
  let answerTimer: TimerHandle | null = null;
  const answers: DigitAnswer[] = [];
  let submitted = false;

  const live = h('p', { class: 'sr-only', 'aria-live': 'assertive' });
  const status = h('p', { class: 'sq-status', 'aria-live': 'polite' }, t.getReady);
  const opponentStatus = h('span', { class: 'qd-opponent-status' }, t.waiting);
  const opponentEl = h(
    'div',
    { class: `qd-opponent qd-opponent--${opp.toLowerCase()}` },
    h('span', { class: 'qd-name' }, ctx.names[opp]),
    opponentStatus,
  );
  const display = h('div', { class: 'df-display', 'aria-label': t.answer });
  const key = (label: string, onclick: () => void, cls = '', aria?: string): HTMLButtonElement =>
    h(
      'button',
      {
        type: 'button',
        class: `df-key ${cls}`,
        disabled: true,
        onclick,
        ...(aria ? { 'aria-label': aria } : {}),
      },
      label,
    );
  const keys = [
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, () => typeDigit(d))),
    key('⌫', () => erase(), 'df-key--erase', t.erase),
    key('0', () => typeDigit('0')),
    key('OK', () => confirm(), 'df-key--ok', t.confirm),
  ];
  const keypad = h('div', { class: 'df-keypad', role: 'group', 'aria-label': t.keypad }, ...keys);
  ctx.root.append(opponentEl, status, display, keypad, live);

  const later = (fn: () => void, ms: number): void => {
    timers.push(ctx.clock.setTimeout(fn, ms));
  };

  /** Číslice na displeji; při kontrole obarvené (správně / špatně). */
  function showDigits(text: string, slots: number, check: string | null): void {
    display.replaceChildren(
      ...Array.from({ length: slots }, (_, i) => {
        const ch = text[i] ?? '';
        const cls = check === null ? '' : ch !== '' && ch === check[i] ? ' is-right' : ' is-wrong';
        return h('span', { class: `df-digit${ch ? '' : ' is-empty'}${cls}` }, ch || '·');
      }),
    );
  }

  function setKeys(on: boolean): void {
    for (const k of keys) k.disabled = !on;
  }

  function begin(): void {
    phase = 'countdown';
    for (const s of [0, 1, 2]) {
      later(() => {
        setText(status, `${t.getReady} ${3 - s}`);
        ctx.sfx.play('tick');
      }, s * 1000);
    }
    later(() => startRound(), COUNTDOWN_MS);
  }

  function startRound(): void {
    if (!latest || phase === 'done') return;
    const number = latest.numbers[round] ?? '';
    phase = 'show';
    setKeys(false);
    display.classList.add('is-flash');
    showDigits(number, number.length, null);
    setText(status, t.watch(round + 1, number.length));
    live.textContent = t.watch(round + 1, number.length);
    ctx.sfx.play('signal');
    later(() => {
      phase = 'type';
      typed = '';
      display.classList.remove('is-flash');
      showDigits('', number.length, null);
      setKeys(true);
      setText(status, t.type(round + 1));
      typeAt = ctx.clock.now();
      keys[0]?.focus({ preventScroll: true });
      answerTimer = ctx.clock.setTimeout(() => confirm(true), ANSWER_MS);
    }, showMs(number.length));
  }

  function typeDigit(digit: string): void {
    if (phase !== 'type' || !latest) return;
    const number = latest.numbers[round] ?? '';
    if (typed.length >= number.length) return;
    typed += digit;
    showDigits(typed, number.length, null);
    ctx.sfx.play('click');
  }

  function erase(): void {
    if (phase !== 'type' || !latest) return;
    typed = typed.slice(0, -1);
    showDigits(typed, (latest.numbers[round] ?? '').length, null);
  }

  function confirm(timeUp = false): void {
    if (phase !== 'type' || !latest) return;
    if (answerTimer !== null) ctx.clock.clearTimeout(answerTimer);
    answerTimer = null;
    const number = latest.numbers[round] ?? '';
    const ms = timeUp ? ANSWER_MS : Math.round(ctx.clock.now() - typeAt);
    answers.push({ digits: typed, ms });
    phase = 'feedback';
    setKeys(false);
    showDigits(number, number.length, typed);
    const points = roundPoints(number, typed);
    const message = `${timeUp ? `${t.timeUp} ` : ''}${t.got(points, number.length)}`;
    setText(status, message);
    live.textContent = message;
    ctx.sfx.play(points === number.length ? 'win' : 'click');
    later(() => {
      round += 1;
      if (round >= ROUNDS) finish();
      else startRound();
    }, FEEDBACK_MS);
  }

  function finish(): void {
    phase = 'done';
    if (!submitted && canAct.includes(me)) {
      submitted = true;
      ctx.submit(me, { kind: 'answers', answers: [...answers] });
    }
    update();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const digit = /^(?:Digit|Numpad)(\d)$/.exec(event.code)?.[1];
    if (digit !== undefined) {
      event.preventDefault();
      typeDigit(digit);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      erase();
    } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      confirm();
    }
  }
  window.addEventListener('keydown', onKey);

  function update(): void {
    if (!latest) return;
    const results = latest.results;
    let text = phase === 'waiting' || phase === 'countdown' ? t.waiting : t.playing;
    if (results) text = t.result(results[opp]);
    else if (latest.opponentDone) text = t.done;
    setText(opponentStatus, text);
    opponentEl.classList.toggle('is-winner', outcome?.kind === 'win' && outcome.winner === opp);
    if (outcome && results) {
      const verdict = outcome.kind === 'draw' ? t.draw : t.winner(ctx.names[outcome.winner]);
      setText(
        status,
        `${t.you}: ${t.result(results[me])} · ${ctx.names[opp]}: ${t.result(results[opp])} – ${verdict}`,
      );
      live.textContent = verdict;
    } else if (phase === 'done' && !latest.opponentDone) {
      setText(status, t.waitingFor(ctx.names[opp]));
    }
  }

  return {
    render(view, frame) {
      latest = view;
      canAct = frame.canAct;
      outcome = frame.finished;
      if (phase === 'waiting' && !outcome) begin();
      update();
    },
    destroy() {
      for (const handle of timers) ctx.clock.clearTimeout(handle);
      if (answerTimer !== null) ctx.clock.clearTimeout(answerTimer);
      window.removeEventListener('keydown', onKey);
      opponentEl.remove();
      status.remove();
      display.remove();
      keypad.remove();
      live.remove();
    },
  };
}
