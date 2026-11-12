import { translations } from '../../i18n';
import {
  entrantName,
  placements,
  playerAt,
  roundKind,
  roundsOf,
  type RoundKind,
  type TournamentMatch,
  type TournamentState,
} from '../../net/tournament';
import { h, svg } from '../dom';

const t = translations(
  {
    label: 'Turnajový pavouk',
    rounds: {
      final: 'Finále',
      third: 'O 3. místo',
      semi: 'Semifinále',
      quarter: 'Čtvrtfinále',
      eighth: 'Osmifinále',
    } satisfies Record<RoundKind, string>,
    ai: 'AI',
    walkover: 'kont.',
    random: 'los',
    champion: 'Vítěz',
    waitingFinal: 'čeká na finále',
    legendWin: 'postupuje',
    legendLive: 'právě se hraje',
    legendMe: 'ty',
    watch: 'Sledovat',
  },
  {
    label: 'Tournament bracket',
    rounds: {
      final: 'Final',
      third: 'Third place',
      semi: 'Semi-finals',
      quarter: 'Quarter-finals',
      eighth: 'Round of 16',
    } satisfies Record<RoundKind, string>,
    ai: 'AI',
    walkover: 'w/o',
    random: 'draw',
    champion: 'Winner',
    waitingFinal: 'waiting for the final',
    legendWin: 'advances',
    legendLive: 'playing now',
    legendMe: 'you',
    watch: 'Watch',
  },
);

export const AI_LABEL = t.ai;

/** Rozměry pavouka (px v souřadnicích SVG). */
const BOX_W = 168;
const ROW = 26;
const COL_GAP = 40;
const PITCH = 76;
const TOP = 34;
const LEFT = 2;
const CHAMP_W = 128;

export interface BracketLayout {
  readonly width: number;
  readonly height: number;
  readonly rounds: number;
  /** Střed zápasu (svisle) a levý okraj sloupce. */
  center(round: number, idx: number): number;
  column(round: number): number;
}

/** Rozvržení pavouka pro 4 / 8 / 16 hráčů (čisté – testované). */
export function bracketLayout(size: 4 | 8 | 16): BracketLayout {
  const rounds = roundsOf(size);
  const firstRound = size / 2;
  const centers: number[][] = [
    Array.from({ length: firstRound }, (_, i) => TOP + PITCH * i + PITCH / 2),
  ];
  for (let r = 1; r < rounds; r++) {
    const prev = centers[r - 1] ?? [];
    centers.push(
      Array.from(
        { length: prev.length / 2 },
        (_, i) => ((prev[2 * i] ?? 0) + (prev[2 * i + 1] ?? 0)) / 2,
      ),
    );
  }
  const finalCenter = centers[rounds - 1]?.[0] ?? TOP;
  const thirdCenter = finalCenter + 2 * ROW + 56;
  const center = (round: number, idx: number): number =>
    round === rounds && idx === 1 ? thirdCenter : (centers[round - 1]?.[idx] ?? TOP);
  const column = (round: number): number => LEFT + (round - 1) * (BOX_W + COL_GAP);
  return {
    rounds,
    width: column(rounds) + BOX_W + COL_GAP + CHAMP_W + LEFT,
    height: Math.max(TOP + firstRound * PITCH, thirdCenter + ROW + 12) + 8,
    center,
    column,
  };
}

function scoreText(m: TournamentMatch, side: 'a' | 'b'): string {
  if (m.status !== 'done') return '';
  const slot = side === 'a' ? m.a : m.b;
  if (m.how === 'walkover') return m.winner === slot ? t.walkover : '';
  if (m.how === 'random') return m.winner === slot ? t.random : '';
  const value = side === 'a' ? m.scoreA : m.scoreB;
  return value === null ? '' : String(value);
}

function row(
  state: TournamentState,
  m: TournamentMatch,
  side: 'a' | 'b',
  x: number,
  y: number,
  firstRound: boolean,
): SVGGElement {
  const slot = side === 'a' ? m.a : m.b;
  const player = playerAt(state, slot);
  const classes = ['br-row'];
  if (slot === null) classes.push('is-tbd');
  if (m.status === 'done' && slot !== null)
    classes.push(m.winner === slot ? 'is-winner' : 'is-loser');
  if (player?.me) classes.push('is-me');
  if (player?.gone) classes.push('is-gone');
  const nameX = firstRound ? x + 30 : x + 10;
  return svg(
    'g',
    { class: classes.join(' ') },
    svg('rect', { x, y, width: BOX_W, height: ROW, rx: 5 }),
    firstRound && slot !== null
      ? svg('text', { class: 'br-seed', x: x + 10, y: y + 17 }, String(slot + 1))
      : null,
    svg('text', { class: 'br-name', x: nameX, y: y + 18 }, entrantName(player, t.ai)),
    svg(
      'text',
      { class: 'br-score', x: x + BOX_W - 9, y: y + 18, 'text-anchor': 'end' },
      scoreText(m, side),
    ),
  );
}

