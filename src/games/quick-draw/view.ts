import type { GameView, ViewContext } from '../../core/MiniGame';
import { otherPlayer, type Outcome, type PlayerSlot } from '../../core/types';
import type { TimerHandle } from '../../core/util/clock';
import { translations } from '../../i18n';
import { h, setText, svg } from '../../ui/dom';
import {
  formatResult,
  REACTION_TIMEOUT_MS,
  type QuickDrawMove,
  type QuickDrawResult,
  type QuickDrawView,
} from './logic';

const t = translations(
  {
    draw: 'Remíza',
    winner: 'Vítěz!',
    falseStart: 'Předčasně!',
    timeout: 'Nestihl',
    slower: 'Pomalejší',
    getReady: 'Připrav se…',
    splitHint: (key: string) => `Klávesa ${key} nebo klepni sem`,
    soloHint: 'Mezerník, Enter nebo klepni kamkoli',
    opponentWaiting: 'čeká na signál',
    opponentAiming: 'míří…',
    opponentFired: 'vystřelil!',
    opponentFalseStart: 'vystřelil předčasně!',
    signalLive: 'Pal!',
    signal: 'PAL!',
    shot: 'Výstřel!',
    youTimedOut: 'Nestihl jsi!',
    drawLive: 'Remíza.',
    winnerLive: (name: string) => `Vítěz: ${name}.`,
  },
  {
    draw: 'Draw',
    winner: 'Winner!',
    falseStart: 'Too early!',
    timeout: 'Too late',
    slower: 'Slower',
    getReady: 'Get ready…',
    splitHint: (key: string) => `Press ${key} or tap here`,
    soloHint: 'Space, Enter or tap anywhere',
    opponentWaiting: 'waiting for the signal',
    opponentAiming: 'aiming…',
    opponentFired: 'fired!',
    opponentFalseStart: 'fired too early!',
    signalLive: 'Fire!',
    signal: 'FIRE!',
    shot: 'Bang!',
    youTimedOut: 'Too late!',
    drawLive: 'Draw.',
    winnerLive: (name: string) => `Winner: ${name}.`,
  },
);

const SPLIT_KEYS: Partial<Record<string, PlayerSlot>> = { KeyA: 'A', KeyL: 'B' };
const SOLO_KEYS = new Set(['Space', 'Enter']);

interface Lane {
  readonly player: PlayerSlot;
  readonly el: HTMLElement;
  readonly status: HTMLElement;
  readonly time: HTMLElement;
}

