// Target white sparks: the skills the finished parent should carry, in a collapsible group per role. Each group has
// its own search box that adds to that role, an inline list of names, and the editor for the selected name on a full
// row under that name's line.
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

type Role = 'required' | 'preferred';
const ROLES: readonly Role[] = ['required', 'preferred'];
const QUERY_FIELD = { required: 'requiredQuery', preferred: 'preferredQuery' } as const;
/** How many names a closed group previews in its summary. */
const PEEK = 4;

const targetable = data.skills.filter((s) => !s.unreleasedEn && (s.rarity === 1 || s.rarity === 2) && !s.name.includes('×') && goalFamily(s.id, data) === resolveTarget(s.id, data)?.id);

export function matchTargets(query: string): Skill[] {
  const q = query.trim().toLowerCase();
  return q ? targetable.filter((s) => s.name.toLowerCase().includes(q) || (s.altName ?? '').toLowerCase().includes(q)).slice(0, 12) : [];
}
/** Add a skill's family to a role and open its editor; a target already listed moves to that role instead. */
export function addTarget(id: number, role: Role) {
  const base = goalFamily(id, data);
  if (base === null) return;
  view[QUERY_FIELD[role]] = ''; view.targetEditorId = base;
  update((s) => {
    const existing = s.run.targets.find((t) => t.id === base);
    if (existing) existing.role = role; else s.run.targets.push({ id: base, role, stars: 2, priority: 0 });
  });
}
export function removeTarget(id: number) {
  if (view.targetEditorId === id) view.targetEditorId = null;
  update((s) => {
    s.run.targets = s.run.targets.filter((t) => t.id !== id);
    delete s.run.targetLineage[String(id)];
  });
}
export function selectTarget(id: number) {
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
const isSelected = (t: Target) => view.targetEditorId === t.id;

/** A target's name with its icon and either the star minimum, the priority, or a warning that it has no white spark. */
function nameButton(t: Target) {
  const entry = entryOf(t.id)!;
  const suffix = !hasWhiteSpark(t) ? html`<span class="tag warn">${COPY.targets.noWhite}</span>`
    : entry.role === 'required' ? html`<b class="target-name-stars">${entry.stars}★+</b>` : html`<span class="sub-note">P${entry.priority}</span>`;
  return html`<button class="target-name ${isSelected(t) ? 'selected' : ''}" data-action="select-target" data-id=${t.id} aria-expanded=${isSelected(t)} aria-controls="target-editor" @click=${() => selectTarget(t.id)}>
    <img src=${skillIcon(t.white ?? t.gold ?? undefined)} alt="" />${t.name}${suffix}</button>`;
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
      ${own.length ? html`<span class="tag ok">${COPY.targets.fromTrainee}</span>${tip(own.map((s) => `${s.detail}: ${probability(s.pObtain)}`).join('\n'))}` : nothing}
      <button class="small target-remove" data-action="remove-target" data-id=${t.id} aria-label="Remove ${t.name}" @click=${() => removeTarget(t.id)}>${COPY.targets.remove}</button></div>
    ${!hasWhiteSpark(t) ? html`<p class="small warn" data-target-unsupported>${COPY.targets.unsupported}</p>` : nothing}
    <div class="target-editor-goals"><h3>${COPY.targets.goalsHeading}</h3>
      <div class="target-editor-controls"><div class="target-roles" role="group" aria-label="Goal for ${t.name}">
        ${ROLES.map((role) => html`<button data-target-role=${role} data-id=${t.id} class=${entry.role === role ? 'active' : ''} aria-pressed=${entry.role === role} @click=${() => editTarget(t.id, (r) => { r.role = role; })}>${COPY.targets[role]}</button>`)}
      </div>${goalControl}</div>
    </div>
    <div class="target-editor-lineage"><h3>${COPY.targets.lineageHeading}${tip(COPY.targets.lineageTip(store.settings.lineageSparkMultiplier))}</h3>
      <div class="target-lineage-fields">${lineageSide(t.id, 0, l)}${lineageSide(t.id, 1, l)}</div>
    </div>
  </div>`;
}

/** The search box that adds to one role; the suggestion rows name the gold form a white skill upgrades into. */
function search(role: Role) {
  const field = QUERY_FIELD[role];
  return searchBox<Skill>({
    id: `target-search-${role}`, placeholder: COPY.targets.placeholder[role], field, items: matchTargets(view[field]), key: (s) => s.id, action: 'add-target',
    row: (s) => { const fam = resolveTarget(s.id, data); return html`<img src="${skillIcon(s)}" alt="" />${s.name}<span class="suggest-r">${s.rarity === 2 ? 'gold' : 'white'}${fam?.gold && s.rarity === 1 ? ` · gold: ${fam.gold.name}` : ''}</span>`; },
    pick: (s) => addTarget(s.id, role),
  });
}

/**
 * One role as a <details>, open by default. A group holding the selected target is always open, so a skill just added
 * or moved between roles is visible; the toggle event then records that. Closing a group also closes its editor.
 * An empty group still renders, for its search box.
 */
function group(c: RunPlan, role: Role) {
  const targets = c.targets.filter((t) => entryOf(t.id)?.role === role);
  const stored = view.targetGroupsOpen[role];
  const holdsSelected = targets.some(isSelected);
  const onToggle = (e: Event) => {
    const open = (e.target as HTMLDetailsElement).open;
    if (open === stored) return;
    if (!open && holdsSelected) view.targetEditorId = null;
    view.targetGroupsOpen = { ...view.targetGroupsOpen, [role]: open };
    refresh();
  };
  return html`<details class="target-group" data-target-group=${role} ?open=${stored || holdsSelected} @toggle=${onToggle}>
    <summary><span class="sub-note" data-target-count=${role}>${targets.length}</span>${COPY.targets[role]}
      <span class="target-peek">${targets.slice(0, PEEK).map((t) => t.name).join(', ')}${targets.length > PEEK ? ', …' : ''}</span></summary>
    <div class="target-search">${search(role)}</div>
    ${targets.length ? html`<div class="target-list">${repeat(targets, (t) => t.id, (t) => html`${nameButton(t)}${isSelected(t) ? editor(c, t) : nothing}`)}</div>` : nothing}
  </details>`;
}

export function renderTargets(c: RunPlan) {
  return html`<fieldset class="goal-group" id="goal-white-targets"><legend>${COPY.targets.legend}${tip(COPY.targets.tip)}</legend>
    ${ROLES.map((role) => group(c, role))}
  </fieldset>`;
}
