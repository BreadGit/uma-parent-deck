import { html, nothing } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import { live } from 'lit-html/directives/live.js';
import { STATS, APTITUDE_KEYS } from '../../types.ts';
import { APTITUDE_LABELS, sanitizeGoal, type ParentGoal, type PinkGoal } from '../../model/goal-input.ts';
import type { RunPlan } from '../../model/run.ts';
import { store, update } from '../context.ts';
import { LABEL, TITLE } from '../copy.ts';
import { isChecked, numbered, options, selectValue } from '../form.ts';
import { capitalize, pinkAptitudeName } from '../format.ts';
import { panel } from '../panel.ts';
import { renderGoalTemplates } from './goal-templates.ts';
import { renderTargets } from './targets.ts';
import { SPARK_STARS } from '../../model/rules.ts';

const change = (fn: (goal: ParentGoal) => void) => update((s) => { fn(s.run.goal); s.run.goal = sanitizeGoal(s.run.goal); });
const STAR_CHOICES = numbered(SPARK_STARS, (n) => `${n}★ or better`);

function blueGroup(g: ParentGoal) {
  return html`<fieldset class="goal-group"><legend>Required blue spark</legend>
    <div class="goal-stats">${STATS.map((stat) => html`<label><input type="checkbox" data-goal-blue=${stat} .checked=${live(g.blueStats.includes(stat))} @change=${(e: Event) => change((g) => { g.blueStats = isChecked(e) ? [...g.blueStats, stat] : g.blueStats.filter((s) => s !== stat); })} /> ${capitalize(stat)}</label>`)}
    <button class="small" data-action="goal-any-blue" @click=${() => change((g) => { g.blueStats = [...STATS]; })}>Any stat</button></div>
    <label class="goal-field">${LABEL.minimumStars}<select data-goal-stars="blue" .value=${live(String(g.blueStars))} @change=${(e: Event) => change((g) => { g.blueStars = Number(selectValue(e)); })}>${options(STAR_CHOICES, String(g.blueStars))}</select></label>
  </fieldset>`;
}

function pinkRow(g: ParentGoal, p: PinkGoal) {
  const aptitudes = [...(p.aptitude === 'any' ? [{ value: 'any', label: 'Any' }] : []),
    ...APTITUDE_KEYS.filter((k) => k === p.aptitude || !g.pink.some((r) => r.aptitude === k)).map((k) => ({ value: k, label: APTITUDE_LABELS[k] }))];
  const row = (fn: (r: PinkGoal) => void) => change((g) => { const r = g.pink.find((r) => r.aptitude === p.aptitude); if (r) fn(r); });
  return html`<div class="pink-goal-fields" data-pink-goal-row=${p.aptitude}>
    <label class="goal-field"><select aria-label="Aptitude" data-goal-pink=${p.aptitude} .value=${live(p.aptitude)} @change=${(e: Event) => row((r) => { r.aptitude = selectValue(e) as PinkGoal['aptitude']; })}>${options(aptitudes, p.aptitude)}</select></label>
    <label class="goal-field"><select aria-label=${LABEL.minimumStars} data-goal-stars="pink" data-pink-aptitude=${p.aptitude} .value=${live(String(p.stars))} @change=${(e: Event) => row((r) => { r.stars = Number(selectValue(e)); })}>${options(STAR_CHOICES, String(p.stars))}</select></label>
    ${p.aptitude !== 'any' ? html`<button class="small" data-action="remove-pink-goal" data-aptitude=${p.aptitude} aria-label=${`Remove ${pinkAptitudeName(p.aptitude)}`} @click=${() => change((g) => { g.pink = g.pink.filter((r) => r.aptitude !== p.aptitude); })}>×</button>` : nothing}
  </div>`;
}

function addPink(g: ParentGoal) {
  const aptitude = APTITUDE_KEYS.find((k) => !g.pink.some((r) => r.aptitude === k));
  if (aptitude) g.pink = g.pink[0]?.aptitude === 'any' ? [{ aptitude, stars: g.pink[0].stars }] : [...g.pink, { aptitude, stars: 2 }];
}

function pinkGroup(g: ParentGoal) {
  return html`<fieldset class="goal-group"><legend class="goal-group-header"><span>Required pink spark</span><button class="small" data-action="reset-pink-goal" @click=${() => change((g) => { g.pink = []; })}>Reset</button></legend>
    ${g.pink.length > 1 ? html`<p class="small muted">Any one of these results satisfies the pink requirement.</p>` : nothing}
    ${repeat(g.pink, (p) => p.aptitude, (p) => pinkRow(g, p))}
    <div class="goal-stats"><button class="small" data-action="add-pink-goal" ?disabled=${g.pink.length >= APTITUDE_KEYS.length} @click=${() => change(addPink)}>Add spark</button></div>
  </fieldset>`;
}

export function renderGoalEditor(c: RunPlan) {
  const g = store.run.goal;
  return panel({ title: TITLE.goal, step: 2, tip: 'What one finished parent must carry: a blue spark on an accepted stat, a pink spark on an accepted aptitude, and every required white spark, all at their minimum stars.' }, html`${renderGoalTemplates()}${renderTargets(c)}${blueGroup(g)}${pinkGroup(g)}`);
}
