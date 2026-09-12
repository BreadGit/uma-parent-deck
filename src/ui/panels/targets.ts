// Target white sparks: the skills the finished parent should carry, grouped by role, each with the copies already
// in the lineage. One editor opens inline under the selected chip's row.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import type { Skill } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import type { Target } from '../../model/sparks.ts';
import { hasWhiteSpark, lineageCount, NO_LINEAGE, resolveTarget, type Lineage } from '../../model/sparks.ts';
import { goalFamily, sanitizePriority } from '../../model/goal-input.ts';
import { LINEAGE_MAX_PER_SIDE, STARS_PER_SPARK_MAX } from '../../model/rules.ts';
import { data, refresh, store, update, view } from '../context.ts';
import { COPY } from '../copy.ts';
import { inputNumber, numbered, options, searchBox, selectValue } from '../fields.ts';
import { probability, skillIcon } from '../format.ts';
import { tip } from '../tooltip.ts';

const targetable = data.skills.filter((s) => !s.unreleasedEn && (s.rarity === 1 || s.rarity === 2) && !s.name.includes('×') && goalFamily(s.id, data) === resolveTarget(s.id, data)?.id);

function matches(): Skill[] {
  const q = view.query.trim().toLowerCase();
  return q ? targetable.filter((s) => s.name.toLowerCase().includes(q) || (s.altName ?? '').toLowerCase().includes(q)).slice(0, 12) : [];
}
function addTarget(id: number) {
  const base = goalFamily(id, data);
  if (base === null) return;
  view.query = ''; view.targetEditorId = base;
  update((s) => {
    if (!s.run.targets.some((t) => t.id === base)) s.run.targets.push({ id: base, role: 'preferred', stars: 2, priority: 0 });
  });
}
function removeTarget(id: number) {
  if (view.targetEditorId === id) view.targetEditorId = null;
  update((s) => {
    s.run.targets = s.run.targets.filter((t) => t.id !== id);
    delete s.run.targetLineage[String(id)];
  });
}
function selectTarget(id: number) {
  view.targetEditorId = view.targetEditorId === id ? null : id;
  refresh();
}
const entryOf = (id: number) => store.run.targets.find((t) => t.id === id);
const editTarget = (id: number, fn: (t: NonNullable<ReturnType<typeof entryOf>>) => void) => update((s) => { const t = s.run.targets.find((r) => r.id === id); if (t) fn(t); });
/** Change how many umas on one parent side carry the spark; the star total follows unless already set. */
function setLineageCount(id: number, side: 'k1' | 'k2', k: number) {
  update((s) => {
    const cur = s.run.targetLineage[String(id)] ?? NO_LINEAGE;
    const pSide = side === 'k1' ? 'p1' : 'p2';
    const next: Lineage = { ...cur, [side]: k };
    next[pSide] = k === 0 ? 0 : Math.min(STARS_PER_SPARK_MAX * k, Math.max(k, cur[pSide] || STARS_PER_SPARK_MAX * k));
    if (lineageCount(next) === 0) delete s.run.targetLineage[String(id)]; else s.run.targetLineage[String(id)] = next;
  });
}
function setLineageStars(id: number, side: 'p1' | 'p2', stars: number) {
  update((s) => { const cur = s.run.targetLineage[String(id)]; if (cur) s.run.targetLineage[String(id)] = { ...cur, [side]: stars }; });
}

const STAR_CHOICES = numbered([1, 2, 3], (n) => `${n}★+`);

function chip(t: Target) {
  const entry = entryOf(t.id)!;
  const required = entry.role === 'required';
  const detail = !hasWhiteSpark(t) ? COPY.targets.noWhite : required ? `Required · ${entry.stars}★+` : `Preferred · priority ${entry.priority}`;
  return html`<span class="target-token target-row ${view.targetEditorId === t.id ? 'selected' : ''}">
    <button class="target-token-select" data-action="select-target" data-id=${t.id} aria-expanded=${view.targetEditorId === t.id} aria-controls="target-editor" @click=${() => selectTarget(t.id)}>
      <img src=${skillIcon(t.white ?? t.gold ?? undefined)} alt="" /><span>${t.name}<small class=${required ? 'required' : ''}>${detail}</small></span>
    </button><button class="target-token-remove" data-action="remove-target" data-id=${t.id} aria-label="Remove ${t.name}" @click=${() => removeTarget(t.id)}>×</button>
  </span>`;
}

function lineageSide(id: number, side: 0 | 1, l: Lineage) {
  const k = side === 0 ? 'k1' : 'k2', p = side === 0 ? 'p1' : 'p2';
  const copies = numbered(Array.from({ length: LINEAGE_MAX_PER_SIDE + 1 }, (_, n) => n), (n) => `${n}×`);
  const stars = numbered(Array.from({ length: STARS_PER_SPARK_MAX * l[k] + 1 }, (_, i) => i).filter((i) => i >= l[k]), (i) => `${i}★`);
  return html`<div><span>Parent ${side + 1}</span>
    <select aria-label="Parent ${side + 1} copies" data-lineage-k=${id} data-side=${k} .value=${live(String(l[k]))} @change=${(e: Event) => setLineageCount(id, k, Number(selectValue(e)))}>${options(copies, String(l[k]))}</select>
    <select aria-label="Parent ${side + 1} total stars" data-lineage-p=${id} data-side=${p} ?disabled=${!l[k]} .value=${live(String(l[p]))} @change=${(e: Event) => setLineageStars(id, p, Number(selectValue(e)))}>${options(stars, String(l[p]))}</select>
  </div>`;
}

