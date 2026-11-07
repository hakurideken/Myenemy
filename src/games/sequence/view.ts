import type { GameView, SfxName, ViewContext } from '../../core/MiniGame';
import { otherPlayer, type Outcome, type PlayerSlot } from '../../core/types';
import type { TimerHandle } from '../../core/util/clock';
import { translations } from '../../i18n';
import { h, setText } from '../../ui/dom';
import { plural } from '../../ui/labels';
import { targetLabel, type Target } from '../reflex/logic';
import { shapeIcon } from '../reflex/view';
import {
  COUNTDOWN_MS,
  IDLE_MS,
  LEVEL_PAUSE_MS,
  levelLength,
  MAX_LEVEL,
  PADS,
  SHOW_GAP_MS,
  showOnMs,
  type SequenceMove,
  type SequenceResult,
  type SequenceView,
} from './logic';

const t = translations(
  {
    getReady: 'Připrav se…',
    watch: (level: number, length: number) => `Kolo ${level} · dívej se (${length})`,
    repeat: (done: number, length: number) => `Opakuj: ${done} / ${length}`,
    correct: 'Správně!',
    wrong: 'Chyba!',
    idle: 'Čas vypršel.',
    allDone: 'Všech 15 kol zvládnuto!',
    you: 'Ty',
    waiting: 'čeká na start',
    playing: 'hraje…',
    done: 'má hotovo',
    waitingFor: (name: string) => `Hotovo – čekám na ${name}…`,
    result: (r: SequenceResult | undefined) =>
      !r
        ? '…'
        : r.kind === 'invalid'
          ? 'neplatné'
          : `${r.level} ${plural(r.level, 'kolo', 'kola', 'kol')}`,
    draw: 'Remíza',
    winner: (name: string) => `Vítěz: ${name}`,
    pads: 'Pole Sekvence',
    keys: 'Klávesy 1–4',
  },
  {
    getReady: 'Get ready…',
    watch: (level: number, length: number) => `Round ${level} · watch (${length})`,
    repeat: (done: number, length: number) => `Repeat: ${done} / ${length}`,
    correct: 'Correct!',
    wrong: 'Wrong!',
    idle: 'Time is up.',
    allDone: 'All 15 rounds cleared!',
    you: 'You',
    waiting: 'waiting for the start',
    playing: 'playing…',
    done: 'done',
    waitingFor: (name: string) => `Done – waiting for ${name}…`,
    result: (r: SequenceResult | undefined) =>
      !r
        ? '…'
        : r.kind === 'invalid'
          ? 'invalid'
          : `${r.level} ${r.level === 1 ? 'round' : 'rounds'}`,
    draw: 'Draw',
    winner: (name: string) => `Winner: ${name}`,
    pads: 'Sequence pads',
    keys: 'Keys 1–4',
  },
);

/** Pole: barva i tvar (rozliší je i barvoslepý), každé má svůj tón. */
export const PAD_TARGETS: readonly Target[] = [
  { color: 'red', shape: 'circle' },
  { color: 'blue', shape: 'triangle' },
  { color: 'green', shape: 'square' },
  { color: 'yellow', shape: 'star' },
];
const PAD_SOUND: readonly SfxName[] = ['pad0', 'pad1', 'pad2', 'pad3'];
const KEYS: Record<string, number> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Digit4: 3,
  Numpad1: 0,
  Numpad2: 1,
  Numpad3: 2,
  Numpad4: 3,
};

type Phase = 'waiting' | 'countdown' | 'show' | 'input' | 'pause' | 'done';

