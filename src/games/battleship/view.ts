import type { GameView, RenderFrame, ViewContext } from '../../core/MiniGame';
import { otherPlayer, type PerPlayer, type PlayerSlot } from '../../core/types';
import { createRng, randomSeed } from '../../core/util/rng';
import { translations } from '../../i18n';
import { h, setText, svg } from '../../ui/dom';
import { outcomeMessage, turnMessage } from '../shared/board';
import { seaKnowledge } from './ai';
import {
  canPlace,
  cellName,
  colOf,
  COLUMN_LABELS,
  FLEET,
  fleetCells,
  randomFleet,
  rowOf,
  shipCells,
  SIZE,
  sunkShipCells,
  type BattleshipMove,
  type BattleshipView,
  type Fleet,
  type Ship,
  type Shot,
} from './logic';

type CellState = 'sea' | 'ship' | 'miss' | 'water' | 'hit' | 'sunk' | 'pending';

const t = translations(
  {
    shipName: { 4: 'Bitevní loď', 3: 'Křižník', 2: 'Torpédoborec' },
    ship: 'Loď',
    state: {
      sea: 'neznámé',
      ship: 'loď',
      miss: 'vedle',
      water: 'jistě voda',
      hit: 'zásah',
      sunk: 'potopeno',
      pending: 'čeká na odpověď',
    },
    opponentFleet: 'Soupeřova flotila',
    shipSunk: 'potopena',
    shipAfloat: 'pluje',
    opponentSea: 'Soupeřovo moře',
    yourSea: 'Tvoje moře',
    seaOf: (name: string) => `Moře: ${name}`,
    firingAt: (name: string) => `Střílíš na: ${name}`,
    rotate: 'Otočit (R)',
    random: 'Náhodně',
    clear: 'Vymazat',
    done: 'Hotovo',
    shipsToPlace: 'Lodě k rozmístění',
    sendingHash: 'Odesílám otisk rozmístění…',
    placeShip: (name: string, horizontal: boolean) =>
      `Rozmísti flotilu: ${name}, ${horizontal ? 'vodorovně' : 'svisle'}`,
    fleetComplete: 'Flotila je rozmístěná – potvrď tlačítkem Hotovo.',
    pickShip: 'Vyber loď k rozmístění.',
    you: 'Ty',
    miss: (who: string, where: string) => `${who}: ${where} – vedle. `,
    hit: (who: string, where: string) => `${who}: ${where} – zásah! `,
    sunk: (who: string, where: string, ship: string) => `${who}: ${where} – potopeno (${ship})! `,
    yourShip: ', tvoje loď',
    waitingForOpponent: 'Flotila je rozmístěná. Čekám na soupeře…',
    firing: (name: string, cell: string) => `${name} střílí na ${cell}…`,
  },
  {
    shipName: { 4: 'Battleship', 3: 'Cruiser', 2: 'Destroyer' },
    ship: 'Ship',
    state: {
      sea: 'unknown',
      ship: 'ship',
      miss: 'miss',
      water: 'certainly water',
      hit: 'hit',
      sunk: 'sunk',
      pending: 'awaiting answer',
    },
    opponentFleet: "Opponent's fleet",
    shipSunk: 'sunk',
    shipAfloat: 'afloat',
    opponentSea: "Opponent's sea",
    yourSea: 'Your sea',
    seaOf: (name: string) => `Sea: ${name}`,
    firingAt: (name: string) => `Firing at: ${name}`,
    rotate: 'Rotate (R)',
    random: 'Random',
    clear: 'Clear',
    done: 'Done',
    shipsToPlace: 'Ships to place',
    sendingHash: 'Sending the placement hash…',
    placeShip: (name: string, horizontal: boolean) =>
      `Place your fleet: ${name}, ${horizontal ? 'horizontal' : 'vertical'}`,
    fleetComplete: 'Fleet placed – confirm with Done.',
    pickShip: 'Pick a ship to place.',
    you: 'You',
    miss: (who: string, where: string) => `${who}: ${where} – miss. `,
    hit: (who: string, where: string) => `${who}: ${where} – hit! `,
    sunk: (who: string, where: string, ship: string) => `${who}: ${where} – sunk (${ship})! `,
    yourShip: ', your ship',
    waitingForOpponent: 'Fleet placed. Waiting for the opponent…',
    firing: (name: string, cell: string) => `${name} fires at ${cell}…`,
  },
);