function editor(c: RunPlan, t: Target) {
  const entry = entryOf(t.id)!;
  const required = entry.role === 'required';
  const l = store.run.targetLineage[String(t.id)] ?? NO_LINEAGE;
  const own = (c.existing.sources.get(t.id) ?? []).filter((s) => s.kind !== 'lineage');
  const goalControl = required
    ? html`<label class="target-stars">${COPY.goal.minimumStars} <select data-target-stars=${t.id} .value=${live(String(entry.stars))} @change=${(e: Event) => editTarget(t.id, (r) => { r.stars = Number(selectValue(e)); })}>${options(STAR_CHOICES, String(entry.stars))}</select></label>`
    : html`<label class="target-stars">Priority ${tip(COPY.targets.priorityTip)}
        <input type="number" min="0" max=${Number.MAX_SAFE_INTEGER} step="1" data-target-priority=${t.id} .value=${live(String(entry.priority))} @change=${(e: Event) => editTarget(t.id, (r) => { r.priority = sanitizePriority(inputNumber(e)); })} /></label>`;
  return html`<div class="target-editor" id="target-editor" data-target-editor=${t.id}>
    <div class="target-editor-name"><b>${t.name}</b>${tip(`${(t.white ?? t.gold)?.desc ?? ''}\n\n${t.gold ? `Gold form: ${t.gold.name}.` : 'This skill has no gold form.'}`)}
      ${own.length ? html`<span class="tag ok">${COPY.targets.fromTrainee}</span>${tip(own.map((s) => `${s.detail}: ${probability(s.pObtain)}`).join('\n'))}` : nothing}</div>
    ${!hasWhiteSpark(t) ? html`<p class="small warn" data-target-unsupported>${COPY.targets.unsupported}</p>` : nothing}
    <div class="target-editor-goals"><h3>${COPY.targets.goalsHeading}</h3>
      <div class="target-editor-controls"><div class="target-roles" role="group" aria-label="Goal for ${t.name}">
        ${(['required', 'preferred'] as const).map((role) => html`<button data-target-role=${role} data-id=${t.id} class=${entry.role === role ? 'active' : ''} aria-pressed=${entry.role === role} @click=${() => editTarget(t.id, (r) => { r.role = role; })}>${role === 'required' ? COPY.targets.required : COPY.targets.preferred}</button>`)}
      </div>${goalControl}</div>
    </div>
    <div class="target-editor-lineage"><h3>${COPY.targets.lineageHeading}${tip(COPY.targets.lineageTip(store.settings.lineageSparkMultiplier))}</h3>
      <div class="target-lineage-fields">${lineageSide(t.id, 0, l)}${lineageSide(t.id, 1, l)}</div>
    </div>
  </div>`;
}

/** One role's chips; the editor follows the selected chip so it opens under that chip's row. */
function group(c: RunPlan, role: 'required' | 'preferred', targets: Target[]) {
  if (!targets.length) return nothing;
  const label = role === 'required' ? COPY.targets.required : COPY.targets.preferred;
  return html`<div class="target-group" data-target-group=${role}>
    <h3>${label} <span class="sub-note">${targets.length}</span></h3>
    <div class="target-tokens">${repeat(targets, (t) => t.id, (t) => html`${chip(t)}${view.targetEditorId === t.id ? editor(c, t) : nothing}`)}</div>
  </div>`;
}

export function renderTargets(c: RunPlan) {
  const byRole = (role: 'required' | 'preferred') => c.targets.filter((t) => entryOf(t.id)?.role === role);
  const required = byRole('required');
  return html`<fieldset class="goal-group" id="goal-white-targets"><legend>${COPY.targets.legend}${tip(COPY.targets.tip)} <span class="sub-note" data-required-count>${required.length} required</span></legend>
    ${searchBox<Skill>({
      id: 'target-search', placeholder: COPY.targets.placeholder, field: 'query', items: matches(), key: (s) => s.id, action: 'add-target',
      row: (s) => { const fam = resolveTarget(s.id, data); return html`<img src="${skillIcon(s)}" alt="" />${s.name}<span class="suggest-r">${s.rarity === 2 ? 'gold' : 'white'}${fam?.gold && s.rarity === 1 ? ` · gold: ${fam.gold.name}` : ''}</span>`; },
      pick: (s) => addTarget(s.id),
    })}
    ${c.targets.length ? html`${group(c, 'required', required)}${group(c, 'preferred', byRole('preferred'))}` : html`<p class="small muted">${COPY.targets.none}</p>`}
  </fieldset>`;
}
