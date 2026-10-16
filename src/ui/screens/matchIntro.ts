import type { MatchPlan } from '../../core/match/planMatch';
import type { Mount } from '../App';
import { button, versus } from '../components/common';
import { slotList } from '../components/slotList';
import { h } from '../dom';
import { formatTitle, MODE_LABEL, plural } from '../labels';
import type { MatchSetup } from '../MatchFlow';

interface MatchIntroOptions {
  readonly setup: MatchSetup;
  readonly plan: MatchPlan;
  readonly onStart: () => void;
  readonly onBack: () => void;
}

export const RULES_NOTE =
  'Zápas končí, jakmile má někdo potřebný počet výher – zbylé hry se nehrají. ' +
  'Remíza se nepočítá a hraje se rozhodující kolo stejné hry (max. 3×, pak los).';

export function bestOfLead(plan: MatchPlan): string {
  return `Best of ${plan.bestOf} – vyhrává, kdo první získá ${plan.winsNeeded} ${plural(plan.winsNeeded, 'výhru', 'výhry', 'výher')}.`;
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
        h('p', { class: 'lead' }, bestOfLead(plan)),
        slotList(plan),
        h('p', { class: 'note' }, RULES_NOTE),
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