export const SHIP_NAME: Record<number, string> = t.shipName;
export const shipLabel = (length: number): string => `${SHIP_NAME[length] ?? t.ship} (${length})`;

const STATE_TEXT: Record<CellState, string> = t.state;

function marker(state: CellState): SVGSVGElement | null {
  const attrs = { viewBox: '0 0 20 20', class: 'bs-marker', 'aria-hidden': 'true' };
  if (state === 'miss') return svg('svg', attrs, svg('circle', { cx: '10', cy: '10', r: '3.2' }));
  if (state === 'hit' || state === 'sunk') {
    return svg('svg', attrs, svg('path', { d: 'M5 5 15 15M15 5 5 15' }));
  }
  if (state === 'pending') return svg('svg', attrs, svg('circle', { cx: '10', cy: '10', r: '6' }));
  return null;
}

// ---------- Mřížka moře ----------

interface Sea {
  readonly el: HTMLElement;
  readonly grid: HTMLElement;
  readonly title: HTMLElement;
  readonly cells: readonly HTMLButtonElement[];
  focusCell: number;
}

function createSea(
  label: string,
  onActivate: (cell: number) => void,
  onHover: (cell: number | null) => void,
): Sea {
  const title = h('h3', { class: 'bs-sea-title' }, label);
  // Šipky přesouvají fokus mezi poli (roving tabindex), Tab skočí z moře ven.
  const grid = h('div', { class: 'bs-grid', role: 'group', 'aria-label': label });
  const cells: HTMLButtonElement[] = [];
  const sea: Sea = {
    el: h('section', { class: 'bs-sea' }, title, grid),
    grid,
    title,
    cells,
    focusCell: 0,
  };

  grid.append(h('span', { class: 'bs-corner', 'aria-hidden': 'true' }));
  for (const letter of COLUMN_LABELS) {
    grid.append(h('span', { class: 'bs-label', 'aria-hidden': 'true' }, letter));
  }
  for (let r = 0; r < SIZE; r++) {
    grid.append(h('span', { class: 'bs-label', 'aria-hidden': 'true' }, r + 1));
    for (let c = 0; c < SIZE; c++) {
      const cell = r * SIZE + c;
      const button = h('button', {
        type: 'button',
        class: 'bs-cell',
        'data-state': '',
        'aria-label': cellName(cell),
        tabindex: cell === 0 ? '0' : '-1',
        onclick: () => onActivate(cell),
        onmouseenter: () => onHover(cell),
        onfocus: () => {
          sea.focusCell = cell;
          onHover(cell);
        },
      });
      cells.push(button);
      grid.append(button);
    }
  }
  grid.addEventListener('mouseleave', () => onHover(null));
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
    const r = Math.min(SIZE - 1, Math.max(0, rowOf(sea.focusCell) + delta[0]));
    const c = Math.min(SIZE - 1, Math.max(0, colOf(sea.focusCell) + delta[1]));
    moveFocus(sea, r * SIZE + c, true);
  });
  return sea;
}

function moveFocus(sea: Sea, cell: number, focus: boolean): void {
  sea.cells[sea.focusCell]?.setAttribute('tabindex', '-1');
  sea.focusCell = cell;
  const button = sea.cells[cell];
  button?.setAttribute('tabindex', '0');
  if (focus) button?.focus();
}

