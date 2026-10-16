import type { MatchPlan } from '../../core/match/planMatch';
import { getGame } from '../../games/registry';
import { h } from '../dom';

/** Hry zápasu v pořadí; losované se před startem ukazují jako „?“. */
export function slotList(plan: MatchPlan): HTMLOListElement {
  return h(
    'ol',
    { class: 'slot-list', 'aria-label': 'Hry v zápase' },
    plan.slots.map((slot, i) =>
      h(
        'li',
        { class: slot.picked ? 'slot' : 'slot slot--hidden' },
        h('span', { class: 'slot-no', 'aria-hidden': 'true' }, i + 1),
        slot.picked
          ? h('span', { class: 'slot-name' }, getGame(slot.gameId).name)
          : h('span', { class: 'slot-name', 'aria-label': 'Neznámá hra, losuje se' }, '?'),
        slot.picked ? null : h('span', { class: 'slot-note', 'aria-hidden': 'true' }, 'losuje se'),
      ),
    ),
  );
}
