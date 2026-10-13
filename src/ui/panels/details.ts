// Prediction details: the reasoning behind the result panels, for checking the tool's work. The panel opens on request
// and its sections are built only while it is open; each section leads with its numbers, and the method sits behind a
// disclosure at the section's end. Each section is rendered by the panel it explains, so the numbers cannot drift apart.
import { html, nothing } from 'lit-html';
import type { RunPlan } from '../../model/run.ts';
import { refresh, view } from '../context.ts';
import { TITLE } from '../copy.ts';
import { isOpen } from '../fields.ts';
import { panel, sub } from '../panel.ts';
import { coverageTable } from './coverage.ts';
import { deckBuild } from './deck.ts';
import { goalDetails } from './estimate.ts';
import { statBreakdown } from './prediction.ts';

const copy = {
  tip: 'For checking the tool\'s work. Each number above is broken into the parts it came from, and each section ends with how it is computed. The stat sources and target coverage need a complete deck.',
  sections: (complete: boolean) => (complete ? ['goal estimate', 'stat sources', 'target coverage', 'deck search'] : ['goal estimate', 'deck search']).join(' · '),
  incomplete: 'Stat sources and target coverage appear once the deck is complete.',
  explore: 'Explore how each number above was reached',
  estimate: 'Goal estimate breakdown',
  estimateTip: 'Each required spark on its own. The combined chance above needs all of them in one run.',
  deckSteps: 'How the deck was built',
  statBreakdown: 'Where the stats come from',
  coverageTip: "Chance the run hands over each target's hint, by form. The spark chance assumes you buy the best hinted form at the end: gold at 40%, otherwise a released ◎ upgrade at 25%, otherwise the base skill at 20%. Where a ◎ exists, buying it needs no separate hint. The run itself buys nothing.",
} as const;

function sections(c: RunPlan, complete: boolean) {
  return html`
    <div data-goal-details>${sub(copy.estimate, { tip: copy.estimateTip })}${goalDetails(c)}</div>
    ${complete ? html`${sub(copy.statBreakdown)}${statBreakdown(c)}` : html`<p class="small muted" data-details-incomplete>${copy.incomplete}</p>`}
    ${complete ? html`${sub(TITLE.coverage, { tip: copy.coverageTip })}${coverageTable(c)}` : nothing}
    ${sub(copy.deckSteps)}${deckBuild(c)}`;
}

export function renderPredictionDetails(c: RunPlan) {
  const complete = !c.issues.length;
  return panel({ title: TITLE.details, kind: 'result', subtitle: copy.sections(complete), tip: copy.tip }, html`
    <details class="explore" data-prediction-details ?open=${view.showDetails} @toggle=${(e: Event) => { view.showDetails = isOpen(e); refresh(); }}>
      <summary>${copy.explore}</summary>
      ${view.showDetails ? sections(c, complete) : nothing}
    </details>`);
}
