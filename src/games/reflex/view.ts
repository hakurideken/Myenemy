import type { GameView, ViewContext } from '../../core/MiniGame';
import { otherPlayer, type Outcome, type PlayerSlot } from '../../core/types';
import type { TimerHandle } from '../../core/util/clock';
import { h, setText, svg } from '../../ui/dom';
import {
  formatReflex,
  normalizeReflex,
  targetLabel,
  TARGET_COUNT,
  TIMEOUT_MS,
  type ReflexMove,
  type ReflexResult,
  type ReflexView,
  type Target,
} from './logic';

/** Klávesy cílů: sólo 1–4, lokálně A = Q W E R, B = U I O P. */
const SPLIT_KEYS: Record<PlayerSlot, readonly string[]> = {
  A: ['KeyQ', 'KeyW', 'KeyE', 'KeyR'],
  B: ['KeyU', 'KeyI', 'KeyO', 'KeyP'],
};
const SOLO_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
const NUMPAD_KEYS = ['Numpad1', 'Numpad2', 'Numpad3', 'Numpad4'];
const KEY_LABEL: Record<PlayerSlot, readonly string[]> = {
  A: ['Q', 'W', 'E', 'R'],
  B: ['U', 'I', 'O', 'P'],
};

export function shapeIcon(target: Target): SVGSVGElement {
  const attrs = { class: `shape shape--${target.color}` };
  let body: SVGElement;
  switch (target.shape) {
    case 'circle':
      body = svg('circle', { ...attrs, cx: '20', cy: '20', r: '14' });
      break;
    case 'triangle':
      body = svg('path', { ...attrs, d: 'M20 5 36 34H4Z' });
      break;
    case 'square':
      body = svg('rect', { ...attrs, x: '6', y: '6', width: '28', height: '28', rx: '3' });
      break;
    case 'star':
      body = svg('path', {
        ...attrs,
        d: 'M20 3l4.9 10.6 11.6 1.3-8.6 7.9 2.4 11.4L20 28.4 9.7 34.2l2.4-11.4-8.6-7.9 11.6-1.3Z',
      });
      break;
  }
  return svg('svg', { viewBox: '0 0 40 40', 'aria-hidden': 'true', focusable: 'false' }, body);
}

interface Lane {
  readonly player: PlayerSlot;
  readonly el: HTMLElement;
  readonly prompt: HTMLElement;
  readonly result: HTMLElement;
  readonly buttons: HTMLButtonElement[];
  local: ReflexResult | null;
}

