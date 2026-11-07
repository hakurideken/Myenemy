import type { GameView, ViewContext } from '../../core/MiniGame';
import { otherPlayer, type Outcome, type PlayerSlot } from '../../core/types';
import type { TimerHandle } from '../../core/util/clock';
import { translations } from '../../i18n';
import { h, setText } from '../../ui/dom';
import { PICTURE_NAMES, pictureIcon } from '../pexeso/view';
import {
  ANSWER_MS,
  BLANK_MS,
  CELLS,
  COLS,
  COUNTDOWN_MS,
  FEEDBACK_MS,
  MEMORIZE_MS,
  ROUNDS,
  type Board,
  type SpotAnswer,
  type SpotMove,
  type SpotResult,
  type SpotView,
} from './logic';

const t = translations(
  {
    getReady: 'Připrav se…',
    memorize: (round: number) => `Kolo ${round}/${ROUNDS} · zapamatuj si desku`,
    question: (round: number) => `Kolo ${round}/${ROUNDS} · co se změnilo? Klikni na to místo.`,
    right: 'Správně!',
    wrongCell: 'Vedle.',
    noAnswer: 'Čas vypršel.',
    kind: { gone: 'Něco zmizelo.', new: 'Něco přibylo.', swap: 'Něco se vyměnilo.' },
    waiting: 'čeká na start',
    playing: 'hraje…',
    done: 'má hotovo',
    waitingFor: (name: string) => `Hotovo – čekám na ${name}…`,
    you: 'Ty',
    result: (r: SpotResult | undefined) =>
      !r ? '…' : r.kind === 'invalid' ? 'neplatné' : `${r.correct}/${ROUNDS}`,
    draw: 'Remíza',
    winner: (name: string) => `Vítěz: ${name}`,
    board: 'Deska 4 × 4',
    cell: (row: number, col: number, what: string) => `Řada ${row}, pozice ${col}: ${what}`,
    empty: 'prázdné',
  },
  {
    getReady: 'Get ready…',
    memorize: (round: number) => `Round ${round}/${ROUNDS} · memorise the board`,
    question: (round: number) => `Round ${round}/${ROUNDS} · what changed? Click that spot.`,
    right: 'Correct!',
    wrongCell: 'Missed.',
    noAnswer: 'Time is up.',
    kind: {
      gone: 'Something vanished.',
      new: 'Something appeared.',
      swap: 'Something was swapped.',
    },
    waiting: 'waiting for the start',
    playing: 'playing…',
    done: 'done',
    waitingFor: (name: string) => `Done – waiting for ${name}…`,
    you: 'You',
    result: (r: SpotResult | undefined) =>
      !r ? '…' : r.kind === 'invalid' ? 'invalid' : `${r.correct}/${ROUNDS}`,
    draw: 'Draw',
    winner: (name: string) => `Winner: ${name}`,
    board: 'Board 4 × 4',
    cell: (row: number, col: number, what: string) => `Row ${row}, position ${col}: ${what}`,
    empty: 'empty',
  },
);

type Phase = 'waiting' | 'countdown' | 'memorize' | 'blank' | 'question' | 'feedback' | 'done';

export function createSpotView(ctx: ViewContext<SpotMove>): GameView<SpotView> {
  const me: PlayerSlot = ctx.localPlayers[0] ?? 'A';
  const opp = otherPlayer(me);
  const timers: TimerHandle[] = [];
  let phase: Phase = 'waiting';
  let latest: SpotView | null = null;
  let canAct: readonly PlayerSlot[] = [];
  let outcome: Outcome | null = null;
  let round = 0;
  let questionAt = 0;
  let answerTimer: TimerHandle | null = null;
  const answers: SpotAnswer[] = [];
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
  const cells = Array.from({ length: CELLS }, (_, index) =>
    h('button', {
      type: 'button',
      class: 'sc-cell',
      disabled: true,
      onclick: () => answer(index),
    }),
  );
  const grid = h('div', { class: 'sc-grid', role: 'group', 'aria-label': t.board }, ...cells);
  ctx.root.append(opponentEl, status, grid, live);

  const later = (fn: () => void, ms: number): void => {
    timers.push(ctx.clock.setTimeout(fn, ms));
  };

  function paint(board: Board | null, clickable: boolean): void {
    cells.forEach((cell, index) => {
      const picture = board?.[index] ?? null;
      cell.replaceChildren(picture === null ? '' : pictureIcon(picture));
      cell.disabled = !clickable;
      cell.classList.remove('is-right', 'is-wrong', 'is-target');
      const name = picture === null ? t.empty : (PICTURE_NAMES[picture] ?? '');
      cell.setAttribute(
        'aria-label',
        t.cell(Math.floor(index / COLS) + 1, (index % COLS) + 1, board ? name : t.empty),
      );
    });
    grid.classList.toggle('is-question', clickable);
  }

  function begin(): void {
    phase = 'countdown';
    paint(null, false);
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
    const data = latest.rounds[round];
    if (!data) return;
    phase = 'memorize';
    paint(data.before, false);
    setText(status, t.memorize(round + 1));
    live.textContent = t.memorize(round + 1);
    later(() => {
      phase = 'blank';
      paint(null, false);
    }, MEMORIZE_MS[round] ?? 3000);
    later(
      () => {
        phase = 'question';
        paint(data.after, true);
        setText(status, t.question(round + 1));
        live.textContent = t.question(round + 1);
        ctx.sfx.play('signal');
        questionAt = ctx.clock.now();
        cells[0]?.focus({ preventScroll: true });
        answerTimer = ctx.clock.setTimeout(() => answer(-1), ANSWER_MS);
      },
      (MEMORIZE_MS[round] ?? 3000) + BLANK_MS,
    );
  }

  function answer(cell: number): void {
    if (phase !== 'question' || !latest) return;
    const data = latest.rounds[round];
    if (!data) return;
    if (answerTimer !== null) ctx.clock.clearTimeout(answerTimer);
    answerTimer = null;
    const ms = cell < 0 ? ANSWER_MS : Math.round(ctx.clock.now() - questionAt);
    answers.push({ cell, ms });
    phase = 'feedback';
    for (const c of cells) c.disabled = true;
    const right = cell === data.cell;
    cells[data.cell]?.classList.add(right ? 'is-right' : 'is-target');
    if (!right && cell >= 0) cells[cell]?.classList.add('is-wrong');
    const message = `${right ? t.right : cell < 0 ? t.noAnswer : t.wrongCell} ${t.kind[data.kind]}`;
    setText(status, message);
    live.textContent = message;
    ctx.sfx.play(right ? 'win' : 'click');
    later(() => {
      round += 1;
      if (round >= ROUNDS) finish();
      else startRound();
    }, FEEDBACK_MS);
  }

  function finish(): void {
    phase = 'done';
    grid.classList.add('is-done');
    if (!submitted && canAct.includes(me)) {
      submitted = true;
      ctx.submit(me, { kind: 'answers', answers: [...answers] });
    }
    update();
  }

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
      opponentEl.remove();
      status.remove();
      grid.remove();
      live.remove();
    },
  };
}
