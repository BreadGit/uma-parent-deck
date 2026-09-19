// Prediction details: the reasoning behind the result panels, for checking the tool's work. The panel opens on request
// and its sections are built only while it is open; each section leads with its numbers, and the method sits behind a
// disclosure at the section's end. Each section is rendered by the panel it explains, so the numbers cannot drift apart.
import { html, nothing } from 'lit-html';
import type { RunPlan } from '../../model/run.ts';
import { refresh, view } from '../context.ts';
import { COPY } from '../copy.ts';
import { panel, sub } from '../panel.ts';
import { coverageTable } from './coverage.ts';
import { deckBuild } from './deck.ts';
import { goalDetails } from './estimate.ts';
import { statBreakdown } from './prediction.ts';

function sections(c: RunPlan, complete: boolean) {
  return html`
    <div data-goal-details>${sub(COPY.details.estimate, { tip: COPY.details.estimateTip })}${goalDetails(c)}</div>
    ${complete ? html`${sub(COPY.prediction.breakdown)}${statBreakdown(c)}` : html`<p class="small muted" data-details-incomplete>${COPY.details.incomplete}</p>`}
    ${complete ? html`${sub(COPY.coverage.title, { tip: COPY.coverage.tip })}${coverageTable(c)}` : nothing}
    ${sub(COPY.deck.steps)}${deckBuild(c)}`;
}

export function renderPredictionDetails(c: RunPlan) {
  const complete = !c.issues.length;
  return panel({ title: COPY.details.title, kind: 'result', subtitle: COPY.details.sections(complete), tip: COPY.details.tip }, html`
    <details class="explore" data-prediction-details ?open=${view.showDetails} @toggle=${(e: Event) => { view.showDetails = (e.target as HTMLDetailsElement).open; refresh(); }}>
      <summary>${COPY.details.explore}</summary>
      ${view.showDetails ? sections(c, complete) : nothing}
    </details>`);
}
