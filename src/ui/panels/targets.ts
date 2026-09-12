// Target white sparks: the skills the finished parent should carry, each with the copies already in the lineage.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import type { RunPlan } from '../../model/run.ts';
import { hasWhiteSpark, lineageCount, NO_LINEAGE, resolveTarget, type Lineage } from '../../model/sparks.ts';
import { goalFamily, sanitizePriority } from '../../model/goal-input.ts';
import { LINEAGE_MAX_PER_SIDE, STARS_PER_SPARK_MAX } from '../../model/rules.ts';
import { data, refresh, store, update, view } from '../context.ts';
import { pct, skillIcon } from '../format.ts';
import { tip } from '../tooltip.ts';

const targetable = data.skills.filter((s) => !s.unreleasedEn && (s.rarity === 1 || s.rarity === 2) && !s.name.includes('×') && goalFamily(s.id, data) === resolveTarget(s.id, data)?.id);

function suggestions() {
  const q = view.query.trim().toLowerCase();
  const matches = q.length >= 2 ? targetable.filter((s) => s.name.toLowerCase().includes(q) || (s.altName ?? '').toLowerCase().includes(q)).slice(0, 12) : [];
  if (!matches.length) return nothing;
  return html`<ul>${matches.map((s) => {
    const fam = resolveTarget(s.id, data);
    return html`<li data-action="add-target" data-id="${s.id}" @click=${() => addTarget(s.id)}><img src="${skillIcon(s)}" alt="" />${s.name}<span class="r">${s.rarity === 2 ? 'gold' : 'white'}${fam?.gold && s.rarity === 1 ? ` · gold: ${fam.gold.name}` : ''}</span></li>`;
  })}</ul>`;
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
function setRole(id: number, required: boolean) {
  update((s) => {
    const entry = s.run.targets.find((t) => t.id === id);
    if (entry) entry.role = required ? 'required' : 'preferred';
  });
}
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

const PANEL_TIP = 'The white skills you want the finished parent to carry as sparks. A card that gives the skill or its gold form counts as a source.';
const lineageTip = () => `Copies of this white spark already in the lineage, per parent side: how many of the three umas on that side (the parent and her two grandparents) carry it, and their star total. Each copy rolls for the hint at both inspiration events, and each copy multiplies the spark chance by ×${store.settings.lineageSparkMultiplier}.`;

export function renderTargets(c: RunPlan) {
  const starOpts = (id: number, k: number, cur: number, side: 'p1' | 'p2') => html`<select aria-label="Parent ${side === 'p1' ? 1 : 2} total stars" data-lineage-p="${id}" data-side="${side}" ?disabled=${!k} .value=${live(String(cur))} @change=${(e: Event) => setLineageStars(id, side, Number((e.target as HTMLSelectElement).value))}>
    ${Array.from({ length: STARS_PER_SPARK_MAX * k + 1 }, (_, i) => i).filter((i) => i >= k).map((i) => html`<option value="${i}" ?selected=${cur === i}>${i}★</option>`)}</select>`;
  const countOpts = (id: number, side: 'k1' | 'k2', cur: number) => html`<select aria-label="Parent ${side === 'k1' ? 1 : 2} copies" data-lineage-k="${id}" data-side="${side}" .value=${live(String(cur))} @change=${(e: Event) => setLineageCount(id, side, Number((e.target as HTMLSelectElement).value))}>
    ${Array.from({ length: LINEAGE_MAX_PER_SIDE + 1 }, (_, k) => k).map((k) => html`<option value="${k}" ?selected=${cur === k}>${k}×</option>`)}</select>`;
  const chips = repeat(c.targets, (t) => t.id, (t) => {
    const required = store.run.targets.find((r) => r.id === t.id && r.role === 'required');
    return html`<span class="target-token target-row ${view.targetEditorId === t.id ? 'selected' : ''}">
      <button class="target-token-select" data-action="select-target" data-id=${t.id} aria-expanded=${view.targetEditorId === t.id} aria-controls="target-editor" @click=${() => selectTarget(t.id)}>
        <img src=${skillIcon(t.white ?? t.gold ?? undefined)} alt="" /><span>${t.name}<small class=${required ? 'required' : ''}>${!hasWhiteSpark(t) ? 'No white spark' : required ? `Required · ${required.stars}★+` : `Preferred · priority ${store.run.targets.find((r) => r.id === t.id)!.priority}`}</small></span>
      </button><button class="target-token-remove" data-action="remove-target" data-id=${t.id} aria-label="Remove ${t.name}" title="Remove target" @click=${() => removeTarget(t.id)}>×</button>
    </span>`;
  });
  const selected = c.targets.find((t) => t.id === view.targetEditorId);
  const editor = selected ? repeat([selected], (t) => t.id, (t) => {
    const required = store.run.targets.find((r) => r.id === t.id && r.role === 'required');
    const l = store.run.targetLineage[String(t.id)] ?? NO_LINEAGE;
    const own = (c.existing.sources.get(t.id) ?? []).filter((s) => s.kind !== 'lineage');
    return html`<div class="target-editor" id="target-editor" data-target-editor=${t.id}>
      <div class="target-editor-name"><b>${t.name}</b>${tip(`${(t.white ?? t.gold)?.desc ?? ''}\n\n${t.gold ? `Gold form: ${t.gold.name}.` : 'This skill has no gold form.'}`)}
        ${own.length ? html`<span class="tag ok">from trainee</span>${tip(own.map((s) => `${s.detail}: ${pct(s.pObtain)}`).join('\n'))}` : nothing}</div>
      ${!hasWhiteSpark(t) ? html`<p class="small warn" data-target-unsupported>This skill has no released white spark. Its target and saved lineage are kept for review. Its spark chance is zero, and the lineage gives no hints.</p>` : nothing}
      <div class="target-editor-goals"><h3>Goals for target white spark</h3>
        <div class="target-editor-controls"><div class="target-roles" role="group" aria-label="Goal for ${t.name}">
          ${(['required', 'preferred'] as const).map((role) => html`<button data-target-role=${role} data-id=${t.id} class=${!!required === (role === 'required') ? 'active' : ''} aria-pressed=${!!required === (role === 'required')} @click=${() => setRole(t.id, role === 'required')}>${role === 'required' ? 'Required' : 'Preferred'}</button>`)}
        </div>${required ? html`<label class="target-stars">Minimum stars <select data-target-stars=${t.id} .value=${live(String(required.stars))} @change=${(e: Event) => update((s) => { const r = s.run.targets.find((r) => r.id === t.id); if (r) r.stars = Number((e.target as HTMLSelectElement).value); })}>
          ${[1, 2, 3].map((n) => html`<option value=${n} ?selected=${required.stars === n}>${n}★+</option>`)}</select></label>` : html`<label class="target-stars">Priority ${tip('Lower numbers give more weight: priority 0 = 1, priority 1 = 0.5, priority 2 = 0.25. Preferred white sparks count at any star level. Several lower-weight sparks can outweigh one higher-weight spark. This does not change the prioritized-skills list.')}
          <input type="number" min="0" max=${Number.MAX_SAFE_INTEGER} step="1" data-target-priority=${t.id} .value=${live(String(store.run.targets.find((r) => r.id === t.id)!.priority))} @change=${(e: Event) => update((s) => {
            const target = s.run.targets.find((r) => r.id === t.id);
            if (target) target.priority = sanitizePriority((e.target as HTMLInputElement).valueAsNumber);
          })} /></label>`}</div>
      </div>
      <div class="target-editor-lineage"><h3>White sparks in lineage${tip(lineageTip())}</h3>
        <div class="target-lineage-fields">${([0, 1] as const).map((side) => {
          const k = side === 0 ? 'k1' : 'k2', p = side === 0 ? 'p1' : 'p2';
          return html`<div><span>Parent ${side + 1}</span>${countOpts(t.id, k, l[k])}${starOpts(t.id, l[k], l[p], p)}</div>`;
        })}</div>
      </div>
    </div>`;
  }) : nothing;
  return html`<fieldset class="goal-group" id="goal-white-targets"><legend>Target white sparks${tip(PANEL_TIP)}</legend><span class="small muted" data-required-count>${store.run.targets.filter((t) => t.role === 'required').length} required</span>
    <p class="small muted">Select a skill to edit its goal and lineage. Select it again to close. Required sparks must all appear; preferred sparks are extras.</p>
    <div class="suggest">
      <input id="target-search" type="search" placeholder="Search skill name…" .value=${live(view.query)} data-input="query" class="wide" autocomplete="off"
        @input=${(e: Event) => { view.query = (e.target as HTMLInputElement).value; refresh(); }} />
      ${suggestions()}
    </div>
    <div class="target-tokens">${chips}</div>${editor}</fieldset>`;
}
