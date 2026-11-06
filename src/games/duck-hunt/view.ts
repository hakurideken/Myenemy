import type { GameView, ViewContext } from '../../core/MiniGame';
import { otherPlayer, type Outcome, type PlayerSlot } from '../../core/types';
import type { TimerHandle } from '../../core/util/clock';
import { translations } from '../../i18n';
import { h, setText, svg } from '../../ui/dom';
import { plural } from '../../ui/labels';
import {
  COUNTDOWN_MS,
  duckAt,
  duckHeading,
  DURATION_MS,
  FIELD_H,
  FIELD_W,
  findTarget,
  GROUND_Y,
  RELOAD_MS,
  type DuckMove,
  type DuckView,
} from './logic';

const t = translations(
  {
    ducks: (n: number) => `${n} ${plural(n, 'kachna', 'kachny', 'kachen')}`,
    you: 'Ty',
    getReady: 'Připrav se…',
    goLive: 'Střílej!',
    timeLeft: (s: number) => `Zbývá ${s} s`,
    reloading: 'Nabíjím…',
    waiting: 'Konec! Čekám na soupeře…',
    draw: 'Remíza',
    winner: (name: string) => `Vítěz: ${name}`,
    tieBreak: 'Stejně kachen – rozhodla rychlejší reakce.',
    scene: 'Obloha s kachnami. Klikni nebo klepni na kachnu, klávesy: šipky a mezerník.',
    hitLive: (n: number) => `Trefa! Máš ${n}.`,
    lostLive: 'Soupeř byl rychlejší.',
  },
  {
    ducks: (n: number) => `${n} ${n === 1 ? 'duck' : 'ducks'}`,
    you: 'You',
    getReady: 'Get ready…',
    goLive: 'Shoot!',
    timeLeft: (s: number) => `${s} s left`,
    reloading: 'Reloading…',
    waiting: 'Time! Waiting for your opponent…',
    draw: 'Draw',
    winner: (name: string) => `Winner: ${name}`,
    tieBreak: 'Same number of ducks – the faster reactions decided.',
    scene: 'A sky with ducks. Click or tap a duck; keys: arrows and Space.',
    hitLive: (n: number) => `Hit! You have ${n}.`,
    lostLive: 'Your opponent was faster.',
  },
);

type Phase = 'waiting' | 'countdown' | 'live' | 'done';

/** Rychlost zaměřovače při ovládání šipkami (jednotky za sekundu). */
const AIM_SPEED = 70;
/** Zrychlení pádu sestřelené kachny (jednotky / s²). */
const FALL_G = 160;
const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const r2 = (n: number): number => Math.round(n * 100) / 100;
const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

function duckShape(): SVGGElement {
  return svg(
    'g',
    { class: 'dh-duck', 'aria-hidden': 'true' },
    svg(
      'g',
      { class: 'dh-duck-body' },
      svg('path', { class: 'dh-tail', d: 'M-3.1 0.1 -5 -1.2 -4.4 1.1Z' }),
      svg('ellipse', { class: 'dh-body', cx: '0', cy: '0.5', rx: '3.5', ry: '2.1' }),
      svg('path', { class: 'dh-wing', d: 'M-1.6 0.2C-0.6 -3.4 1.6 -3.6 2 -0.2Z' }),
      svg('circle', { class: 'dh-head', cx: '3.1', cy: '-1.5', r: '1.45' }),
      svg('path', { class: 'dh-beak', d: 'M4.3 -1.75 6.3 -1.2 4.3 -0.8Z' }),
      svg('circle', { class: 'dh-eye', cx: '3.5', cy: '-1.9', r: '0.33' }),
    ),
  );
}