function paintCell(button: HTMLButtonElement, cell: number, state: CellState, extra = ''): void {
  if (button.dataset.state !== state) {
    button.dataset.state = state;
    button.replaceChildren(...[marker(state)].filter((m) => m !== null));
  }
  button.setAttribute('aria-label', `${cellName(cell)}: ${STATE_TEXT[state]}${extra}`);
}

/** Tvar lodi: zaoblené konce podle orientace. */
function paintShipShape(sea: Sea, cells: readonly (readonly number[])[]): void {
  for (const button of sea.cells) {
    button.classList.remove('is-bow', 'is-stern', 'is-h', 'is-v', 'is-solo');
  }
  for (const ship of cells) {
    const horizontal = ship.length > 1 && rowOf(ship[0] ?? 0) === rowOf(ship[1] ?? 0);
    ship.forEach((cell, i) => {
      const button = sea.cells[cell];
      if (!button) return;
      button.classList.add(horizontal ? 'is-h' : 'is-v');
      if (i === 0) button.classList.add('is-bow');
      if (i === ship.length - 1) button.classList.add('is-stern');
    });
  }
}

// ---------- Stav flotily ----------

function fleetStatus(): { el: HTMLElement; render(sunk: ReadonlySet<number>): void } {
  const items = FLEET.map((length) =>
    h(
      'li',
      { class: 'bs-fleet-ship' },
      h(
        'span',
        { class: 'bs-fleet-hull', 'aria-hidden': 'true' },
        Array.from({ length }, () => h('span', { class: 'bs-fleet-seg' })),
      ),
      h('span', { class: 'sr-only' }, shipLabel(length)),
    ),
  );
  const el = h('ul', { class: 'bs-fleet', 'aria-label': t.opponentFleet }, items);
  return {
    el,
    render(sunk) {
      items.forEach((item, i) => {
        const isSunk = sunk.has(i);
        item.classList.toggle('is-sunk', isSunk);
        item.setAttribute(
          'aria-label',
          `${shipLabel(FLEET[i] ?? 0)}: ${isSunk ? t.shipSunk : t.shipAfloat}`,
        );
      });
    },
  };
}

// ---------- Rozmístění ----------

interface Draft {
  ships: (Ship | null)[];
  selected: number | null;
  horizontal: boolean;
}

const emptyDraft = (): Draft => ({ ships: FLEET.map(() => null), selected: 0, horizontal: true });

function occupiedBy(draft: Draft, except: number | null): Set<number> {
  const set = new Set<number>();
  draft.ships.forEach((ship, i) => {
    if (!ship || i === except) return;
    for (const cell of shipCells(ship, FLEET[i] ?? 0) ?? []) set.add(cell);
  });
  return set;
}

function draftCells(draft: Draft): (number[] | null)[] {
  return draft.ships.map((ship, i) => (ship ? shipCells(ship, FLEET[i] ?? 0) : null));
}

