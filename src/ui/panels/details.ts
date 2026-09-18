// Prediction details: the reasoning behind the result panels, in one place below the agenda. Each section is rendered
// by the panel it explains, so the numbers cannot drift apart.
import { html, nothing } from 'lit-html';
import type { RunPlan } from '../../model/run.ts';
import { COPY } from '../copy.ts';
import { panel, sub } from '../panel.ts';
import { coverageTable } from './coverage.ts';
import { deckBuild } from './deck.ts';
import { goalDetails } from './estimate.ts';
import { statBreakdown } from './prediction.ts';

export function renderPredictionDetails(c: RunPlan) {
  const complete = !c.issues.length;
  return panel({ title: COPY.details.title, kind: 'result', tip: COPY.details.tip }, html`
    <div data-goal-details>${sub(COPY.details.estimate, { tip: COPY.details.estimateTip })}${goalDetails(c)}</div>
    ${complete ? html`${sub(COPY.prediction.breakdown)}${statBreakdown(c)}` : nothing}
    ${complete ? html`${sub(COPY.coverage.title, { tip: COPY.coverage.tip })}${coverageTable(c)}` : nothing}
    ${sub(COPY.deck.steps)}${deckBuild(c)}`);
}