function scenery(): SVGElement[] {
  return [
    svg('rect', { class: 'dh-sky', x: '0', y: '0', width: String(FIELD_W), height: '62.5' }),
    svg('circle', { class: 'dh-sun', cx: '84', cy: '11', r: '5' }),
    svg('ellipse', { class: 'dh-cloud', cx: '22', cy: '12', rx: '9', ry: '2.6' }),
    svg('ellipse', { class: 'dh-cloud', cx: '28', cy: '10.5', rx: '5', ry: '2.4' }),
    svg('ellipse', { class: 'dh-cloud', cx: '62', cy: '20', rx: '7', ry: '2' }),
    svg('path', {
      class: 'dh-hills',
      d: `M0 46C12 38 22 40 32 44C44 36 58 37 70 43C80 38 92 39 ${FIELD_W} 42V${GROUND_Y}H0Z`,
    }),
  ];
}

function foreground(): SVGElement[] {
  const blades: string[] = [];
  for (let x = 0; x <= FIELD_W; x += 2.5) {
    blades.push(`L${x + 1.25} ${GROUND_Y - 2.2 - (x % 5 === 0 ? 1 : 0)} L${x + 2.5} ${GROUND_Y}`);
  }
  return [
    svg('rect', { class: 'dh-trunk', x: '8.4', y: '33', width: '2.2', height: '20' }),
    svg('circle', { class: 'dh-tree', cx: '9.5', cy: '30', r: '6.5' }),
    svg('circle', { class: 'dh-tree', cx: '5.5', cy: '35', r: '4.5' }),
    svg('circle', { class: 'dh-tree', cx: '13.5', cy: '35', r: '4.5' }),
    svg('path', { class: 'dh-grass', d: `M0 ${GROUND_Y} ${blades.join(' ')} V${FIELD_H} H0Z` }),
  ];
}

function crosshair(): SVGGElement {
  return svg(
    'g',
    { class: 'dh-cross', 'aria-hidden': 'true' },
    svg('circle', { cx: '0', cy: '0', r: '2.6' }),
    svg('path', { d: 'M-4.2 0H-1.4M1.4 0H4.2M0 -4.2V-1.4M0 1.4V4.2' }),
  );
}

