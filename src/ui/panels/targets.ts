// Target white sparks: the skills the finished parent should carry, each with the copies already in the lineage.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import type { RunPlan } from '../../model/run.ts';
import { lineageCount, NO_LINEAGE, resolveTarget, type Lineage } from '../../model/sparks.ts';
import { LINEAGE_MAX_PER_SIDE, STARS_PER_SPARK_MAX } from '../../model/rules.ts';
import { data, refresh, store, update, view } from '../context.ts';
import { pct, skillIcon } from '../format.ts';
import { panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

const targetable = () => data.skills.filter((s) => !s.unreleasedEn && (s.rarity === 1 || s.rarity === 2) && !s.name.includes('×'));

function suggestions() {
  const q = view.query.trim().toLowerCase();
  const matches = q.length >= 2 ? targetable().filter((s) => s.name.toLowerCase().includes(q) || (s.altName ?? '').toLowerCase().includes(q)).slice(0, 12) : [];
  if (!matches.length) return nothing;
  return html`<ul>${matches.map((s) => {
    const fam = resolveTarget(s.id, data);
    return html`<li data-action="add-target" data-id="${s.id}" @click=${() => addTarget(s.id)}><img src="${skillIcon(s)}" alt="" />${s.name}<span class="r">${s.rarity === 2 ? 'gold' : 'white'}${fam?.gold && s.rarity === 1 ? ` · gold: ${fam.gold.name}` : ''}</span></li>`;
  })}</ul>`;
}
function addTarget(id: number) {
  const base = resolveTarget(id, data)?.id ?? id;
  view.query = '';
  update((s) => { if (!s.run.targets.includes(base)) s.run.targets.push(base); });
}
function removeTarget(id: number) {
  update((s) => { s.run.targets = s.run.targets.filter((x) => x !== id); delete s.run.targetLineage[String(id)]; });
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
  const starOpts = (id: number, k: number, cur: number, side: 'p1' | 'p2') => html`<select data-lineage-p="${id}" data-side="${side}" ?disabled=${!k} .value=${live(String(cur))} @change=${(e: Event) => setLineageStars(id, side, Number((e.target as HTMLSelectElement).value))}>
    ${Array.from({ length: STARS_PER_SPARK_MAX * k + 1 }, (_, i) => i).filter((i) => i >= k).map((i) => html`<option value="${i}" ?selected=${cur === i}>${i}★</option>`)}</select>`;
  const countOpts = (id: number, side: 'k1' | 'k2', cur: number) => html`<select data-lineage-k="${id}" data-side="${side}" .value=${live(String(cur))} @change=${(e: Event) => setLineageCount(id, side, Number((e.target as HTMLSelectElement).value))}>
    ${Array.from({ length: LINEAGE_MAX_PER_SIDE + 1 }, (_, k) => k).map((k) => html`<option value="${k}" ?selected=${cur === k}>${k}×</option>`)}</select>`;
  const chips = c.targets.length ? repeat(c.targets, (t) => t.id, (t) => {
    const l = store.run.targetLineage[String(t.id)] ?? NO_LINEAGE;
    const desc = (t.white ?? t.gold)?.desc ?? '';
    // sources the trainee brings herself (innate, awakening, her own events); lineage is entered on the chip
    const own = (c.existing.sources.get(t.id) ?? []).filter((s) => s.kind !== 'lineage');
    return html`<span class="chip target-row">
      <img src="${skillIcon(t.white ?? t.gold ?? undefined)}" alt="" /><span class="tname"><span class="txt">${t.name}</span>${tip(`${desc}${desc ? '\n\n' : ''}${t.gold ? `Gold form: ${t.gold.name}. A card that gives the gold form counts, at the higher spark rate.` : 'This skill has no gold form.'}`)}</span>
      <span class="status">${own.length ? html`<span class="tag ok">from trainee</span>${tip(`The trainee gives this herself:\n${own.map((s) => `${s.detail}: ${pct(s.pObtain)}`).join('\n')}`)}` : nothing}</span>
      <button data-action="remove-target" data-id="${t.id}" title="Remove target" @click=${() => removeTarget(t.id)}>✕</button>
      <span class="row2">
        <span class="k">Lineage${tip(lineageTip())}</span>
        <span>P1 ${countOpts(t.id, 'k1', l.k1)} ${starOpts(t.id, l.k1, l.p1, 'p1')}</span>
        <span>P2 ${countOpts(t.id, 'k2', l.k2)} ${starOpts(t.id, l.k2, l.p2, 'p2')}</span>
      </span>
    </span>`;
  }) : html`<span class="muted small">Search for a white skill to add it. A card that gives its gold form counts too.</span>`;
  return panel({ title: 'Target white sparks', tip: PANEL_TIP }, html`
    <div class="suggest">
      <input id="target-search" type="search" placeholder="Search skill name…" .value=${live(view.query)} data-input="query" class="wide" autocomplete="off"
        @input=${(e: Event) => { view.query = (e.target as HTMLInputElement).value; refresh(); }} />
      ${suggestions()}
    </div>
    <div class="chips">${chips}</div>`);
}
