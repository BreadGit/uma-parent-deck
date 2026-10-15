import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { GOAL_TEMPLATES, type GoalTemplate } from '../../model/goal-templates.ts';
import { STATS } from '../../types.ts';
import { lineageCount, lineageSide, lineageStars, resolveTarget } from '../../model/sparks.ts';
import { data, update, view } from '../context.ts';
import { confirmDialog } from '../dialog.ts';
import { options, selectValue } from '../form.ts';
import { capitalize, pinkGoalLabel } from '../format.ts';
import { tip } from '../tooltip.ts';

async function loadTemplate(template: GoalTemplate) {
  if (!await confirmDialog(`Load "${template.name}"? This replaces your current goal requirements and target list.`, 'Load')) return;
  const { goal, targets, targetLineage } = structuredClone(template);
  view.targetEditorId = null;
  view.requiredQuery = ''; view.preferredQuery = '';
  update((s) => {
    s.run.goal = goal; s.run.targets = targets;
    for (const [id, lineage] of Object.entries(targetLineage ?? {})) s.run.targetLineage[id] ??= lineage;
  });
}

const targetName = (id: number | string) => resolveTarget(Number(id), data)!.name;

function preview(template: GoalTemplate) {
  return html`<div class="small" data-template-preview>
    ${template.description ? html`<p>${template.description}</p>` : nothing}
    <p><b>Required blue spark:</b> ${template.goal.blueStats.length === STATS.length ? 'Any stat' : template.goal.blueStats.map(capitalize).join(' or ')} ${template.goal.blueStars}★+</p>
    <p><b>Required pink spark:</b> ${template.goal.pink.map(pinkGoalLabel).join(' or ')}</p>
    ${(['required', 'preferred'] as const).map((role) => html`<p><b>${role === 'required' ? 'Required' : 'Preferred'} white sparks</b></p>
      <ul class="template-targets">${template.targets.filter((t) => t.role === role).map((t) => html`<li>${targetName(t.id)} · ${role === 'required' ? `${t.stars}★+` : `priority ${t.priority}`}</li>`)}</ul>`)}
    ${template.targetLineage ? html`<p><b>Default white lineage</b> · Existing entries are kept.</p>
      <ul class="template-targets">${Object.entries(template.targetLineage).map(([id, l]) => html`<li>${targetName(id)} · ${([0, 1] as const).map((side) => `Parent ${side + 1}: ${lineageCount(lineageSide(l, side))}× ${lineageStars(lineageSide(l, side))}★`).join(' · ')}</li>`)}</ul>` : nothing}
  </div>`;
}

export function renderGoalTemplates() {
  const template = GOAL_TEMPLATES.find((t) => t.id === view.goalTemplateId);
  const items = [{ value: '', label: 'Choose a template' }, ...GOAL_TEMPLATES.map((t) => ({ value: t.id, label: t.name }))];
  return html`<details data-goal-templates><summary>Load a template ${tip('Generic starting points for parents at three effort levels. Lite is a usable parent for little effort, decent is a solid parent for moderate effort, and godly stacks on everything possible.')}</summary>
    <div class="template-picker"><label class="goal-field">Template<select data-goal-template .value=${live(view.goalTemplateId)} @change=${(e: Event) => { view.goalTemplateId = selectValue(e); }}>${options(items, view.goalTemplateId)}</select></label>
    <button class="small" data-action="load-goal-template" ?disabled=${!template} @click=${() => { if (template) void loadTemplate(template); }}>Load</button></div>
    ${template ? preview(template) : nothing}
  </details>`;
}
