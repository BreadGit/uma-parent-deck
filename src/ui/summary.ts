// Shown while the input column is hidden, so the results and a screenshot of them keep their context.
import { html, nothing } from 'lit-html';
import type { RunPlan } from '../model/run.ts';
import { store } from './context.ts';
import { blueStatsLabel, charImg, pinkGoalLabel } from './format.ts';

export function runSummary(c: RunPlan) {
  if (!c.trainee) return nothing;
  const g = store.run.goal, r = c.goalEstimate;
  const blue = `${blueStatsLabel(g.blueStats)} ${g.blueStars}★+`;
  const pink = g.pink.map(pinkGoalLabel).join(' or ');
  const names = (list: { target: { name: string } }[]) => list.map((w) => w.target.name).join(', ');
  return html`<div class="run-summary" data-run-summary>
    <span><img class="thumb thumb-sm" src=${charImg(c.trainee)} alt="" /> <b>${c.trainee.name}</b> <span class="muted">${store.run.traineeStars}★</span></span>
    <span><span class="muted">Blue</span> ${blue}</span>
    <span><span class="muted">Pink</span> ${pink}</span>
    ${r.required.length ? html`<span><span class="muted">Required</span> ${names(r.required)}</span>` : nothing}
    ${r.preferred.length ? html`<span><span class="muted">Preferred</span> ${names(r.preferred)}</span>` : nothing}
  </div>`;
}
