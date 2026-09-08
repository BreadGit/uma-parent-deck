import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { STATS } from '../../types.ts';
import { APTITUDE_KEYS, APTITUDE_LABELS, sanitizeGoal, type ParentGoal } from '../../model/goal-input.ts';
import { attemptsFor } from '../../model/goal.ts';
import type { RunPlan } from '../../model/run.ts';
import { data, store, update } from '../context.ts';
import { capitalize } from '../format.ts';
import { panel } from '../panel.ts';

const change = (fn: (goal: ParentGoal) => void) => update((s) => { fn(s.run.goal); s.run.goal = sanitizeGoal(s.run.goal, data); });
const probability = (p: number) => p === 0 ? '0%' : p < 0.00001 ? '<0.001%' : `${(p * 100).toFixed(p < 0.001 ? 3 : p < 0.01 ? 2 : 1)}%`;
const stars = (current: number) => [1, 2, 3].map((n) => html`<option value=${n} ?selected=${current === n}>${n}★ or better</option>`);
export function renderGoalEditor() {
  const g = store.run.goal;
  return panel({ title: 'Parent goal', actions: html`<label><input type="checkbox" data-goal-enabled .checked=${g.enabled} @change=${(e: Event) => change((g) => { g.enabled = (e.target as HTMLInputElement).checked; })} /> Evaluate goal</label>` }, g.enabled ? html`
    <p class="small muted">Choose blue and pink goals here. Set required and preferred white sparks in Target white sparks above.</p>
    <fieldset class="goal-group"><legend>Required blue spark</legend>
      <div class="goal-stats">${STATS.map((stat) => html`<label><input type="checkbox" data-goal-blue=${stat} .checked=${g.blueStats.includes(stat)} @change=${(e: Event) => change((g) => { g.blueStats = (e.target as HTMLInputElement).checked ? [...g.blueStats, stat] : g.blueStats.filter((s) => s !== stat); })} /> ${capitalize(stat)}</label>`)}
      <button class="small" data-action="goal-any-blue" @click=${() => change((g) => { g.blueStats = [...STATS]; })}>Any stat</button></div>
      <label class="goal-field">Minimum stars<select data-goal-stars="blue" .value=${live(String(g.blueStars))} @change=${(e: Event) => change((g) => { g.blueStars = Number((e.target as HTMLSelectElement).value); })}>${stars(g.blueStars)}</select></label>
    </fieldset>
    <fieldset class="goal-group"><legend>Required pink spark</legend><div class="goal-pair">
      <label class="goal-field">Aptitude<select data-goal-pink .value=${live(g.pink ?? '')} @change=${(e: Event) => change((g) => { g.pink = (e.target as HTMLSelectElement).value as ParentGoal['pink']; })}><option value="">Choose aptitude</option>${APTITUDE_KEYS.map((k) => html`<option value=${k} ?selected=${g.pink === k}>${APTITUDE_LABELS[k]}</option>`)}</select></label>
      <label class="goal-field">Minimum stars<select data-goal-stars="pink" .value=${live(String(g.pinkStars))} @change=${(e: Event) => change((g) => { g.pinkStars = Number((e.target as HTMLSelectElement).value); })}>${stars(g.pinkStars)}</select></label>
    </div></fieldset>
  ` : html`<p class="small muted">Set the blue, pink, and white sparks you want on one finished parent.</p>`);
}

export function renderGoalResult(c: RunPlan) {
  const result = c.goalEstimate;
  if (!result) return nothing;
  const p = result.probability;
  return panel({ title: 'Parent goal estimate' }, html`<div data-goal-result>
    ${p === null ? html`<p class="muted" data-goal-probability>Complete the goal inputs for a combined estimate.</p>` : html`<div class="goal-total" data-goal-probability>${probability(p)}<span class="small muted">per attempt for every required spark</span></div>`}
    ${result.issues.length ? html`<ul class="small" data-goal-issues>${result.issues.map((issue) => html`<li>${issue}</li>`)}</ul>` : nothing}
    ${p === 0 ? html`<p class="warn" data-goal-zero>The modeled outcomes give a zero estimate. Check blue spark thresholds, skill availability, and pink eligibility below.</p>` : nothing}
    <div class="scroll-x"><table class="goal-breakdown"><thead><tr><th>Required spark</th><th class="num">Available</th><th class="num">Spark chance</th></tr></thead><tbody>
      <tr><td>Blue (${store.run.goal.blueStats.length === 5 ? 'any stat' : store.run.goal.blueStats.map(capitalize).join(', ') || 'none selected'})</td><td class="num">Always</td><td class="num">${probability(result.blue)}</td></tr>
      <tr><td>Pink (${store.run.goal.pink ? APTITUDE_LABELS[store.run.goal.pink] : 'choose aptitude'})</td><td class="num">A/S only</td><td class="num">${result.pink?.probability == null ? 'Needs inputs' : probability(result.pink.probability)}</td></tr>
      ${result.required.map((w) => html`<tr><td>${w.target.name}</td><td class="num">${probability(w.available)}</td><td class="num">${probability(w.probability)}</td></tr>`)}
    </tbody></table></div>
    <p class="small muted">${result.required.length ? `All ${result.required.length} required white skill${result.required.length === 1 ? '' : 's'} available ${probability(result.allAvailable)} · ` : 'No required white sparks · '}SS or better ${probability(result.pSS)}. Each spark chance is shown individually; shared events and rank affect the combined result.</p>
    ${p !== null ? html`<div class="goal-attempts">${[0.5, 0.75, 0.95].map((confidence) => { const n = attemptsFor(p, confidence); return html`<div><b>${confidence * 100}% chance</b><span data-goal-attempts=${confidence}>${Number.isFinite(n) ? `${n.toLocaleString()} attempts` : 'Not reachable'}</span></div>`; })}</div>
      <p class="small muted">Attempts count final spark rolls. This estimate treats them as independent with the same odds, including rerolls.</p>` : nothing}
    ${result.preferred.length ? html`<details><summary>Preferred extras at 2★ or better</summary><ul class="small">${result.preferred.map((w) => html`<li>${w.target.name}: ${probability(w.probability)} per attempt</li>`)}</ul><p class="small muted">These individual chances do not require the rest of the goal to succeed.</p></details>` : nothing}
    <details><summary>Assumptions and aptitude increases</summary><ul class="small">${result.notes.map((note) => html`<li>${note}</li>`)}</ul>
      <p class="small muted">Stats share the same outcome with rank. Hint pickups and unlinked events are treated as independent. The agenda keeps its starting aptitude estimates.</p>
      ${result.pink ? html`<ul class="small">${result.pink.eligibility.map((e) => html`<li>${APTITUDE_LABELS[e.aptitude]} eligible at the end: ${e.probability === null ? 'not estimated' : probability(e.probability)}</li>`)}</ul>` : nothing}
    </details>
  </div>`);
}
