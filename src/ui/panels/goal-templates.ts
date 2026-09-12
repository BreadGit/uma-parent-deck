import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { GOAL_TEMPLATES, type GoalTemplate } from '../../model/goal-templates.ts';
import { APTITUDE_LABELS } from '../../model/goal-input.ts';
import { resolveTarget } from '../../model/sparks.ts';
import { data, refresh, update, view } from '../context.ts';
import { capitalize } from '../format.ts';
import { tip } from '../tooltip.ts';

const TEMPLATE_TIP = 'These are generic starting points for parents at different effort levels. "lite" is for a low effort but usable parent in a pinch, "decent" is for a medium effort decent parent, "godly" is for everything possible stacked on';

function loadTemplate(template: GoalTemplate) {
  if (!confirm(`Load "${template.name}"? This replaces your current goal requirements and target list.`)) return;
  const { goal, targets } = structuredClone(template);
  view.targetEditorId = null;
  view.query = '';
  update((s) => { s.run.goal = goal; s.run.targets = targets; });
}

export function renderGoalTemplates() {
  const template = GOAL_TEMPLATES.find((t) => t.id === view.goalTemplateId);
  return html`<details data-goal-templates><summary>Load a template ${tip(TEMPLATE_TIP)}</summary>
    <label class="goal-field">Template<select data-goal-template .value=${live(view.goalTemplateId)} @change=${(e: Event) => { view.goalTemplateId = (e.target as HTMLSelectElement).value; refresh(); }}>
      <option value="" ?selected=${!view.goalTemplateId}>Choose a template</option>
      ${GOAL_TEMPLATES.map((t) => html`<option value=${t.id} ?selected=${view.goalTemplateId === t.id}>${t.name}</option>`)}
    </select></label>
    ${template ? html`<div class="small" data-template-preview>
      ${template.description ? html`<p>${template.description}</p>` : nothing}
      <p><b>Required blue spark:</b> ${template.goal.blueStats.length === 5 ? 'Any stat' : template.goal.blueStats.map(capitalize).join(' or ')} ${template.goal.blueStars}★+</p>
      <p><b>Required pink spark:</b> ${template.goal.pink.map((p) => `${p.aptitude === 'any' ? 'Any' : APTITUDE_LABELS[p.aptitude]} ${p.stars}★+`).join(' or ')}</p>
      ${(['required', 'preferred'] as const).map((role) => html`<p><b>${role === 'required' ? 'Required' : 'Preferred'} white sparks</b></p>
        <ul class="template-targets">${template.targets.filter((t) => t.role === role).map((t) => html`<li>${resolveTarget(t.id, data)!.name} · ${role === 'required' ? `${t.stars}★+` : `priority ${t.priority}`}</li>`)}</ul>`)}
    </div>` : nothing}
    <button class="small" data-action="load-goal-template" ?disabled=${!template} @click=${() => { if (template) loadTemplate(template); }}>Load</button>
  </details>`;
}