export function createSequenceView(ctx: ViewContext<SequenceMove>): GameView<SequenceView> {
  const me: PlayerSlot = ctx.localPlayers[0] ?? 'A';
  const opp = otherPlayer(me);
  const timers: TimerHandle[] = [];
  let phase: Phase = 'waiting';
  let latest: SequenceView | null = null;
  let canAct: readonly PlayerSlot[] = [];
  let outcome: Outcome | null = null;
  let level = 1;
  let step = 0;
  let levelStart = 0;
  let totalMs = 0;
  let idle: TimerHandle | null = null;
  const presses: number[] = [];
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
  const padButtons = PAD_TARGETS.map((target, index) =>
    h(
      'button',
      {
        type: 'button',
        class: `sq-pad sq-pad--${target.color}`,
        'aria-label': `${index + 1}: ${targetLabel(target)}`,
        disabled: true,
        onpointerdown: (event: PointerEvent) => {
          event.preventDefault();
          press(index);
        },
      },
      shapeIcon(target),
      h('kbd', null, String(index + 1)),
    ),
  );
  const board = h('div', { class: 'sq-board', role: 'group', 'aria-label': t.pads }, ...padButtons);
  const hint = h('p', { class: 'field-hint sq-hint' }, t.keys);
  ctx.root.append(opponentEl, status, board, hint, live);

  const later = (fn: () => void, ms: number): void => {
    timers.push(ctx.clock.setTimeout(fn, ms));
  };

  function light(index: number, ms: number): void {
    const button = padButtons[index];
    if (!button) return;
    button.classList.add('is-lit');
    ctx.sfx.play(PAD_SOUND[index] ?? 'tick');
    later(() => button.classList.remove('is-lit'), ms);
  }

  function setInput(on: boolean): void {
    for (const b of padButtons) b.disabled = !on;
    board.classList.toggle('is-input', on);
  }

  function begin(): void {
    phase = 'countdown';
    for (const s of [0, 1, 2]) {
      later(() => {
        setText(status, `${t.getReady} ${3 - s}`);
        ctx.sfx.play('tick');
      }, s * 1000);
    }
    later(() => showLevel(), COUNTDOWN_MS);
  }

  function showLevel(): void {
    if (phase === 'done' || !latest) return;
    phase = 'show';
    setInput(false);
    const length = levelLength(level);
    setText(status, t.watch(level, length));
    live.textContent = t.watch(level, length);
    const on = showOnMs(level);
    for (let i = 0; i < length; i++) {
      const pad = latest.sequence[i] ?? 0;
      later(() => light(pad, on), i * (on + SHOW_GAP_MS));
    }
    later(() => startInput(), length * (on + SHOW_GAP_MS));
  }

  function startInput(): void {
    if (phase === 'done') return;
    phase = 'input';
    step = 0;
    levelStart = ctx.clock.now();
    setInput(true);
    setText(status, t.repeat(0, levelLength(level)));
    padButtons[0]?.focus({ preventScroll: true });
    armIdle();
  }

  function armIdle(): void {
    if (idle !== null) ctx.clock.clearTimeout(idle);
    idle = ctx.clock.setTimeout(() => finish(t.idle), IDLE_MS);
  }

  function press(index: number): void {
    if (phase !== 'input' || !latest) return;
    presses.push(index);
    light(index, 180);
    const expected = latest.sequence[step];
    if (index !== expected) {
      finish(t.wrong);
      return;
    }
    step += 1;
    const length = levelLength(level);
    setText(status, t.repeat(step, length));
    if (step < length) {
      armIdle();
      return;
    }
    // Kolo zvládnuté.
    totalMs += Math.round(ctx.clock.now() - levelStart);
    if (idle !== null) ctx.clock.clearTimeout(idle);
    setInput(false);
    if (level >= MAX_LEVEL) {
      finish(t.allDone);
      return;
    }
    phase = 'pause';
    setText(status, t.correct);
    level += 1;
    later(() => showLevel(), LEVEL_PAUSE_MS);
  }

  function finish(message: string): void {
    if (phase === 'done') return;
    phase = 'done';
    if (idle !== null) ctx.clock.clearTimeout(idle);
    setInput(false);
    board.classList.add('is-done');
    if (message === t.wrong) ctx.sfx.play('lose');
    setText(status, message);
    live.textContent = message;
    if (!submitted && canAct.includes(me)) {
      submitted = true;
      ctx.submit(me, { kind: 'run', presses: [...presses], ms: totalMs });
    }
    update();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const index = KEYS[event.code];
    if (index === undefined || index >= PADS) return;
    event.preventDefault();
    press(index);
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
      const summary = `${t.you}: ${t.result(results[me])} · ${ctx.names[opp]}: ${t.result(results[opp])}`;
      const verdict = outcome.kind === 'draw' ? t.draw : t.winner(ctx.names[outcome.winner]);
      setText(status, `${summary} – ${verdict}`);
      live.textContent = verdict;
    } else if (phase === 'done' && latest.mine && !latest.opponentDone) {
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
      if (idle !== null) ctx.clock.clearTimeout(idle);
      window.removeEventListener('keydown', onKey);
      opponentEl.remove();
      status.remove();
      board.remove();
      hint.remove();
      live.remove();
    },
  };
}
