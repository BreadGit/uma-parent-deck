// One line of what the run is, shown while the input column is hidden so the results, and a screenshot of them, keep
// their context: the trainee, the blue and pink goal, and the target sparks.
import { html, nothing } from 'lit-html';
import { APTITUDE_LABELS } from '../model/goal-input.ts';
import type { RunPlan } from '../model/run.ts';
import { store } from './context.ts';
import { COPY } from './copy.ts';
import { capitalize, charImg } from './format.ts';

export function runSummary(c: RunPlan) {
  if (!c.trainee) return nothing;
  const g = store.run.goal, r = c.goalEstimate;
  const blue = `${g.blueStats.length === 5 ? 'any stat' : g.blueStats.map(capitalize).join(', ') || 'none selected'} ${g.blueStars}★+`;
  const pink = g.pink.map((p) => `${p.aptitude === 'any' ? 'Any' : APTITUDE_LABELS[p.aptitude]} ${p.stars}★+`).join(' or ');
  const names = (list: { target: { name: string } }[]) => list.map((w) => w.target.name).join(', ');
  return html`<div class="run-summary" data-run-summary>
    <span><img class="thumb thumb-sm" src=${charImg(c.trainee)} alt="" /> <b>${c.trainee.name}</b> <span class="muted">${store.run.traineeStars}★</span></span>
    <span><span class="muted">${COPY.summary.blue}</span> ${blue}</span>
    <span><span class="muted">${COPY.summary.pink}</span> ${pink}</span>
    ${r.required.length ? html`<span><span class="muted">${COPY.summary.required}</span> ${names(r.required)}</span>` : nothing}
    ${r.preferred.length ? html`<span><span class="muted">${COPY.summary.preferred}</span> ${names(r.preferred)}</span>` : nothing}
  </div>`;
}
