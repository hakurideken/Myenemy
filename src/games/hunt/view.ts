import type { FogKnowledge, GameView, RenderFrame, ViewContext } from '../../core/MiniGame';
import { otherPlayer, type PlayerSlot } from '../../core/types';
import { translations } from '../../i18n';
import { h, setText, svg } from '../../ui/dom';
import { outcomeMessage, turnMessage } from '../shared/board';
import {
  cellName,
  COLUMN_LABELS,
  parseLabel,
  playerOf,
  positionOf,
  reachablePaths,
  roleOf,
  ROUNDS,
  SIGHT,
  SIZE,
  visibleCells,
  type HalfResult,
  type HuntMove,
  type HuntPrivate,
  type HuntView,
  type Role,
} from './logic';

const t = translations(
  {
    forest: 'Les',
    role: { hunter: 'lovec', fox: 'liška' },
    terrain: { '.': 'tráva', T: 'strom', B: 'keř' },
    half: (half: number, round: number) => `${half + 1}. poločas · kolo ${round}/${ROUNDS}`,
    youAre: (role: string) => `Jsi ${role}`,
    stay: 'Zůstat na místě',
    startHalf: 'Začít 2. poločas',
    legend: 'Tmavá pole nevidíš · stopa = liška tudy šla · slabě = kde byl soupeř naposledy',
    me: 'ty',
    them: (role: string) => role,
    lastSeen: (role: string, moves: number) =>
      `${role} tu byl${role === 'liška' ? 'a' : ''} naposledy před ${moves} ${moves === 1 ? 'tahem' : 'tahy'}`,
    startedHere: (role: string) => `tady ${role} začínal${role === 'liška' ? 'a' : ''}`,
    track: 'stopa lišky',
    trailMe: 'tvoje trasa',
    trailThem: 'trasa soupeře',
    catchCell: 'tady byla liška chycena',
    reach: 'můžeš sem jít',
    dark: 'nevidíš sem',
    yourMoveFox: 'Jsi liška – utíkej a schovávej se! Jdi o 1 pole (i šikmo), nebo zůstaň.',
    yourMoveHunter: 'Jsi lovec – jdi až o 2 pole rovně.',
    foxSpotted: (cell: string) => `Vidíš lišku na ${cell}! `,
    tracksSpotted: (cells: string) => `Stopy lišky: ${cells}. `,
    hunterSpotted: (cell: string) => `Pozor, lovec je na ${cell}! `,
    working: 'Zjišťuji, kdo koho vidí…',
    caughtAt: (cell: string) => `Liška chycena na ${cell}! `,
    halfCaught: (name: string, round: number) => `Lovec ${name} chytil lišku v ${round}. kole.`,
    halfEscaped: (name: string) => `Lovci ${name} liška unikla.`,
    breakTitle: '1. poločas skončil. ',
    pressStart: 'Až budeš připraven(a), začni 2. poločas.',
    waitStart: (name: string) => `Čekám, až ${name} začne 2. poločas.`,
    mustBeat: (name: string, round: number) =>
      `Cíl: ${name} musí lišku chytit nejpozději v ${round}. kole.`,
    anyCatch: (name: string) => `Cíl: ${name} vyhraje, když lišku vůbec chytí.`,
    waitingTrail: 'Ověřuji trasu soupeře…',
  },
  {
    forest: 'Forest',
    role: { hunter: 'hunter', fox: 'fox' },
    terrain: { '.': 'grass', T: 'tree', B: 'bush' },
    half: (half: number, round: number) =>
      `${half === 0 ? '1st' : '2nd'} half · round ${round}/${ROUNDS}`,
    youAre: (role: string) => `You are the ${role}`,
    stay: 'Stay put',
    startHalf: 'Start the 2nd half',
    legend:
      'Dark cells are out of sight · track = the fox went this way · faint = last known position',
    me: 'you',
    them: (role: string) => role,
    lastSeen: (role: string, moves: number) =>
      `the ${role} was last seen here ${moves} ${moves === 1 ? 'move' : 'moves'} ago`,
    startedHere: (role: string) => `the ${role} started here`,
    track: 'fox track',
    trailMe: 'your route',
    trailThem: "opponent's route",
    catchCell: 'the fox was caught here',
    reach: 'you can move here',
    dark: 'out of sight',
    yourMoveFox: 'You are the fox – run and hide! Move 1 cell (diagonally too) or stay.',
    yourMoveHunter: 'You are the hunter – move up to 2 cells straight.',
    foxSpotted: (cell: string) => `You see the fox at ${cell}! `,
    tracksSpotted: (cells: string) => `Fox tracks: ${cells}. `,
    hunterSpotted: (cell: string) => `Watch out, the hunter is at ${cell}! `,
    working: 'Working out who sees whom…',
    caughtAt: (cell: string) => `The fox was caught at ${cell}! `,
    halfCaught: (name: string, round: number) => `Hunter ${name} caught the fox in round ${round}.`,
    halfEscaped: (name: string) => `The fox escaped hunter ${name}.`,
    breakTitle: 'The 1st half is over. ',
    pressStart: 'Start the 2nd half when you are ready.',
    waitStart: (name: string) => `Waiting for ${name} to start the 2nd half.`,
    mustBeat: (name: string, round: number) =>
      `Goal: ${name} must catch the fox by round ${round}.`,
    anyCatch: (name: string) => `Goal: ${name} wins by catching the fox at all.`,
    waitingTrail: "Checking the opponent's route…",
  },
);