export function createReflexView(ctx: ViewContext<ReflexMove>): GameView<ReflexView> {
  const split = ctx.localPlayers.length > 1;
  const timers: TimerHandle[] = [];
  let started = false;
  let shown = false;
  let shownAt = 0;
  let latest: ReflexView | null = null;
  let canAct: readonly PlayerSlot[] = [];
  let outcome: Outcome | null = null;

  const live = h('p', { class: 'sr-only', 'aria-live': 'assertive' });
  const arena = h('div', { class: `rf ${split ? 'rf--split' : 'rf--solo'}`, tabindex: '-1' });

  const lanes: Lane[] = ctx.localPlayers.map((player) => {
    const prompt = h('p', { class: 'rf-prompt' }, 'Připrav se…');
    const result = h('p', { class: 'rf-result', 'aria-live': 'polite' });
    const buttons = Array.from({ length: TARGET_COUNT }, (_, i) =>
      h('button', {
        type: 'button',
        class: 'rf-target',
        onpointerdown: (event: PointerEvent) => {
          event.preventDefault();
          tap(player, i);
        },
      }),
    );
    const el = h(
      'div',
      { class: `rf-lane rf-lane--${player.toLowerCase()}` },
      h('span', { class: 'qd-name' }, ctx.names[player]),
      prompt,
      h('div', { class: 'rf-targets', role: 'group', 'aria-label': 'Cíle' }, buttons),
      result,
    );
    return { player, el, prompt, result, buttons, local: null };
  });

  const opponent = split ? null : otherPlayer(ctx.localPlayers[0] ?? 'A');
  const opponentStatus = h('span', { class: 'qd-opponent-status' }, 'čeká na výzvu');
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

  function tap(player: PlayerSlot, index: number): void {
    const lane = lanes.find((l) => l.player === player);
    if (!lane || !latest || outcome || lane.local || !canAct.includes(player)) return;
    const move: ReflexMove = shown
      ? { kind: 'tap', index, ms: ctx.clock.now() - shownAt }
      : { kind: 'false-start' };
    lane.local = normalizeReflex(move, latest.target);
    ctx.submit(player, move);
    update();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    for (const lane of lanes) {
      const keys = split ? SPLIT_KEYS[lane.player] : SOLO_KEYS;
      let index = keys.indexOf(event.code);
      if (index < 0 && !split) index = NUMPAD_KEYS.indexOf(event.code);
      if (index >= 0) {
        event.preventDefault();
        tap(lane.player, index);
        return;
      }
    }
  }
  window.addEventListener('keydown', onKey);

  function showPrompt(): void {
    if (outcome || !latest) return;
    shown = true;
    shownAt = ctx.clock.now();
    requestAnimationFrame(() => {
      shownAt = ctx.clock.now();
    });
    const target = latest.targets[latest.target];
    arena.classList.add('is-signal');
    for (const lane of lanes) {
      if (!target) continue;
      lane.prompt.replaceChildren(
        'Klepni na: ',
        shapeIcon(target),
        h('strong', null, targetLabel(target)),
      );
    }
    live.textContent = target ? `Klepni na: ${targetLabel(target)}` : '';
    ctx.sfx.play('signal');
    ctx.sfx.vibrate(40);
    for (const lane of lanes) {
      timers.push(
        ctx.clock.setTimeout(() => {
          if (!outcome && !lane.local && canAct.includes(lane.player)) {
            lane.local = { kind: 'timeout' };
            ctx.submit(lane.player, { kind: 'timeout' });
            update();
          }
        }, TIMEOUT_MS + 50),
      );
    }
  }

  function laneText(lane: Lane): string {
    const final = outcome && latest?.results ? latest.results[lane.player] : null;
    const result = final ?? lane.local;
    if (outcome?.kind === 'win' && outcome.winner === lane.player)
      return `★ Vítěz! ${formatReflex(result ?? undefined)}`;
    if (outcome?.kind === 'draw') return `Remíza · ${formatReflex(result ?? undefined)}`;
    if (!result) return '';
    switch (result.kind) {
      case 'hit':
        return `Zásah! ${result.ms} ms`;
      case 'miss':
        return '✗ Vedle!';
      case 'false-start':
        return '✗ Předčasně!';
      case 'timeout':
        return 'Nestihl jsi!';
    }
  }

  function update(): void {
    if (!latest) return;
    for (const lane of lanes) {
      lane.buttons.forEach((button, i) => {
        const target = latest?.targets[i];
        if (target && button.dataset.shape !== `${target.color}-${target.shape}`) {
          button.dataset.shape = `${target.color}-${target.shape}`;
          button.replaceChildren(
            shapeIcon(target),
            h('kbd', null, split ? (KEY_LABEL[lane.player][i] ?? '') : String(i + 1)),
          );
          button.setAttribute('aria-label', targetLabel(target));
        }
        button.disabled = outcome !== null || lane.local !== null || !canAct.includes(lane.player);
        button.classList.toggle('is-correct', outcome !== null && i === latest?.target);
      });
      setText(lane.result, laneText(lane));
      lane.el.classList.toggle('is-done', lane.local !== null);
      lane.el.classList.toggle(
        'is-winner',
        outcome?.kind === 'win' && outcome.winner === lane.player,
      );
    }
    if (opponent && opponentEl) {
      let text = shown ? 'hledá cíl…' : 'čeká na výzvu';
      if (outcome && latest.results) text = formatReflex(latest.results[opponent]);
      else if (latest.opponentDone) text = 'klepl(a)!';
      setText(opponentStatus, text);
      opponentEl.classList.toggle(
        'is-winner',
        outcome?.kind === 'win' && outcome.winner === opponent,
      );
    }
    arena.classList.toggle('is-finished', outcome !== null);
  }

  return {
    render(view, frame) {
      latest = view;
      canAct = frame.canAct;
      outcome = frame.finished;
      if (!started) {
        started = true;
        arena.focus({ preventScroll: true });
        timers.push(ctx.clock.setTimeout(showPrompt, view.delayMs));
      }
      update();
      if (outcome)
        live.textContent =
          outcome.kind === 'draw' ? 'Remíza.' : `Vítěz: ${ctx.names[outcome.winner]}.`;
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
