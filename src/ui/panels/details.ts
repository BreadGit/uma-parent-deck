// Prediction details: the reasoning behind the result panels, for checking the tool's work. The panel opens on request
// and its sections are built only while it is open; each section leads with its numbers, and the method sits behind a
// disclosure at the section's end. Each section is rendered by the panel it explains, so the numbers cannot drift apart.
import { html, nothing } from 'lit-html';
import type { RunPlan } from '../../model/run.ts';
import { refresh, view } from '../context.ts';
import { TITLE } from '../copy.ts';
import { isOpen } from '../form.ts';
import { panel, sub } from '../panel.ts';
import { coverageTable } from './coverage.ts';
import { deckBuild } from './deck.ts';
import { goalDetails } from './estimate.ts';
import { statBreakdown } from './prediction.ts';

const COVERAGE_TIP = "Chance the run hands over each target's hint, by form. The spark chance assumes you buy the best hinted form at the end: gold at 40%, otherwise a released ◎ upgrade at 25%, otherwise the base skill at 20%. Where a ◎ exists, buying it needs no separate hint. The run itself buys nothing.";

function sections(c: RunPlan, complete: boolean) {
  return html`
    <div data-goal-details>${sub('Goal estimate breakdown', { tip: 'Each required spark on its own. The combined chance above needs all of them in one run.' })}${goalDetails(c)}</div>
    ${complete ? html`${sub('Where the stats come from')}${statBreakdown(c)}` : html`<p class="small muted" data-details-incomplete>Stat sources and target coverage appear once the deck is complete.</p>`}
    ${complete ? html`${sub(TITLE.coverage, { tip: COVERAGE_TIP })}${coverageTable(c)}` : nothing}
    ${sub('How the deck was built')}${deckBuild(c)}`;
}

export function renderPredictionDetails(c: RunPlan) {
  const complete = !c.issues.length;
  const subtitle = (complete ? ['goal estimate', 'stat sources', 'target coverage', 'deck search'] : ['goal estimate', 'deck search']).join(' · ');
  return panel({ title: TITLE.details, kind: 'result', subtitle, tip: 'For checking the tool\'s work. Each number above is broken into the parts it came from, and each section ends with how it is computed. The stat sources and target coverage need a complete deck.' }, html`
    <details class="explore" data-prediction-details ?open=${view.showDetails} @toggle=${(e: Event) => { view.showDetails = isOpen(e); refresh(); }}>
      <summary>Explore how each number above was reached</summary>
      ${view.showDetails ? sections(c, complete) : nothing}
    </details>`);
}