const ROLE_NAME: Record<Role, string> = t.role;

// ---------- Ikony ----------

function figure(role: Role, player: PlayerSlot, faded = false): SVGSVGElement {
  const attrs = {
    viewBox: '0 0 40 40',
    class: `hn-figure hn-figure--${player.toLowerCase()}${faded ? ' is-faded' : ''}`,
    'aria-hidden': 'true',
  };
  if (role === 'fox') {
    return svg(
      'svg',
      attrs,
      svg('path', { d: 'M7 8 15 17h10l8-9-1 16c-3 7-7 10-12 10S11 31 8 24Z' }),
      svg('circle', { cx: '15', cy: '23', r: '2', class: 'hn-eye' }),
      svg('circle', { cx: '25', cy: '23', r: '2', class: 'hn-eye' }),
    );
  }
  return svg(
    'svg',
    attrs,
    svg('circle', { cx: '20', cy: '20', r: '12', class: 'hn-ring' }),
    svg('path', { d: 'M20 4v10M20 26v10M4 20h10M26 20h10', class: 'hn-cross' }),
    svg('circle', { cx: '20', cy: '20', r: '3' }),
  );
}

function paw(): SVGSVGElement {
  return svg(
    'svg',
    { viewBox: '0 0 40 40', class: 'hn-paw', 'aria-hidden': 'true' },
    svg('ellipse', { cx: '20', cy: '25', rx: '7', ry: '6' }),
    svg('circle', { cx: '11', cy: '16', r: '3' }),
    svg('circle', { cx: '20', cy: '12', r: '3' }),
    svg('circle', { cx: '29', cy: '16', r: '3' }),
  );
}

// ---------- Co hráč ví ----------

interface Known {
  /** Kde soupeř právě je (viděn po posledním tahu). */
  readonly seen: number | null;
  /** Kde byl naposledy viděn a před kolika jeho tahy. */
  readonly last: { readonly cell: number; readonly moves: number; readonly start: boolean } | null;
  readonly tracks: readonly number[];
}

function known(view: HuntView, me: PlayerSlot, fog: FogKnowledge): Known {
  const them = otherPlayer(me);
  const kind = roleOf(view, me) === 'hunter' ? 'F' : 'H';
  const sightings = fog.sightings.filter((s) => s.segment === view.half);
  const latest = sightings.at(-1);
  const labels = latest ? latest.seen.map(parseLabel) : [];
  const seen = labels.find((l) => l.kind === kind)?.cell ?? null;
  let last: Known['last'] = null;
  let moves = 0;
  for (let i = sightings.length - 1; i >= 0 && seen === null; i--) {
    const s = sightings[i];
    if (!s) break;
    const spotted = s.seen.map(parseLabel).find((l) => l.kind === kind);
    if (spotted && spotted.cell !== null) {
      last = { cell: spotted.cell, moves, start: false };
      break;
    }
    if (s.mover === them) moves++;
  }
  // Nikdy neviděn: aspoň kde začínal (start je veřejný).
  if (seen === null && last === null) {
    last = { cell: view.starts[roleOf(view, them)], moves, start: true };
  }
  const tracks = labels.flatMap((l) => (l.kind === 'T' && l.cell !== null ? [l.cell] : []));
  return { seen, last, tracks };
}

