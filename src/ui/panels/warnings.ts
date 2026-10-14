// Warnings: everything that limits or changes the results, gathered above the deck so nothing important hides inside a
// panel. Shown only when there is something to say.
import { html, nothing } from 'lit-html';
import type { RunPlan } from '../../model/run.ts';
import { retrySearch, view } from '../context.ts';
import { TITLE } from '../copy.ts';
import { skillName, skillWithTip } from '../format.ts';
import { panel, sub } from '../panel.ts';
import { goalWarnings, hasGoalWarnings } from './estimate.ts';

const CONFLICTS_TIP = 'These events offer more than one wanted skill, and the run can pick only one option per event. The option of the target listed higher wins: required before preferred, preferred by their priority, and between required targets whichever order gives the best chance of every required spark. That the list order settles a contested option is an assumption: the game confirms prioritized skills steer choices, not how ties between them resolve.';

export function hasWarnings(c: RunPlan) {
  return view.searchFailed || c.issues.length > 0 || hasGoalWarnings(c) || c.deckResult.conflicts.length > 0;
}

function conflicts(c: RunPlan) {
  const d = c.deckResult;
  if (!d.conflicts.length) return nothing;
  return html`<div class="conflicts-box" data-choice-conflicts>${sub('Choice conflicts', CONFLICTS_TIP)}
    <p class="small muted">The run takes one option per event and the target listed higher takes it. To change which one, change the priorities or the targets in ${TITLE.goal}.</p>
    <div class="scroll-x"><table class="small conflicts"><thead><tr><th>Event</th><th>Options</th><th>Taken</th><th>Not taken</th></tr></thead><tbody>
      ${d.conflicts.map((cf) => html`<tr><td class="wrap">${cf.label}</td>
        <td class="wrap">${[cf.taken, ...cf.dropped].map((o) => html`<div>${skillWithTip(o.skillId)}${o.option ? html` <span class="muted">${o.option}</span>` : nothing}</div>`)}</td>
        <td><b>${skillName(cf.taken.skillId)}</b>${cf.taken.target != null ? nothing : html` <span class="muted">(not a target)</span>`}</td><td>${cf.dropped.map((o) => skillName(o.skillId)).join(', ')}</td></tr>`)}
    </tbody></table></div></div>`;
}

export function renderWarnings(c: RunPlan) {
  return panel({ title: 'Warnings', kind: 'result', tip: 'Anything that limits or changes the estimates below: missing inputs, an impossible goal, a deck the search could not complete, and events where two wanted skills compete for one option.', cls: 'panel-warn panel-live' }, html`
    ${view.searchFailed ? html`<p class="warn" role="alert" data-search-failed>Deck search could not finish. The displayed deck's estimates match your current inputs. <button class="small" data-action="retry-search" @click=${retrySearch}>Retry search</button></p>` : nothing}
    ${c.issues.length ? html`<div role="alert" data-plan-issues>${c.issues.map((issue) => html`<p class="warn">${issue}</p>`)}</div>` : nothing}
    ${goalWarnings(c)}
    ${conflicts(c)}`);
}
