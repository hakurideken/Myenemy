import type { MatchPlan } from '../../core/match/planMatch';
import type { Mount } from '../App';
import { button, versus } from '../components/common';
import { slotList } from '../components/slotList';
import { h } from '../dom';
import { translations } from '../../i18n';
import { formatTitle, MODE_LABEL, plural } from '../labels';
import type { MatchSetup } from '../MatchFlow';

interface MatchIntroOptions {
  readonly setup: MatchSetup;
  readonly plan: MatchPlan;
  readonly onStart: () => void;
  readonly onBack: () => void;
}

const t = translations(
  {
    rulesNote:
      'Zápas končí, jakmile má někdo potřebný počet výher – zbylé hry se nehrají. ' +
      'Remíza se nepočítá a hraje se rozhodující kolo stejné hry (max. 3×, pak los).',
    lead: (bestOf: number, wins: number) =>
      `Best of ${bestOf} – vyhrává, kdo první získá ${wins} ${plural(wins, 'výhru', 'výhry', 'výher')}.`,
    back: 'Zpět do menu',
    start: 'Do boje!',
  },
  {
    rulesNote:
      'The match ends as soon as someone has enough wins – the remaining games are skipped. ' +
      'A draw does not count; a deciding round of the same game follows (max. 3×, then a coin flip).',
    lead: (bestOf: number, wins: number) =>
      `Best of ${bestOf} – the first to ${wins} ${wins === 1 ? 'win' : 'wins'} takes it.`,
    back: 'Back to menu',
    start: 'Fight!',
  },
);

export const RULES_NOTE = t.rulesNote;

export function bestOfLead(plan: MatchPlan): string {
  return t.lead(plan.bestOf, plan.winsNeeded);
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
          button(t.back, o.onBack, 'btn btn-ghost'),
          button(t.start, o.onStart, 'btn btn-primary btn-lg', { 'data-autofocus': true }),
        ),
      ),
    );
  };
}
