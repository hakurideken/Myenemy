import type { RenderFrame, ViewContext } from '../../core/MiniGame';
import type { Outcome, PlayerSlot } from '../../core/types';
import { translations } from '../../i18n';
import { h, svg } from '../../ui/dom';

const t = translations(
  {
    mark: { A: 'křížek', B: 'kolečko' },
    turnLocal: (name: string) => `Na tahu: ${name}`,
    yourTurn: 'Jsi na tahu',
    thinking: (name: string) => `${name} přemýšlí…`,
    turnRemote: (name: string) => `Na tahu je ${name}`,
    draw: 'Remíza!',
    winner: (name: string) => `Vítěz: ${name}`,
  },
  {
    mark: { A: 'cross', B: 'circle' },
    turnLocal: (name: string) => `${name}'s turn`,
    yourTurn: 'Your turn',
    thinking: (name: string) => `${name} is thinking…`,
    turnRemote: (name: string) => `${name}'s turn`,
    draw: 'Draw!',
    winner: (name: string) => `Winner: ${name}`,
  },
);

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

export const MARK_LABEL: Record<PlayerSlot, string> = t.mark;

/** Kdo je na tahu – podle režimu (lokálně jménem, PvE/online z pohledu hráče). */
export function turnMessage(
  ctx: ViewContext<unknown>,
  turn: PlayerSlot,
  frame: RenderFrame,
): string {
  const name = ctx.names[turn];
  if (ctx.localPlayers.length > 1) return t.turnLocal(name);
  if (frame.canAct.includes(turn)) return t.yourTurn;
  return ctx.mode === 'pve' ? t.thinking(name) : t.turnRemote(name);
}

export function outcomeMessage(ctx: ViewContext<unknown>, outcome: Outcome): string {
  return outcome.kind === 'draw' ? t.draw : t.winner(ctx.names[outcome.winner]);
}

/** Řádek se stavem hry (čte ho i odečítač obrazovky). */
export function statusLine(): HTMLParagraphElement {
  return h('p', { class: 'board-status', 'aria-live': 'polite' });
}
