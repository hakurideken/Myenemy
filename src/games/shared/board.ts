import type { RenderFrame, ViewContext } from '../../core/MiniGame';
import type { Outcome, PlayerSlot } from '../../core/types';
import { h, svg } from '../../ui/dom';

/** Značka hráče v deskových hrách: A = ✕ (červená), B = ○ (modrá) – tvar i barva kvůli barvosleposti. */
export function playerMark(player: PlayerSlot): SVGSVGElement {
  const attrs = {
    viewBox: '0 0 40 40',
    class: `mark mark--${player.toLowerCase()}`,
    'aria-hidden': 'true',
    focusable: 'false',
  };
  return player === 'A'
    ? svg('svg', attrs, svg('path', { d: 'M11 11 29 29M29 11 11 29' }))
    : svg('svg', attrs, svg('circle', { cx: '20', cy: '20', r: '11' }));
}

export const MARK_LABEL: Record<PlayerSlot, string> = { A: 'křížek', B: 'kolečko' };

/** Kdo je na tahu – podle režimu (lokálně jménem, PvE/online z pohledu hráče). */
export function turnMessage(
  ctx: ViewContext<unknown>,
  turn: PlayerSlot,
  frame: RenderFrame,
): string {
  const name = ctx.names[turn];
  if (ctx.localPlayers.length > 1) return `Na tahu: ${name}`;
  if (frame.canAct.includes(turn)) return 'Jsi na tahu';
  return ctx.mode === 'pve' ? `${name} přemýšlí…` : `Na tahu je ${name}`;
}

export function outcomeMessage(ctx: ViewContext<unknown>, outcome: Outcome): string {
  return outcome.kind === 'draw' ? 'Remíza!' : `Vítěz: ${ctx.names[outcome.winner]}`;
}

/** Řádek se stavem hry (čte ho i odečítač obrazovky). */
export function statusLine(): HTMLParagraphElement {
  return h('p', { class: 'board-status', 'aria-live': 'polite' });
}
