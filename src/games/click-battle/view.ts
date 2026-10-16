import type { GameView, ViewContext } from '../../core/MiniGame';
import { otherPlayer, type Outcome, type PlayerSlot } from '../../core/types';
import type { TimerHandle } from '../../core/util/clock';
import { h, setText } from '../../ui/dom';
import {
  COUNTDOWN_MS,
  DURATION_MS,
  formatClicks,
  type ClickMove,
  type ClickResult,
  type ClickView,
} from './logic';

const SPLIT_KEYS: Partial<Record<string, PlayerSlot>> = { KeyA: 'A', KeyL: 'B' };
const SOLO_KEYS = new Set(['Space', 'Enter']);
/** Rychlejší „kliknutí“ jsou zákmity / autoklikr – nepočítají se. */
const MIN_GAP_MS = 25;

type Phase = 'waiting' | 'countdown' | 'live' | 'done';

interface Lane {
  readonly player: PlayerSlot;
  readonly el: HTMLElement;
  readonly big: HTMLElement;
  readonly status: HTMLElement;
  presses: number;
  lastPress: number;
  submitted: boolean;
}

export function createClickView(ctx: ViewContext<ClickMove>): GameView<ClickView> {
  const split = ctx.localPlayers.length > 1;
  const timers: TimerHandle[] = [];
  let phase: Phase = 'waiting';
  let countdown = 3;
  let latest: ClickView | null = null;
  let canAct: readonly PlayerSlot[] = [];
  let outcome: Outcome | null = null;

  const live = h('p', { class: 'sr-only', 'aria-live': 'assertive' });
  const arena = h('div', { class: `cb ${split ? 'cb--split' : 'cb--solo'}`, tabindex: '-1' });

  const lanes: Lane[] = ctx.localPlayers.map((player) => {
    const big = h('span', { class: 'cb-big' }, '3');
    const status = h('span', { class: 'cb-status' }, 'Připrav se…');
    const hint = split
      ? `Klávesa ${player === 'A' ? 'A' : 'L'} nebo klepej sem`
      : 'Mezerník, Enter nebo klepej kamkoli';
    const el = h(
      'div',
      {
        class: `cb-lane cb-lane--${player.toLowerCase()}`,
        onpointerdown: (event: PointerEvent) => {
          event.preventDefault();
          press(player);
        },
      },
      h('span', { class: 'cb-name' }, ctx.names[player]),
      big,
      status,
      h('span', { class: 'cb-bar', 'aria-hidden': 'true' }),
      h('span', { class: 'cb-hint' }, hint),
    );
    return { player, el, big, status, presses: 0, lastPress: -Infinity, submitted: false };
  });

  const opponent = split ? null : otherPlayer(ctx.localPlayers[0] ?? 'A');
  const opponentStatus = h('span', { class: 'qd-opponent-status' }, 'čeká na start');
  const opponentEl = opponent
    ? h(
        'div',
        { class: `qd-opponent qd-opponent--${opponent.toLowerCase()}` },
        h('span', { class: 'qd-name' }, ctx.names[opponent]),
        opponentStatus,
      )
    : null;

  arena.append(...lanes.map((lane) => lane.el));
  ctx.root.append(...(opponentEl ? [opponentEl] : []), arena, live);

  function press(player: PlayerSlot): void {
    const lane = lanes.find((l) => l.player === player);
    if (!lane || phase !== 'live' || lane.submitted) return;
    const now = ctx.clock.now();
    if (now - lane.lastPress < MIN_GAP_MS) return;
    lane.lastPress = now;
    lane.presses += 1;
    setText(lane.big, String(lane.presses));
    if (!ctx.prefs.reducedMotion) {
      lane.big.classList.remove('is-bump');
      void lane.big.offsetWidth;
      lane.big.classList.add('is-bump');
    }
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const player = split
      ? SPLIT_KEYS[event.code]
      : SOLO_KEYS.has(event.code)
        ? ctx.localPlayers[0]
        : undefined;
    if (!player) return;
    event.preventDefault();
    press(player);
  }
  window.addEventListener('keydown', onKey);

  function begin(): void {
    phase = 'countdown';
    for (const step of [1, 2]) {
      timers.push(
        ctx.clock.setTimeout(() => {
          countdown = 3 - step;
          ctx.sfx.play('tick');
          update();
        }, step * 1000),
      );
    }
    timers.push(ctx.clock.setTimeout(go, COUNTDOWN_MS));
    ctx.sfx.play('tick');
  }

  function go(): void {
    if (outcome) return;
    phase = 'live';
    arena.classList.add('is-live');
    arena.style.setProperty('--cb-duration', `${DURATION_MS}ms`);
    live.textContent = 'Klikej!';
    ctx.sfx.play('signal');
    ctx.sfx.vibrate(60);
    for (const lane of lanes) setText(lane.big, '0');
    timers.push(ctx.clock.setTimeout(stop, DURATION_MS));
    update();
  }

  function stop(): void {
    phase = 'done';
    arena.classList.remove('is-live');
    arena.classList.add('is-done');
    for (const lane of lanes) {
      if (lane.submitted || !canAct.includes(lane.player)) continue;
      lane.submitted = true;
      ctx.submit(lane.player, { kind: 'clicks', count: lane.presses });
    }
    update();
  }

  function laneStatus(lane: Lane, result: ClickResult | undefined): string {
    if (outcome) {
      if (outcome.kind === 'draw') return 'Remíza';
      return outcome.winner === lane.player ? '★ Vítěz!' : 'Pomalejší';
    }
    if (phase === 'countdown' || phase === 'waiting') return 'Připrav se…';
    if (phase === 'live') return 'KLIKEJ!';
    return result?.kind === 'invalid' ? 'Neplatné' : 'Hotovo';
  }

  function update(): void {
    const results = latest?.results ?? null;
    for (const lane of lanes) {
      const result = results?.[lane.player];
      if (phase === 'countdown') setText(lane.big, String(countdown));
      if (outcome && result) setText(lane.big, formatClicks(result));
      setText(lane.status, laneStatus(lane, result));
      lane.el.classList.toggle(
        'is-winner',
        outcome?.kind === 'win' && outcome.winner === lane.player,
      );
    }
    if (opponent && opponentEl && latest) {
      let text = phase === 'live' ? 'kliká…' : 'čeká na start';
      if (outcome && results) text = formatClicks(results[opponent]);
      else if (latest.opponentDone) text = 'má hotovo';
      setText(opponentStatus, text);
      opponentEl.classList.toggle(
        'is-winner',
        outcome?.kind === 'win' && outcome.winner === opponent,
      );
    }
    arena.classList.toggle('is-finished', outcome !== null);
    if (outcome) {
      live.textContent =
        outcome.kind === 'draw' ? 'Remíza.' : `Vítěz: ${ctx.names[outcome.winner]}.`;
    }
  }

  return {
    render(view, frame) {
      latest = view;
      canAct = frame.canAct;
      outcome = frame.finished;
      if (phase === 'waiting') {
        arena.focus({ preventScroll: true });
        begin();
      }
      update();
    },
    destroy() {
      for (const t of timers) ctx.clock.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      opponentEl?.remove();
      arena.remove();
      live.remove();
    },
  };
}
