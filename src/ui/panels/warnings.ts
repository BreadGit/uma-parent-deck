// Warnings: everything that limits or changes the results, gathered above the deck so nothing important hides inside a
// panel. Shown only when there is something to say.
import { html, nothing } from 'lit-html';
import type { RunPlan } from '../../model/run.ts';
import type { Conflict } from '../../model/sparks.ts';
import { retrySearch, searchState } from '../context.ts';
import { COPY } from '../copy.ts';
import { skillName, skillWithTip } from '../format.ts';
import { panel, sub } from '../panel.ts';
import { goalWarnings, hasGoalWarnings } from './estimate.ts';

export function hasWarnings(c: RunPlan) {
  return !!searchState.error || c.issues.length > 0 || hasGoalWarnings(c) || c.priorityIssues.length > 0 || c.deckResult.conflicts.length > 0;
}

function conflicts(c: RunPlan) {
  const d = c.deckResult;
  if (!d.conflicts.length) return nothing;
  const opts = (cf: Conflict) => [cf.taken, ...cf.dropped];
  return html`<div class="conflicts-box" data-choice-conflicts>${sub(COPY.warnings.conflicts, { tip: COPY.warnings.conflictsTip })}
    <p class="small muted">${COPY.warnings.conflictsNote}</p>
    <div class="scroll-x"><table class="small conflicts"><thead><tr><th>Event</th><th>Options</th><th>Taken</th><th>Not taken</th></tr></thead><tbody>
      ${d.conflicts.map((cf) => html`<tr><td class="wrap">${cf.label}</td>
        <td class="wrap">${opts(cf).map((o) => html`<div>${skillWithTip(o.skillId)}${o.option ? html` <span class="muted">${o.option}</span>` : nothing}</div>`)}</td>
        <td><b>${skillName(cf.taken.skillId)}</b>${cf.taken.target != null ? nothing : html` <span class="muted">(not a target)</span>`}</td><td>${cf.dropped.map((o) => skillName(o.skillId)).join(', ')}</td></tr>`)}
    </tbody></table></div></div>`;
}

export function renderWarnings(c: RunPlan) {
  return panel({ title: COPY.warnings.title, kind: 'result', tip: COPY.warnings.tip, cls: 'panel-warn' }, html`
    ${searchState.error ? html`<p class="warn" role="alert" data-search-failed>${COPY.app.searchFailed} <button class="small" data-action="retry-search" @click=${retrySearch}>${COPY.app.retrySearch}</button></p>` : nothing}
    ${c.issues.length ? html`<div role="alert" data-plan-issues>${c.issues.map((issue) => html`<p class="warn">${issue}</p>`)}</div>` : nothing}
    ${goalWarnings(c)}
    ${c.priorityIssues.map((note) => html`<p class="small warn" data-priority-conflict>${note}</p>`)}
    ${conflicts(c)}`);
}
