import type { MatchPlan } from '../../core/match/planMatch';
import { getGame } from '../../games/registry';
import { translations } from '../../i18n';
import { h } from '../dom';

const t = translations(
  { games: 'Hry v zápase', unknown: 'Neznámá hra, losuje se', drawn: 'losuje se' },
  { games: 'Games in the match', unknown: 'Unknown game, drawn at random', drawn: 'random' },
);

/** Hry zápasu v pořadí; losované se před startem ukazují jako „?“. */
export function slotList(plan: MatchPlan): HTMLOListElement {
  return h(
    'ol',
    { class: 'slot-list', 'aria-label': t.games },
    plan.slots.map((slot, i) =>
      h(
        'li',
        { class: slot.picked ? 'slot' : 'slot slot--hidden' },
        h('span', { class: 'slot-no', 'aria-hidden': 'true' }, i + 1),
        slot.picked
          ? h('span', { class: 'slot-name' }, getGame(slot.gameId).name)
          : h('span', { class: 'slot-name', 'aria-label': t.unknown }, '?'),
        slot.picked ? null : h('span', { class: 'slot-note', 'aria-hidden': 'true' }, t.drawn),
      ),
    ),
  );
}