/** Pavouk jako SVG (jména jen přes textContent). Široký pavouk se posouvá do strany. */
/** Dá se sledovat: rozehraný zápas s vysíláním, ve kterém nehraju. */
export function watchable(state: TournamentState, m: TournamentMatch): boolean {
  return (
    m.status === 'ready' &&
    m.watch !== null &&
    m.watchKey !== null &&
    (state.me === null || (m.a !== state.me && m.b !== state.me))
  );
}

/** onWatch = kliknutí na rozehraný zápas otevře sledování. */
export function bracketView(
  state: TournamentState,
  onWatch?: (match: TournamentMatch) => void,
): HTMLElement {
  const size = state.size ?? 4;
  const layout = bracketLayout(size);
  const { rounds } = layout;
  const parts: SVGElement[] = [];

  for (let r = 1; r <= rounds; r++) {
    parts.push(
      svg(
        'text',
        { class: 'br-heading', x: layout.column(r), y: 16 },
        t.rounds[roundKind(r, 0, rounds)],
      ),
    );
  }

  // Spojnice: vítěz jde doprava do dalšího kola.
  const lines: string[] = [];
  for (const m of state.matches) {
    if (m.round >= rounds) continue;
    const x2 = layout.column(m.round) + BOX_W;
    const mid = x2 + COL_GAP / 2;
    const cy = layout.center(m.round, m.idx);
    const next = layout.center(m.round + 1, Math.floor(m.idx / 2));
    lines.push(`M${x2} ${cy}H${mid}V${next}H${x2 + COL_GAP}`);
  }
  const finalX = layout.column(rounds) + BOX_W;
  const finalY = layout.center(rounds, 0);
  lines.push(`M${finalX} ${finalY}H${finalX + COL_GAP}`);
  parts.push(svg('path', { class: 'br-lines', d: lines.join('') }));

  for (const m of state.matches) {
    const x = layout.column(m.round);
    const cy = layout.center(m.round, m.idx);
    const classes = ['br-match'];
    if (m.status === 'ready') classes.push('is-live');
    if (state.me !== null && (m.a === state.me || m.b === state.me)) classes.push('is-mine');
    const canWatch = onWatch !== undefined && watchable(state, m);
    if (canWatch) classes.push('is-watchable');
    const label = `${t.watch}: ${entrantName(playerAt(state, m.a), t.ai)} – ${entrantName(playerAt(state, m.b), t.ai)}`;
    parts.push(
      svg(
        'g',
        {
          class: classes.join(' '),
          ...(canWatch && {
            role: 'button',
            tabindex: '0',
            'aria-label': label,
            onclick: () => onWatch(m),
            onkeydown: (event: KeyboardEvent) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onWatch(m);
            },
          }),
        },
        canWatch ? svg('title', null, label) : null,
        m.round === rounds && m.idx === 1
          ? svg('text', { class: 'br-heading', x, y: cy - ROW - 8 }, t.rounds.third)
          : null,
        row(state, m, 'a', x, cy - ROW, m.round === 1),
        row(state, m, 'b', x, cy, m.round === 1),
        svg('line', { class: 'br-split', x1: x, x2: x + BOX_W, y1: cy, y2: cy }),
      ),
    );
  }

  const champion = playerAt(state, placements(state).first);
  const champX = finalX + COL_GAP;
  parts.push(
    svg(
      'g',
      { class: champion ? 'br-champion is-decided' : 'br-champion' },
      svg('rect', { x: champX, y: finalY - 26, width: CHAMP_W, height: 52, rx: 8 }),
      svg(
        'text',
        {
          class: 'br-champion-title',
          x: champX + CHAMP_W / 2,
          y: finalY - 6,
          'text-anchor': 'middle',
        },
        `🏆 ${t.champion}`,
      ),
      svg(
        'text',
        {
          class: 'br-champion-name',
          x: champX + CHAMP_W / 2,
          y: finalY + 14,
          'text-anchor': 'middle',
        },
        champion ? entrantName(champion, t.ai) : t.waitingFinal,
      ),
    ),
  );

  return h(
    'div',
    { class: 'bracket' },
    h(
      'div',
      { class: 'bracket-scroll', tabindex: '0', 'aria-label': t.label },
      svg(
        'svg',
        {
          class: 'bracket-svg',
          viewBox: `0 0 ${layout.width} ${layout.height}`,
          width: layout.width,
          height: layout.height,
          role: 'img',
          'aria-label': t.label,
        },
        ...parts,
      ),
    ),
    h(
      'p',
      { class: 'bracket-legend' },
      h('span', { class: 'legend-win' }, t.legendWin),
      h('span', { class: 'legend-live' }, t.legendLive),
      h('span', { class: 'legend-me' }, t.legendMe),
    ),
  );
}