function burstIcon(): SVGSVGElement {
  const points: string[] = [];
  for (let i = 0; i < 24; i++) {
    const r = i % 2 === 0 ? 48 : 30;
    const a = (Math.PI * 2 * i) / 24 - Math.PI / 2;
    points.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
  }
  return svg(
    'svg',
    { viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' },
    svg('polygon', { points: points.join(' ') }),
  );
}

function finalStatus(
  player: PlayerSlot,
  result: QuickDrawResult | undefined,
  outcome: Outcome,
): string {
  if (outcome.kind === 'draw') return t.draw;
  if (outcome.winner === player) return t.winner;
  if (result?.kind === 'false-start') return t.falseStart;
  if (result?.kind === 'timeout') return t.timeout;
  return t.slower;
}

export function createQuickDrawView(ctx: ViewContext<QuickDrawMove>): GameView<QuickDrawView> {
  const split = ctx.localPlayers.length > 1;
  const timers: TimerHandle[] = [];
  let started = false;
  let signalShown = false;
  let signalAt = 0;
  let latest: QuickDrawView | null = null;
  let canAct: readonly PlayerSlot[] = [];
  let outcome: Outcome | null = null;

  const live = h('p', { class: 'sr-only', 'aria-live': 'assertive' });
  const arena = h('div', { class: `qd ${split ? 'qd--split' : 'qd--solo'}`, tabindex: '-1' });

  const lanes: Lane[] = ctx.localPlayers.map((player) => {
    const status = h('span', { class: 'qd-status' }, t.getReady);
    const time = h('span', { class: 'qd-time' });
    const hint = split ? t.splitHint(player === 'A' ? 'A' : 'L') : t.soloHint;
    const el = h(
      'div',
      {
        class: `qd-lane qd-lane--${player.toLowerCase()}`,
        onpointerdown: (event: PointerEvent) => {
          event.preventDefault();
          press(player);
        },
      },
      h('span', { class: 'qd-name' }, ctx.names[player]),
      h('span', { class: 'qd-burst' }, burstIcon()),
      status,
      time,
      h('span', { class: 'qd-hint' }, hint),
    );
    return { player, el, status, time };
  });

  const opponent = split ? null : otherPlayer(ctx.localPlayers[0] ?? 'A');
  const opponentStatus = h('span', { class: 'qd-opponent-status' }, t.opponentWaiting);
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
    if (outcome || !canAct.includes(player) || latest?.results[player]) return;
    if (!signalShown) {
      ctx.submit(player, { kind: 'false-start' });
      return;
    }
    ctx.submit(player, { kind: 'reacted', ms: ctx.clock.now() - signalAt });
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

  function showSignal(): void {
    if (outcome) return;
    signalShown = true;
    signalAt = ctx.clock.now();
    // Přesnější začátek měření: těsně před vykreslením signálu.
    requestAnimationFrame(() => {
      signalAt = ctx.clock.now();
    });
    arena.classList.remove('is-waiting');
    arena.classList.add('is-signal');
    live.textContent = t.signalLive;
    ctx.sfx.play('signal');
    ctx.sfx.vibrate(60);
    for (const lane of lanes) {
      timers.push(
        ctx.clock.setTimeout(() => {
          if (!outcome && canAct.includes(lane.player) && !latest?.results[lane.player]) {
            ctx.submit(lane.player, { kind: 'timeout' });
          }
        }, REACTION_TIMEOUT_MS + 50),
      );
    }
    update();
  }

  function laneStatus(result: QuickDrawResult | undefined): string {
    if (!result) return signalShown ? t.signal : t.getReady;
    if (result.kind === 'reacted') return t.shot;
    return result.kind === 'false-start' ? t.falseStart : t.youTimedOut;
  }

  function update(): void {
    const results = latest?.results ?? {};
    for (const lane of lanes) {
      const result = results[lane.player];
      setText(
        lane.status,
        outcome ? finalStatus(lane.player, result, outcome) : laneStatus(result),
      );
      setText(lane.time, result?.kind === 'reacted' ? `${result.ms} ms` : '');
      lane.el.classList.toggle('is-done', result !== undefined);
      lane.el.classList.toggle('is-foul', result?.kind === 'false-start');
      lane.el.classList.toggle(
        'is-winner',
        outcome?.kind === 'win' && outcome.winner === lane.player,
      );
    }
    if (opponent && opponentEl) {
      const result = results[opponent];
      let text = signalShown ? t.opponentAiming : t.opponentWaiting;
      if (result && outcome) text = formatResult(result);
      else if (result)
        text = result.kind === 'false-start' ? t.opponentFalseStart : t.opponentFired;
      setText(opponentStatus, text);
      opponentEl.classList.toggle('is-done', result !== undefined);
      opponentEl.classList.toggle(
        'is-winner',
        outcome?.kind === 'win' && outcome.winner === opponent,
      );
    }
    arena.classList.toggle('is-finished', outcome !== null);
    if (outcome) {
      live.textContent =
        outcome.kind === 'draw' ? t.drawLive : t.winnerLive(ctx.names[outcome.winner]);
    }
  }

  return {
    render(view, frame) {
      latest = view;
      canAct = frame.canAct;
      outcome = frame.finished;
      if (!started) {
        started = true;
        arena.classList.add('is-waiting');
        arena.focus({ preventScroll: true });
        timers.push(ctx.clock.setTimeout(showSignal, view.delayMs));
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
