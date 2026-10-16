import type { MatchPlan } from '../../core/match/planMatch';
import { getGame } from '../../games/registry';
import type { Mount } from '../App';
import { button, versus } from '../components/common';
import { h } from '../dom';
import { formatTitle, MODE_LABEL, plural } from '../labels';
import type { MatchSetup } from '../MatchFlow';

interface MatchIntroOptions {
  readonly setup: MatchSetup;
  readonly plan: MatchPlan;
  readonly onStart: () => void;
  readonly onBack: () => void;
}

export function matchIntroScreen(o: MatchIntroOptions): Mount {
  return (root) => {
    const { plan, setup } = o;
    root.append(
      h(
        'main',
        { class: 'screen' },
        h('p', { class: 'kicker' }, MODE_LABEL[setup.mode]),
        h('h1', { class: 'screen-title', tabindex: '-1' }, formatTitle(setup.format)),
        versus(setup.names),
        h(
          'p',
          { class: 'lead' },
          `Best of ${plan.bestOf} – vyhrává, kdo první získá ${plan.winsNeeded} ${plural(plan.winsNeeded, 'výhru', 'výhry', 'výher')}.`,
        ),
        h(
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
              slot.picked
                ? null
                : h('span', { class: 'slot-note', 'aria-hidden': 'true' }, 'losuje se'),
            ),
          ),
        ),
        h(
          'p',
          { class: 'note' },
          'Zápas končí, jakmile má někdo potřebný počet výher – zbylé hry se nehrají. ' +
            'Remíza se nepočítá a hraje se rozhodující kolo stejné hry (max. 3×, pak los).',
        ),
        h(
          'div',
          { class: 'actions' },
          button('Zpět do menu', o.onBack, 'btn btn-ghost'),
          button('Do boje!', o.onStart, 'btn btn-primary btn-lg', { 'data-autofocus': true }),
        ),
      ),
    );
  };
}