export function createDuckView(ctx: ViewContext<DuckMove>): GameView<DuckView> {
  const me: PlayerSlot = ctx.localPlayers[0] ?? 'A';
  const opp = otherPlayer(me);
  const timers: TimerHandle[] = [];
  const keys = new Set<string>();
  let phase: Phase = 'waiting';
  let countdown = 3;
  let goAt = 0;
  let reloadUntil = 0;
  let lastFrame = 0;
  let raf = 0;
  let aim = { x: FIELD_W / 2, y: GROUND_Y / 2 };
  let latest: DuckView | null = null;
  let canAct: readonly PlayerSlot[] = [];
  let outcome: Outcome | null = null;
  let seenOwners: readonly (PlayerSlot | null)[] = [];

  const live = h('p', { class: 'sr-only', 'aria-live': 'assertive' });
  const myScore = h('strong', { class: 'dh-score-value' }, t.ducks(0));
  const oppScore = h('strong', { class: 'dh-score-value' }, t.ducks(0));
  const clockEl = h('span', { class: 'dh-clock' }, t.getReady);
  const hud = h(
    'div',
    { class: 'dh-hud' },
    h(
      'span',
      { class: `dh-score dh-score--${me.toLowerCase()}` },
      h('span', { class: 'dh-score-name' }, t.you),
      myScore,
    ),
    clockEl,
    h(
      'span',
      { class: `dh-score dh-score--${opp.toLowerCase()}` },
      h('span', { class: 'dh-score-name' }, ctx.names[opp]),
      oppScore,
    ),
  );

  const duckLayer = svg('g', { class: 'dh-ducks' });
  const markLayer = svg('g', { class: 'dh-marks' });
  const cross = crosshair();
  const scene = svg(
    'svg',
    {
      class: 'dh-scene',
      viewBox: `0 0 ${FIELD_W} ${FIELD_H}`,
      role: 'img',
      'aria-label': t.scene,
      focusable: 'false',
    },
    ...scenery(),
    duckLayer,
    ...foreground(),
    markLayer,
    cross,
  );
  const banner = h('div', { class: 'dh-banner' }, '3');
  const arena = h(
    'div',
    {
      class: 'dh',
      tabindex: '0',
      onpointerdown: (event: PointerEvent) => {
        event.preventDefault();
        arena.focus({ preventScroll: true });
        const point = toField(event);
        aim = point;
        fire(point.x, point.y);
      },
      onpointermove: (event: PointerEvent) => {
        aim = toField(event);
      },
    },
    scene,
    banner,
  );
  ctx.root.append(hud, arena, live);

  let duckEls: SVGGElement[] = [];

  function toField(event: PointerEvent): { x: number; y: number } {
    const rect = scene.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * FIELD_W;
    const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * FIELD_H;
    return { x: clamp(x, 0, FIELD_W), y: clamp(y, 0, FIELD_H) };
  }

  function elapsed(): number {
    return ctx.clock.now() - goAt;
  }

  function fire(x: number, y: number): void {
    if (phase !== 'live' || !latest || !canAct.includes(me)) return;
    const now = ctx.clock.now();
    if (now < reloadUntil) return;
    const time = Math.round(now - goAt);
    if (time < 0 || time > DURATION_MS) return;
    const sx = r2(x);
    const sy = r2(y);
    const duck = findTarget(latest, me, time, sx, sy);
    if (duck === null) {
      reloadUntil = now + RELOAD_MS;
      arena.classList.add('is-reloading');
      timers.push(ctx.clock.setTimeout(() => arena.classList.remove('is-reloading'), RELOAD_MS));
      mark(sx, sy, 'miss');
      ctx.sfx.play('click');
      return;
    }
    ctx.sfx.play('signal');
    ctx.sfx.vibrate(40);
    ctx.submit(me, { kind: 'shot', duck, t: time, x: sx, y: sy });
  }

  /** Krátká značka výstřelu (minutí nebo zásah soupeře) – po chvíli zmizí. */
  function mark(x: number, y: number, kind: 'miss' | 'opp'): void {
    const el = svg(
      'g',
      { class: `dh-mark dh-mark--${kind}`, transform: `translate(${x} ${y})` },
      kind === 'miss'
        ? svg('circle', { cx: '0', cy: '0', r: '1.6' })
        : svg('path', { d: 'M-1.6 -1.6 1.6 1.6M1.6 -1.6 -1.6 1.6' }),
    );
    markLayer.append(el);
    timers.push(ctx.clock.setTimeout(() => el.remove(), 600));
  }

  function onKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code in ARROWS) {
      event.preventDefault();
      keys.add(event.code);
      return;
    }
    if (event.repeat) return;
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      fire(aim.x, aim.y);
    }
  }
  function onKeyUp(event: KeyboardEvent): void {
    keys.delete(event.code);
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  function begin(): void {
    phase = 'countdown';
    for (const step of [1, 2]) {
      timers.push(
        ctx.clock.setTimeout(() => {
          countdown = 3 - step;
          setText(banner, String(countdown));
          ctx.sfx.play('tick');
        }, step * 1000),
      );
    }
    timers.push(ctx.clock.setTimeout(go, COUNTDOWN_MS));
    timers.push(ctx.clock.setTimeout(stop, COUNTDOWN_MS + DURATION_MS));
    ctx.sfx.play('tick');
    raf = requestAnimationFrame(frame);
  }

  function go(): void {
    if (outcome) return;
    phase = 'live';
    goAt = ctx.clock.now();
    arena.classList.add('is-live');
    banner.hidden = true;
    live.textContent = t.goLive;
    ctx.sfx.play('signal');
  }

  function stop(): void {
    if (phase === 'done') return;
    phase = 'done';
    arena.classList.remove('is-live');
    if (canAct.includes(me)) ctx.submit(me, { kind: 'done' });
    update();
  }

  function frame(): void {
    raf = 0;
    const now = ctx.clock.now();
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    let dx = 0;
    let dy = 0;
    for (const code of keys) {
      const dir = ARROWS[code];
      if (dir) {
        dx += dir[0];
        dy += dir[1];
      }
    }
    if (dx || dy) {
      aim = {
        x: clamp(aim.x + dx * AIM_SPEED * dt, 0, FIELD_W),
        y: clamp(aim.y + dy * AIM_SPEED * dt, 0, FIELD_H),
      };
    }
    cross.setAttribute('transform', `translate(${r2(aim.x)} ${r2(aim.y)})`);
    drawDucks();
    if (phase === 'live') {
      const left = Math.max(0, Math.ceil((DURATION_MS - elapsed()) / 1000));
      setText(clockEl, now < reloadUntil ? t.reloading : t.timeLeft(left));
    }
    // Po konci ještě chvíli – ať dopadnou poslední sestřelené kachny.
    if (phase !== 'done' || elapsed() < DURATION_MS + 2000) raf = requestAnimationFrame(frame);
  }

  function drawDucks(): void {
    if (!latest) return;
    const view = latest;
    if (duckEls.length !== view.ducks.length) {
      duckEls = view.ducks.map(() => duckShape());
      duckLayer.replaceChildren(...duckEls);
    }
    const time = phase === 'waiting' || phase === 'countdown' ? -1 : elapsed();
    view.ducks.forEach((duck, index) => {
      const el = duckEls[index];
      if (!el) return;
      const owner = view.owners[index] ?? null;
      const shot = owner ? view.shots[owner].find((s) => s.duck === index) : undefined;
      if (owner && shot) {
        const fall = Math.max(0, time - shot.t) / 1000;
        const y = shot.y + 0.5 * FALL_G * fall * fall;
        const visible = y < GROUND_Y + 6;
        el.style.display = visible ? '' : 'none';
        el.setAttribute('class', `dh-duck is-down is-down--${owner.toLowerCase()}`);
        el.setAttribute('transform', `translate(${shot.x} ${r2(y)}) rotate(90)`);
        return;
      }
      const at = time < 0 ? null : duckAt(duck, time);
      if (!at) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      const flap = !ctx.prefs.reducedMotion && Math.floor(time / 130) % 2 === 0;
      el.setAttribute('class', `dh-duck${flap ? ' is-flap' : ''}`);
      el.setAttribute(
        'transform',
        `translate(${r2(at.x)} ${r2(at.y)}) scale(${duckHeading(duck, time)} 1)`,
      );
    });
  }

  function update(): void {
    if (!latest) return;
    const view = latest;
    setText(myScore, t.ducks(view.score[me].hits));
    setText(oppScore, t.ducks(view.score[opp].hits));
    // Nové zásahy: soupeřovy označit, vlastní ohlásit čtečce.
    view.owners.forEach((owner, index) => {
      const before = seenOwners[index] ?? null;
      if (owner === before) return;
      if (owner === opp) {
        const shot = view.shots[opp].find((s) => s.duck === index);
        if (shot) mark(shot.x, shot.y, 'opp');
        if (before === me) live.textContent = t.lostLive;
      } else if (owner === me) {
        live.textContent = t.hitLive(view.score[me].hits);
      }
    });
    seenOwners = view.owners;

    if (outcome) {
      phase = 'done';
      banner.hidden = false;
      const tie = view.score.A.hits === view.score.B.hits && outcome.kind === 'win';
      const text = outcome.kind === 'draw' ? t.draw : t.winner(ctx.names[outcome.winner]);
      banner.replaceChildren(h('span', null, text), tie ? h('small', null, t.tieBreak) : '');
      arena.classList.add('is-finished');
      live.textContent = text;
      setText(clockEl, '');
    } else if (phase === 'done') {
      banner.hidden = false;
      banner.replaceChildren(h('small', null, t.waiting));
      setText(clockEl, '');
    }
    if (raf === 0) raf = requestAnimationFrame(frame);
  }

  return {
    render(view, f) {
      latest = view;
      canAct = f.canAct;
      outcome = f.finished;
      if (phase === 'waiting') {
        arena.focus({ preventScroll: true });
        begin();
      }
      update();
    },
    destroy() {
      for (const handle of timers) ctx.clock.clearTimeout(handle);
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      hud.remove();
      arena.remove();
      live.remove();
    },
  };
}