/** Kudy vedla vlastní trasa v úseku (poslední pozorování nese stav na konci úseku). */
function ownTrail(fog: FogKnowledge, segment: number): readonly number[] {
  const last = fog.sightings.filter((s) => s.segment === segment).at(-1);
  return last ? (last.own as HuntPrivate).path : [];
}

// ---------- Pohled ----------

export function createHuntView(ctx: ViewContext<HuntMove>): GameView<HuntView> {
  let frame: RenderFrame | null = null;
  let latest: HuntView | null = null;
  let focusCell = 0;
  let wasSeen = false;

  const status = h('p', { class: 'board-status', 'aria-live': 'polite' });
  const info = h('p', { class: 'hn-info' });
  const goal = h('p', { class: 'hn-goal' });
  const grid = h('div', { class: 'hn-grid', role: 'group', 'aria-label': t.forest });
  const cells: HTMLButtonElement[] = [];
  grid.append(h('span', { class: 'hn-corner', 'aria-hidden': 'true' }));
  for (const letter of COLUMN_LABELS) {
    grid.append(h('span', { class: 'hn-label', 'aria-hidden': 'true' }, letter));
  }
  for (let r = 0; r < SIZE; r++) {
    grid.append(h('span', { class: 'hn-label', 'aria-hidden': 'true' }, r + 1));
    for (let c = 0; c < SIZE; c++) {
      const cell = r * SIZE + c;
      const button = h('button', {
        type: 'button',
        class: 'hn-cell',
        tabindex: cell === 0 ? '0' : '-1',
        onclick: () => moveTo(cell),
        onfocus: () => (focusCell = cell),
      });
      cells.push(button);
      grid.append(button);
    }
  }
  grid.addEventListener('keydown', (event: KeyboardEvent) => {
    const moves: Partial<Record<string, [number, number]>> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    const r = Math.min(SIZE - 1, Math.max(0, Math.floor(focusCell / SIZE) + delta[0]));
    const c = Math.min(SIZE - 1, Math.max(0, (focusCell % SIZE) + delta[1]));
    cells[focusCell]?.setAttribute('tabindex', '-1');
    focusCell = r * SIZE + c;
    cells[focusCell]?.setAttribute('tabindex', '0');
    cells[focusCell]?.focus();
  });

  const stayButton = h('button', { type: 'button', class: 'btn', onclick: () => stay() }, t.stay);
  const startButton = h(
    'button',
    { type: 'button', class: 'btn btn-primary', onclick: () => startHalf() },
    t.startHalf,
  );
  const actions = h('div', { class: 'hn-actions' }, stayButton, startButton);
  const legend = h('p', { class: 'hn-legend' }, t.legend);
  const container = h('div', { class: 'board-game hn' }, status, info, grid, actions, goal, legend);
  ctx.root.append(container);

  const me = (): PlayerSlot => frame?.perspective ?? 'A';
  const own = (): HuntPrivate | null => {
    const fog = frame?.fog;
    const pv = fog?.own as HuntPrivate | undefined;
    return pv && latest && pv.half === latest.half ? pv : null;
  };
  const canMove = (): boolean =>
    frame !== null &&
    latest !== null &&
    frame.finished === null &&
    latest.phase === 'play' &&
    !latest.report &&
    frame.canAct.includes(frame.perspective) &&
    own() !== null;

  function options(): Map<number, number[]> {
    const pv = own();
    const out = new Map<number, number[]>();
    if (!pv || !latest) return out;
    const pos = positionOf(pv);
    for (const path of reachablePaths(latest.terrain, pos, pv.role)) {
      const dest = path.at(-1) ?? pos;
      const current = out.get(dest);
      // Mezi stejně dlouhými cestami raději přes keř (tam se liška ráda schovává).
      const better =
        !current ||
        path.length < current.length ||
        (path.length === current.length &&
          path.some((cell) => latest?.terrain[cell] === 'B') &&
          !current.some((cell) => latest?.terrain[cell] === 'B'));
      if (better) out.set(dest, path);
    }
    return out;
  }

  function moveTo(cell: number): void {
    if (!canMove() || !frame) return;
    const path = options().get(cell);
    if (!path) {
      ctx.sfx.play('tick');
      return;
    }
    ctx.sfx.play('click');
    ctx.submit(frame.perspective, { kind: 'move', path });
  }

  function stay(): void {
    if (!canMove() || !frame) return;
    ctx.sfx.play('click');
    ctx.submit(frame.perspective, { kind: 'move', path: [] });
  }

  function startHalf(): void {
    if (!frame || !latest || latest.phase !== 'break') return;
    if (!frame.canAct.includes(frame.perspective)) return;
    ctx.sfx.play('click');
    ctx.submit(frame.perspective, { kind: 'start' });
  }

  function halfText(result: HalfResult): string {
    return result.caught === null
      ? t.halfEscaped(ctx.names[result.hunter])
      : t.halfCaught(ctx.names[result.hunter], result.caught);
  }

  /** Po poločase (přestávka, konec): obě trasy, místo chycení, bez mlhy. */
  function renderReview(view: HuntView, fog: FogKnowledge | null, segment: number): void {
    const mine = fog ? ownTrail(fog, segment) : [];
    const theirs = (fog?.revealed.get(segment) as HuntPrivate | undefined)?.path ?? [];
    const result = view.halves[segment];
    const mineRole = segment === view.half ? roleOf(view, me()) : otherRole(roleOf(view, me()));
    cells.forEach((button, cell) => {
      const parts: string[] = [];
      const content: (SVGSVGElement | HTMLElement)[] = [];
      const isMine = mine.includes(cell);
      const isTheirs = theirs.includes(cell);
      if (isMine) parts.push(t.trailMe);
      if (isTheirs) parts.push(t.trailThem);
      if (result?.cell === cell) parts.push(t.catchCell);
      if (cell === mine.at(-1)) content.push(figure(mineRole, me()));
      if (cell === theirs.at(-1)) content.push(figure(otherRole(mineRole), otherPlayer(me())));
      paint(button, cell, view.terrain, content, parts, {
        'is-trail-me': isMine,
        'is-trail-them': isTheirs,
        'is-catch': result?.cell === cell,
      });
    });
    grid.classList.remove('is-active');
  }

  function renderPlay(view: HuntView, f: RenderFrame): void {
    const pv = own();
    const fog = f.fog;
    const mine = me();
    const role = roleOf(view, mine);
    const info = pv && fog ? known(view, mine, fog) : { seen: null, last: null, tracks: [] };
    const pos = pv ? positionOf(pv) : null;
    const sight = new Set(pos === null ? [] : visibleCells(view.terrain, pos, SIGHT[role]));
    const reach = canMove() ? options() : new Map<number, number[]>();
    const them = otherPlayer(mine);
    const theirRole = otherRole(role);
    cells.forEach((button, cell) => {
      const parts: string[] = [];
      const content: (SVGSVGElement | HTMLElement)[] = [];
      if (cell === pos) {
        content.push(figure(role, mine));
        parts.push(t.me);
      }
      if (cell === info.seen) {
        content.push(figure(theirRole, them));
        parts.push(t.them(ROLE_NAME[theirRole]));
      } else if (cell === info.last?.cell) {
        content.push(figure(theirRole, them, true));
        parts.push(
          info.last.start
            ? t.startedHere(ROLE_NAME[theirRole])
            : t.lastSeen(ROLE_NAME[theirRole], info.last.moves),
        );
      }
      if (info.tracks.includes(cell)) {
        content.push(paw());
        parts.push(t.track);
      }
      if (reach.has(cell)) parts.push(t.reach);
      const dark = pos !== null && !sight.has(cell);
      if (dark) parts.push(t.dark);
      paint(button, cell, view.terrain, content, parts, {
        'is-dark': dark,
        'is-reach': reach.has(cell),
      });
    });
    grid.classList.toggle('is-active', reach.size > 0);

    const seenNow = info.seen !== null;
    if (seenNow && !wasSeen) ctx.sfx.play('signal');
    wasSeen = seenNow;
  }

  function statusText(view: HuntView, f: RenderFrame): string {
    const mine = me();
    const role = roleOf(view, mine);
    const fog = f.fog;
    const info = fog && own() ? known(view, mine, fog) : null;
    let spotted = '';
    if (info?.seen != null) {
      spotted =
        role === 'hunter'
          ? t.foxSpotted(cellName(info.seen))
          : t.hunterSpotted(cellName(info.seen));
    } else if (info && info.tracks.length > 0) {
      spotted = t.tracksSpotted(info.tracks.map(cellName).join(', '));
    }
    if (f.finished) {
      const last = view.halves.at(-1);
      const caught = last?.cell != null ? t.caughtAt(cellName(last.cell)) : '';
      return `${caught}${outcomeMessage(ctx, f.finished)}`;
    }
    if (view.phase === 'break') {
      const first = view.halves[0];
      const starter = playerOf(view, 'fox');
      const wait = f.canAct.includes(mine) ? t.pressStart : t.waitStart(ctx.names[starter]);
      return `${t.breakTitle}${first ? halfText(first) : ''} ${wait}`;
    }
    const mover = playerOf(view, view.turn);
    if (canMove()) return `${spotted}${role === 'hunter' ? t.yourMoveHunter : t.yourMoveFox}`;
    if (ctx.mode === 'online' && mover === mine && !view.report) return t.working;
    return `${spotted}${turnMessage(ctx, mover, f)}`;
  }

  function goalText(view: HuntView): string {
    const first = view.halves[0];
    if (!first) return '';
    const second = otherPlayer(first.hunter);
    return first.caught === null
      ? t.anyCatch(ctx.names[second])
      : t.mustBeat(ctx.names[second], first.caught);
  }

  return {
    render(view, f) {
      latest = view;
      frame = f;
      const mine = me();
      const roleText = ROLE_NAME[roleOf(view, mine)];
      setText(info, `${t.half(view.half, view.round)} · ${t.youAre(roleText)}`);
      const review = view.phase === 'break' || f.finished !== null;
      if (review) {
        const segment = view.phase === 'break' ? 0 : view.half;
        renderReview(view, f.fog, segment);
        const revealed = f.fog?.revealed.has(segment) ?? false;
        legend.textContent = revealed ? `${t.trailMe} · ${t.trailThem}` : t.waitingTrail;
      } else {
        renderPlay(view, f);
        legend.textContent = t.legend;
      }
      stayButton.hidden = review;
      stayButton.disabled = !canMove();
      startButton.hidden = view.phase !== 'break' || f.finished !== null;
      startButton.disabled = !f.canAct.includes(mine);
      setText(goal, view.half === 1 || view.phase === 'break' ? goalText(view) : '');
      setText(status, statusText(view, f));
    },
    destroy() {
      container.remove();
    },
  };
}

const otherRole = (role: Role): Role => (role === 'hunter' ? 'fox' : 'hunter');

function paint(
  button: HTMLButtonElement,
  cell: number,
  terrain: string,
  content: readonly (SVGSVGElement | HTMLElement)[],
  parts: readonly string[],
  flags: Readonly<Record<string, boolean>>,
): void {
  const kind = (terrain[cell] ?? '.') as keyof typeof TERRAIN_TEXT;
  button.dataset.terrain = kind === 'T' ? 'tree' : kind === 'B' ? 'bush' : 'grass';
  button.replaceChildren(...content);
  for (const [name, on] of Object.entries(flags)) button.classList.toggle(name, on);
  for (const name of ['is-dark', 'is-reach', 'is-trail-me', 'is-trail-them', 'is-catch']) {
    if (!(name in flags)) button.classList.remove(name);
  }
  const extra = parts.length > 0 ? `, ${parts.join(', ')}` : '';
  button.setAttribute('aria-label', `${cellName(cell)}: ${TERRAIN_TEXT[kind]}${extra}`);
}

const TERRAIN_TEXT: Record<'.' | 'T' | 'B', string> = t.terrain;