export function createBattleshipView(ctx: ViewContext<BattleshipMove>): GameView<BattleshipView> {
  let frame: RenderFrame | null = null;
  let latest: BattleshipView | null = null;
  let hover: number | null = null;
  let seenShots = 0;
  const drafts: PerPlayer<Draft> = { A: emptyDraft(), B: emptyDraft() };
  const rng = createRng(randomSeed());

  const status = h('p', { class: 'board-status', 'aria-live': 'polite' });
  const target = createSea(
    t.opponentSea,
    (cell) => shoot(cell),
    () => undefined,
  );
  const own = createSea(
    t.yourSea,
    (cell) => placeAt(cell),
    (cell) => {
      hover = cell;
      if (placing()) renderPlacement();
    },
  );
  const targetFleet = fleetStatus();
  target.el.append(targetFleet.el);

  // Paleta lodí pro rozmístění.
  const paletteButtons = FLEET.map((length, i) =>
    h(
      'button',
      {
        type: 'button',
        class: 'bs-pick',
        'aria-label': shipLabel(length),
        onclick: () => select(i),
      },
      h(
        'span',
        { class: 'bs-fleet-hull', 'aria-hidden': 'true' },
        Array.from({ length }, () => h('span', { class: 'bs-fleet-seg' })),
      ),
      h('span', { class: 'bs-pick-name' }, shipLabel(length)),
    ),
  );
  const rotateButton = h(
    'button',
    { type: 'button', class: 'btn btn-ghost', onclick: () => rotate() },
    t.rotate,
  );
  const randomButton = h(
    'button',
    { type: 'button', class: 'btn btn-ghost', onclick: () => randomize() },
    t.random,
  );
  const clearButton = h(
    'button',
    { type: 'button', class: 'btn btn-ghost', onclick: () => clearDraft() },
    t.clear,
  );
  const doneButton = h(
    'button',
    { type: 'button', class: 'btn btn-primary', onclick: () => confirm() },
    t.done,
  );
  const placementPanel = h(
    'div',
    { class: 'bs-placement' },
    h(
      'ul',
      { class: 'bs-palette', 'aria-label': t.shipsToPlace },
      paletteButtons.map((b) => h('li', null, b)),
    ),
    h(
      'div',
      { class: 'bs-placement-actions' },
      rotateButton,
      randomButton,
      clearButton,
      doneButton,
    ),
  );

  const seas = h('div', { class: 'bs-seas' }, target.el, own.el);
  const container = h('div', { class: 'board-game bs' }, status, placementPanel, seas);
  ctx.root.append(container);

  const me = (): PlayerSlot => frame?.perspective ?? 'A';
  const mySecret = (): Fleet | null => (frame?.secret as Fleet | null | undefined) ?? null;
  const canAct = (): boolean =>
    frame !== null && frame.finished === null && frame.canAct.includes(frame.perspective);
  const placing = (): boolean =>
    latest !== null &&
    latest.phase === 'placing' &&
    mySecret() === null &&
    frame?.finished === null;

  // ---------- Rozmísťování ----------

  function draft(): Draft {
    return drafts[me()];
  }

  function select(index: number): void {
    if (!placing() || !canAct()) return;
    const d = draft();
    const ship = d.ships[index];
    if (ship) {
      d.horizontal = ship.horizontal;
      d.ships[index] = null;
    }
    d.selected = index;
    renderPlacement();
  }

  function rotate(): void {
    if (!placing() || !canAct()) return;
    draft().horizontal = !draft().horizontal;
    renderPlacement();
  }

  function randomize(): void {
    if (!placing() || !canAct()) return;
    const d = draft();
    d.ships = [...randomFleet(rng)];
    d.selected = null;
    renderPlacement();
  }

  function clearDraft(): void {
    if (!placing() || !canAct()) return;
    drafts[me()] = emptyDraft();
    renderPlacement();
  }

  function placeAt(cell: number): void {
    if (!placing() || !canAct()) return;
    const d = draft();
    // Klik na rozmístěnou loď ji zvedne k přesunu.
    const hit = draftCells(d).findIndex((cells) => cells?.includes(cell) ?? false);
    if (hit >= 0) {
      select(hit);
      return;
    }
    const index = d.selected;
    if (index === null) return;
    const ship = { row: rowOf(cell), col: colOf(cell), horizontal: d.horizontal };
    if (!canPlace(occupiedBy(d, index), shipCells(ship, FLEET[index] ?? 0))) {
      ctx.sfx.play('tick');
      return;
    }
    ctx.sfx.play('click');
    d.ships[index] = ship;
    const next = d.ships.findIndex((s) => s === null);
    d.selected = next >= 0 ? next : null;
    renderPlacement();
  }

  function confirm(): void {
    if (!placing() || !canAct() || !frame) return;
    const ships = draft().ships;
    if (ships.some((s) => s === null)) return;
    ctx.sfx.play('click');
    ctx.submitSecret(frame.perspective, ships);
  }

  function renderPlacement(): void {
    const d = draft();
    const interactive = canAct();
    const cells = draftCells(d);
    const occupied = new Set(cells.flatMap((c) => c ?? []));
    const index = d.selected;
    let preview: number[] = [];
    let previewOk = false;
    if (interactive && index !== null && hover !== null) {
      const ship = { row: rowOf(hover), col: colOf(hover), horizontal: d.horizontal };
      const shape = shipCells(ship, FLEET[index] ?? 0);
      previewOk = canPlace(occupiedBy(d, index), shape);
      preview = shape ?? [hover];
    }
    own.cells.forEach((button, cell) => {
      paintCell(button, cell, occupied.has(cell) ? 'ship' : 'sea');
      button.classList.toggle('is-preview', preview.includes(cell) && previewOk);
      button.classList.toggle('is-invalid', preview.includes(cell) && !previewOk);
    });
    paintShipShape(
      own,
      cells.filter((c): c is number[] => c !== null),
    );
    paletteButtons.forEach((button, i) => {
      button.classList.toggle('is-selected', d.selected === i);
      button.classList.toggle('is-placed', d.ships[i] !== null);
      button.setAttribute('aria-pressed', String(d.selected === i));
      button.disabled = !interactive;
    });
    const complete = d.ships.every((s) => s !== null);
    rotateButton.disabled = !interactive;
    randomButton.disabled = !interactive;
    clearButton.disabled = !interactive;
    doneButton.disabled = !interactive || !complete;
    own.grid.classList.toggle('is-active', interactive);
    const name = index !== null ? shipLabel(FLEET[index] ?? 0) : null;
    setText(
      status,
      !interactive
        ? t.sendingHash
        : name
          ? t.placeShip(name, d.horizontal)
          : complete
            ? t.fleetComplete
            : t.pickShip,
    );
  }

  // ---------- Bitva ----------

  function shoot(cell: number): void {
    if (!frame || !latest || !canAct() || latest.phase !== 'battle') return;
    if (latest.turn !== frame.perspective || latest.pending !== null) return;
    if (latest.shots[frame.perspective].some((s) => s.cell === cell)) {
      ctx.sfx.play('tick');
      return;
    }
    ctx.sfx.play('click');
    ctx.submit(frame.perspective, { kind: 'shot', cell });
  }

  function lastShotMessage(view: BattleshipView): string {
    const shooter = view.lastShooter;
    const shot: Shot | undefined = shooter ? view.shots[shooter].at(-1) : undefined;
    if (!shooter || !shot) return '';
    const who = ctx.localPlayers.length > 1 || shooter !== me() ? ctx.names[shooter] : t.you;
    const where = cellName(shot.cell);
    if (shot.result === 'miss') return t.miss(who, where);
    if (shot.result === 'hit') return t.hit(who, where);
    return t.sunk(who, where, shipLabel(FLEET[shot.ship ?? 0] ?? 0));
  }

  function renderBattle(view: BattleshipView, f: RenderFrame): void {
    const mine = me();
    const opp = otherPlayer(mine);
    const fleet = mySecret();
    const shipsOfMine = fleet ? (fleetCells(fleet) ?? []) : [];
    const myShipCells = new Set(shipsOfMine.flat());

    // Moje moře: moje lodě a soupeřovy výstřely.
    const incoming = view.shots[opp];
    const incomingState = new Map<number, CellState>();
    for (const s of incoming) {
      incomingState.set(s.cell, s.result === 'miss' ? 'miss' : 'hit');
      if (s.result === 'sunk') {
        for (const c of sunkShipCells(incoming, s.cell)) incomingState.set(c, 'sunk');
      }
    }
    const lastIncoming = view.lastShooter === opp ? incoming.at(-1)?.cell : undefined;
    own.cells.forEach((button, cell) => {
      let state: CellState = incomingState.get(cell) ?? (myShipCells.has(cell) ? 'ship' : 'sea');
      if (view.pending === cell && view.turn === opp) state = 'pending';
      paintCell(button, cell, state, myShipCells.has(cell) && state !== 'ship' ? t.yourShip : '');
      button.classList.toggle('has-ship', myShipCells.has(cell));
      button.classList.toggle('is-last', cell === lastIncoming);
      button.classList.remove('is-preview', 'is-invalid');
    });
    paintShipShape(own, shipsOfMine);
    own.grid.classList.remove('is-active');

    // Soupeřovo moře: moje výstřely a co z nich plyne.
    const knowledge = seaKnowledge(view.shots[mine]);
    const lastOutgoing = view.lastShooter === mine ? view.shots[mine].at(-1)?.cell : undefined;
    const aiming =
      canAct() && view.phase === 'battle' && view.turn === mine && view.pending === null;
    target.cells.forEach((button, cell) => {
      let state: CellState = 'sea';
      if (knowledge.sunk.has(cell)) state = 'sunk';
      else if (knowledge.openHits.includes(cell)) state = 'hit';
      else if (knowledge.shot.has(cell)) state = 'miss';
      else if (knowledge.water.has(cell)) state = 'water';
      if (view.pending === cell && view.turn === mine) state = 'pending';
      paintCell(button, cell, state);
      button.classList.toggle('is-last', cell === lastOutgoing);
      button.setAttribute('aria-disabled', String(!aiming || knowledge.shot.has(cell)));
    });
    target.grid.classList.toggle('is-active', aiming);
    const sunkShips = new Set(
      view.shots[mine].flatMap((s) => (s.result === 'sunk' && s.ship !== null ? [s.ship] : [])),
    );
    targetFleet.render(sunkShips);

    const local = ctx.localPlayers.length > 1;
    setText(own.title, local ? t.seaOf(ctx.names[mine]) : t.yourSea);
    setText(target.title, t.firingAt(ctx.names[opp]));

    let text: string;
    if (f.finished) text = `${lastShotMessage(view)}${outcomeMessage(ctx, f.finished)}`;
    else if (view.phase === 'placing') text = t.waitingForOpponent;
    else if (view.pending !== null) text = t.firing(ctx.names[view.turn], cellName(view.pending));
    else text = `${lastShotMessage(view)}${turnMessage(ctx, view.turn, f)}`;
    setText(status, text);
  }

  function playFeedback(view: BattleshipView): void {
    const total = view.shots.A.length + view.shots.B.length;
    if (total <= seenShots) {
      seenShots = total;
      return;
    }
    seenShots = total;
    const shooter = view.lastShooter;
    const shot = shooter ? view.shots[shooter].at(-1) : undefined;
    if (!shooter || !shot || shot.result === 'miss') return;
    ctx.sfx.play('signal');
    if (shooter !== me()) ctx.sfx.vibrate(shot.result === 'sunk' ? [60, 40, 120] : 60);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if ((event.key === 'r' || event.key === 'R') && placing()) {
      event.preventDefault();
      rotate();
    }
  }
  window.addEventListener('keydown', onKey);

  return {
    render(view, f) {
      const perspectiveChanged = frame?.perspective !== f.perspective;
      latest = view;
      frame = f;
      if (perspectiveChanged) hover = null;
      const isPlacing = placing();
      container.classList.toggle('is-placing', isPlacing);
      placementPanel.hidden = !isPlacing;
      target.el.hidden = isPlacing;
      if (isPlacing) {
        setText(own.title, ctx.localPlayers.length > 1 ? t.seaOf(ctx.names[me()]) : t.yourSea);
        renderPlacement();
      } else {
        renderBattle(view, f);
        playFeedback(view);
      }
    },
    destroy() {
      window.removeEventListener('keydown', onKey);
      container.remove();
    },
  };
}
