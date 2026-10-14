// Target white sparks: the skills the finished parent should carry, in a collapsible group per role. Each group has
// its own search box that adds to that role, an inline list of names, and the editor for the selected name on a full
// row under that name's line.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import { isGold, isNormalOrGold, type Skill } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import type { Target } from '../../model/sparks.ts';
import { emptyLineage, hasWhiteSpark, lineageCount, lineageStars, resolveTarget, withLineageCopies, withLineageStars, type Lineage } from '../../model/sparks.ts';
import { goalFamily, sanitizePriority, type WhiteTarget } from '../../model/goal-input.ts';
import { UMA_LABELS } from '../../model/inherit.ts';
import { LINEAGE_SLOTS, STARS_PER_SPARK_MAX, UMAS_PER_PARENT_SIDE } from '../../model/rules.ts';
import { data, store, update, view } from '../context.ts';
import { LABEL } from '../copy.ts';
import { inputNumber, isOpen, matchesWords, numbered, options, queryWords, selectValue } from '../form.ts';
import { searchBox, SUGGESTION_LIMIT } from '../fields.ts';
import { probability, skillIcon } from '../format.ts';
import { tip } from '../tooltip.ts';

const WHITE_TARGETS_TIP = 'The white skills you want the finished parent to carry as sparks. A card that gives the skill or its gold form counts as a source. Each group adds through its own search. Select a name to edit its goal and lineage, and select it again to close. Closing a group also closes its editor.';
const SEARCH_PLACEHOLDERS = { required: 'Add a required skill…', preferred: 'Add a preferred skill…' };
const SEARCH_LABELS = { required: 'Search skills to add as required', preferred: 'Search skills to add as preferred' };
const ROLE_LABELS = { required: 'Required', preferred: 'Preferred' };

type Role = 'required' | 'preferred';
const ROLES: readonly Role[] = ['required', 'preferred'];
const QUERY_FIELD = { required: 'requiredQuery', preferred: 'preferredQuery' } as const;
/** How many names a closed group previews in its summary. */
const PEEK = 4;

const targetable = data.skills.filter((s) => !s.unreleasedEn && isNormalOrGold(s) && goalFamily(s.id, data) === resolveTarget(s.id, data)?.id);

/** Skills whose official or GameTora name holds every word of the query. */
function matchTargets(query: string): Skill[] {
  const words = queryWords(query);
  return words.length ? targetable.filter((s) => matchesWords(words, s.name) || matchesWords(words, s.altName ?? '')).slice(0, SUGGESTION_LIMIT) : [];
}
/** Add a skill's family to a role and open its editor; a target already listed moves to that role instead. */
function addTarget(id: number, role: Role) {
  const base = goalFamily(id, data);
  if (base === null) return;
  view[QUERY_FIELD[role]] = ''; view.targetEditorId = base;
  update((s) => {
    const existing = s.run.targets.find((t) => t.id === base);
    if (existing) existing.role = role; else s.run.targets.push({ id: base, role, stars: 2, priority: 0 });
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
}
const entryOf = (id: number) => store.run.targets.find((t) => t.id === id);
const editTarget = (id: number, fn: (t: WhiteTarget) => void) => update((s) => { const t = s.run.targets.find((r) => r.id === id); if (t) fn(t); });
function editLineage(id: number, edit: (l: Lineage) => Lineage) {
  update((s) => {
    const next = edit(s.run.targetLineage[String(id)] ?? emptyLineage());
    if (lineageCount(next) === 0) delete s.run.targetLineage[String(id)]; else s.run.targetLineage[String(id)] = next;
  });
}
const lineageOf = (id: number): Lineage => store.run.targetLineage[String(id)] ?? emptyLineage();
const toggleLineageParents = () => { view.showLineageParents = !view.showLineageParents; };

const STAR_CHOICES = numbered([1, 2, 3], (n) => `${n}★+`);
const isSelected = (t: Target) => view.targetEditorId === t.id;

function nameButton(t: Target) {
  const entry = entryOf(t.id)!;
  const suffix = !hasWhiteSpark(t) ? html`<span class="tag warn">No white spark</span>`
    : entry.role === 'required' ? html`<b class="target-name-stars">${entry.stars}★+</b>` : html`<span class="sub-note">P${entry.priority}</span>`;
  return html`<button class="target-name ${isSelected(t) ? 'selected' : ''}" data-action="select-target" data-id=${t.id} aria-expanded=${isSelected(t)} aria-controls="target-editor" @click=${() => selectTarget(t.id)}>
    <img src=${skillIcon(t.white ?? t.gold ?? undefined)} alt="" />${t.name}${suffix}</button>`;
}

const SIDES = [0, 1] as const;
const UMAS = Array.from({ length: UMAS_PER_PARENT_SIDE }, (_, i) => i);
const COPY_CHOICES = numbered(Array.from({ length: LINEAGE_SLOTS + 1 }, (_, n) => n), (n) => `${n}×`);
const UMA_STAR_CHOICES = [{ value: '0', label: '—' }, ...numbered([1, 2, 3], (n) => `${n}★`)];

/** The copy count and star total; the total's choices run from one star per copy to the maximum, and it is disabled without copies. */
function lineageTotals(id: number, l: Lineage) {
  const n = lineageCount(l), stars = lineageStars(l);
  const starChoices = numbered(Array.from({ length: STARS_PER_SPARK_MAX * n - n + 1 }, (_, i) => n + i), (i) => `${i}★`);
  return html`<div class="target-lineage-totals">
    <label>Copies <select data-lineage-copies=${id} aria-label="Copies in lineage" .value=${live(String(n))} @change=${(e: Event) => editLineage(id, (current) => withLineageCopies(current, Number(selectValue(e))))}>${options(COPY_CHOICES, String(n))}</select></label>
    <label>Total stars <select data-lineage-stars=${id} aria-label="Total stars in lineage" ?disabled=${!n} .value=${live(String(stars))} @change=${(e: Event) => editLineage(id, (current) => withLineageStars(current, Number(selectValue(e))))}>${options(starChoices, String(stars))}</select></label>
  </div>`;
}
function lineageParents(id: number, l: Lineage) {
  const copies = lineageCount(l);
  return html`<div class="per-parent white" id="target-lineage-parents" data-lineage-parents=${id}>
    ${SIDES.map((side) => html`<div class="side p${side + 1}"><span class="side-head">Parent ${side + 1}</span>
      ${UMAS.map((ui) => { const i = side * UMAS_PER_PARENT_SIDE + ui, v = String(l[i]); return html`<span class="who">${UMA_LABELS[ui]}</span>
        <select class=${l[i] ? 'set' : ''} data-lineage-uma="${id}-${i}" aria-label="Parent ${side + 1} ${UMA_LABELS[ui]} stars" .value=${live(v)} @change=${(e: Event) => { const stars = Number(selectValue(e)); editLineage(id, (current) => current.map((was, j) => j === i ? stars : was)); }}>${options(UMA_STAR_CHOICES, v)}</select>`; })}
    </div>`)}
  </div>
  <p class="small muted target-lineage-summary" data-lineage-summary=${id}>${copies} ${copies === 1 ? 'copy' : 'copies'} · ${lineageStars(l)}★ total</p>`;
}

function editor(c: RunPlan, t: Target) {
  const entry = entryOf(t.id)!;
  const required = entry.role === 'required';
  const l = lineageOf(t.id), perParent = view.showLineageParents;
  const own = (c.existing.sources.get(t.id) ?? []).filter((s) => s.kind !== 'lineage');
  const lineageTip = `Copies of this white spark already in the lineage: how many of the six umas (each parent and her two grandparents) carry it, and their star total. Each copy rolls for the hint at both inspiration events, and each copy multiplies the spark chance by ×${store.settings.lineageSparkMultiplier}. Totals fill the parents first, then the grandparents; "Per parent" sets each uma instead.`;
  const goalControl = required
    ? html`<label class="target-stars">${LABEL.minimumStars} <select data-target-stars=${t.id} .value=${live(String(entry.stars))} @change=${(e: Event) => editTarget(t.id, (r) => { r.stars = Number(selectValue(e)); })}>${options(STAR_CHOICES, String(entry.stars))}</select></label>`
    : html`<label class="target-stars">Priority ${tip('Lower numbers give more weight: priority 0 = 1, priority 1 = 0.5, priority 2 = 0.25. Preferred white sparks count at any star level. Several lower-weight sparks can outweigh one higher-weight spark. This does not change the prioritized-skills list.')}
        <input type="number" min="0" max=${Number.MAX_SAFE_INTEGER} step="1" data-target-priority=${t.id} .value=${live(String(entry.priority))} @change=${(e: Event) => editTarget(t.id, (r) => { r.priority = sanitizePriority(inputNumber(e)); })} /></label>`;
  return html`<div class="target-editor" id="target-editor" data-target-editor=${t.id}>
    <div class="target-editor-name"><b>${t.name}</b>${tip(`${(t.white ?? t.gold)?.desc ?? ''}\n\n${t.gold ? `Gold form: ${t.gold.name}.` : 'This skill has no gold form.'}`)}
      ${own.length ? html`<span class="tag ok">from trainee</span>${tip(own.map((s) => `${s.detail}: ${probability(s.pObtain)}`).join('\n'))}` : nothing}
      <button class="small target-remove" data-action="remove-target" data-id=${t.id} aria-label="Remove ${t.name}" @click=${() => removeTarget(t.id)}>Remove</button></div>
    ${!hasWhiteSpark(t) ? html`<p class="small warn" data-target-unsupported>This skill has no released white spark. Its target and saved lineage are kept for review. Its spark chance is zero, and the lineage gives no hints.</p>` : nothing}
    <div class="target-editor-goals"><h3>Goals for target white spark</h3>
      <div class="target-editor-controls"><div class="target-roles" role="group" aria-label="Goal for ${t.name}">
        ${ROLES.map((role) => html`<button data-target-role=${role} data-id=${t.id} class=${entry.role === role ? 'active' : ''} aria-pressed=${entry.role === role} @click=${() => editTarget(t.id, (r) => { r.role = role; })}>${ROLE_LABELS[role]}</button>`)}
      </div>${goalControl}</div>
    </div>
    <div class="target-editor-lineage">
      <div class="target-lineage-head"><h3>White sparks in lineage${tip(lineageTip)}</h3>
        <button class="small ${perParent ? 'active' : ''}" data-action="toggle-lineage-parents" aria-pressed=${perParent} aria-expanded=${perParent} aria-controls="target-lineage-parents" data-tip="Enter the stars on each parent and grandparent instead of the totals" @click=${toggleLineageParents}>Per parent</button></div>
      ${perParent ? lineageParents(t.id, l) : lineageTotals(t.id, l)}
    </div>
  </div>`;
}

function search(role: Role) {
  const field = QUERY_FIELD[role];
  return searchBox<Skill>({
    id: `target-search-${role}`, label: SEARCH_LABELS[role], placeholder: SEARCH_PLACEHOLDERS[role], field, items: matchTargets(view[field]), key: (s) => s.id, action: 'add-target',
    row: (s) => { const fam = resolveTarget(s.id, data); return html`<img src="${skillIcon(s)}" alt="" />${s.name}<span class="suggest-r">${isGold(s) ? 'gold' : `white${fam?.gold ? ` · gold: ${fam.gold.name}` : ''}`}</span>`; },
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
    const open = isOpen(e);
    if (open === stored) return;
    if (!open && holdsSelected) view.targetEditorId = null;
    view.targetGroupsOpen = { ...view.targetGroupsOpen, [role]: open };
  };
  return html`<details class="target-group" data-target-group=${role} ?open=${stored || holdsSelected} @toggle=${onToggle}>
    <summary><span class="sub-note" data-target-count=${role}>${targets.length}</span>${ROLE_LABELS[role]}
      <span class="target-peek">${targets.slice(0, PEEK).map((t) => t.name).join(', ')}${targets.length > PEEK ? ', …' : ''}</span></summary>
    <div class="target-search">${search(role)}</div>
    ${targets.length ? html`<div class="target-list">${repeat(targets, (t) => t.id, (t) => html`${nameButton(t)}${isSelected(t) ? editor(c, t) : nothing}`)}</div>` : nothing}
  </details>`;
}

export function renderTargets(c: RunPlan) {
  return html`<fieldset class="goal-group" id="goal-white-targets"><legend>Target white sparks${tip(WHITE_TARGETS_TIP)}</legend>
    ${ROLES.map((role) => group(c, role))}
  </fieldset>`;
}
