// The legacy screen: what the game shows before a run. Per stat, each parent's "+XX" start gain from her side's
// blue sparks, the trainee's start value, and the aptitude table with the surface, distance, and style overrides. The
// "By stars" form underneath enters the same sparks per uma, for a parent read off a database instead of the screen.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { STATS, type AptKey, type Grade, type Stat } from '../../types.ts';
import { APTITUDE_KEYS, APTITUDE_LABELS, emptyPinkLineage } from '../../model/goal-input.ts';
import type { RunPlan } from '../../model/run.ts';
import { defaultParentSparks, inheritedFromGain, START_GAINS, UMA_LABELS, withParentGain, type BlueSpark } from '../../model/inherit.ts';
import { BLUE_SPARK_INSPIRATION_RANGE_BY_STARS, BLUE_SPARK_START_UNCAP_BY_STARS, STARS_PER_SPARK_MAX, UMAS_PER_PARENT_SIDE } from '../../model/rules.ts';
import { data, refresh, store, update, view } from '../context.ts';
import { capitalize, num, statIcon } from '../format.ts';
import { panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

const PARENTS = [0, 1];
const UMAS = [0, 1, 2];
const STAR_OPTIONS = [1, 2, 3];
const ROWS: [string, AptKey[]][] = [['Track', ['turf', 'dirt']], ['Distance', ['sprint', 'mile', 'medium', 'long']], ['Style', ['front', 'pace', 'late', 'end']]];
/** S is not offered: the pre-run screen cannot show it (only an inspiration event reaches S) and it wins races like A. */
const GRADES: Grade[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
/** Stars a uma gets when her stat is picked in the form; rental parents on the databases are mostly 3★. */
const NEW_SPARK_STARS = STARS_PER_SPARK_MAX;

function setGain(pi: number, si: number, gain: number) {
  update((s) => { s.run.parentSparks = s.run.parentSparks.map((p, j) => (j === pi ? withParentGain(p, si, gain) : p)); });
}
/**
 * Change one uma's spark. A stat on an empty slot starts at NEW_SPARK_STARS. The form never empties a slot (every real
 * uma has a spark; only the "+0" dropdown does), and stars alone cannot fill one, so those edits are ignored.
 */
function setSpark(pi: number, ui: number, patch: { stat?: Stat; stars?: number }) {
  const cur = store.run.parentSparks[pi]![ui] ?? null;
  const stat = patch.stat ?? cur?.stat;
  const stars = patch.stars ?? cur?.stars ?? NEW_SPARK_STARS;
  if (!STATS.includes(stat as Stat) || !STAR_OPTIONS.includes(stars)) return;
  const next: BlueSpark = { stat: stat as Stat, stars };
  update((s) => { s.run.parentSparks = s.run.parentSparks.map((p, j) => (j === pi ? p.map((u, k) => (k === ui ? next : u)) : p)); });
}
/** An override equal to the trainee's own grade is just the base again. */
function setAptitude(k: AptKey, grade: Grade) {
  update((s) => {
    const t = s.run.traineeCardId != null ? data.charByCardId.get(s.run.traineeCardId) : null;
    if (t && t.aptitudes[k] === grade) delete s.run.aptOverrides[k]; else s.run.aptOverrides[k] = grade;
  });
}

const gainSelect = (c: RunPlan, pi: number, si: number) => {
  // Empty slots and this stat's current sparks are available without changing another stat.
  const available = UMAS_PER_PARENT_SIDE - store.run.parentSparks[pi]!.filter((s) => s && s.stat !== STATS[si]).length;
  return html`<select class="gain p${pi + 1} ${c.parentGains[pi]![si] ? 'set' : ''}" data-gain="${pi}-${si}" title="Parent ${pi + 1}" .value=${live(String(c.parentGains[pi]![si]))} @change=${(e: Event) => setGain(pi, si, Number((e.target as HTMLSelectElement).value))}>
    ${START_GAINS.map((g) => html`<option class=${g.stars.length > available ? 'dim' : ''} value="${g.gain}" ?selected=${c.parentGains[pi]![si] === g.gain}>+${g.gain}</option>`)}</select>`;
};

/**
 * One uma's row in the "By stars" form: who she is, the stat her blue spark raises, and its stars. An empty slot
 * (its stat was set to +0 above) shows "—" in both selects, offers no "—" once a stat is picked, and keeps the stars
 * select disabled until then.
 */
const sparkRow = (pi: number, ui: number) => {
  const spark = store.run.parentSparks[pi]![ui] ?? null;
  return html`<span class="who">${UMA_LABELS[ui]}</span>
    <select data-spark-stat="${pi}-${ui}" .value=${live(spark?.stat ?? '')} @change=${(e: Event) => setSpark(pi, ui, { stat: (e.target as HTMLSelectElement).value as Stat })}>
      ${spark ? nothing : html`<option value="" selected>—</option>`}
      ${STATS.map((st) => html`<option value="${st}" ?selected=${spark?.stat === st}>${capitalize(st)}</option>`)}</select>
    <select data-spark-stars="${pi}-${ui}" ?disabled=${!spark} .value=${live(spark ? String(spark.stars) : '')} @change=${(e: Event) => setSpark(pi, ui, { stars: Number((e.target as HTMLSelectElement).value) })}>
      ${spark ? nothing : html`<option value="" selected>—</option>`}
      ${STAR_OPTIONS.map((k) => html`<option value="${k}" ?selected=${spark?.stars === k}>${k}★</option>`)}</select>`;
};
const sparksForm = () => html`<div class="legacy-sparks" data-sparks-form>
  ${PARENTS.map((pi) => html`<div class="side p${pi + 1}"><div class="side-head">Parent ${pi + 1}${pi === 0 ? tip(SPARKS_TIP) : nothing}</div>${UMAS.map((ui) => sparkRow(pi, ui))}</div>`)}
</div>`;

/** Clear the entered sparks and restore the trainee's own aptitudes. */
const resetLegacy = () => update((s) => { s.run.parentSparks = PARENTS.map(() => defaultParentSparks()); s.run.aptOverrides = {}; s.run.pinkLineage = emptyPinkLineage(); });
const toggleSparks = () => { view.showSparks = !view.showSparks; refresh(); };

const PANEL_TIP = 'Copy the game\'s legacy screen, shown before the run starts: the "+XX" each parent adds above every stat, and the aptitudes after inheritance. "By stars" enters the blue spark of each uma instead, for a parent found on a database.';
const GAINS_TIP = `The "+XX" above each stat on the legacy screen, per parent. Each value decodes to the blue sparks behind it. One parent side has ${UMAS_PER_PARENT_SIDE} umas (the parent and her two grandparents) with one blue spark each. Dimmed choices need sparks already assigned to other stats. You can still select them. They take those sparks, fewest stars first, so the other gains drop. +0 is always available; Reset clears all gains to +0.`;
const SPARKS_TIP = `Each parent and her two grandparents carry one blue spark: a stat and 1 to ${STARS_PER_SPARK_MAX} stars, as a database lists them. The "+XX" above each stat follows from these. A slot shows — after its stat was set to +0 above; every real uma has a spark, so pick her stat to fill it.`;
const LATER_TIP = `Expected extra stat from the two inspiration events, from the sparks behind each +XX. A 3★ spark procs at 90%, 2★ at 80%, 1★ at 70%, times (1 + affinity/100) with the affinity from the advanced settings. Each proc rolls 1 to ${BLUE_SPARK_INSPIRATION_RANGE_BY_STARS[1]![1]} for 1★, 1 to ${BLUE_SPARK_INSPIRATION_RANGE_BY_STARS[2]![1]} for 2★, 1 to ${BLUE_SPARK_INSPIRATION_RANGE_BY_STARS[3]![1]} for 3★; the average assumed per star is an advanced setting. Each spark also raises the stat's cap at the start by +${BLUE_SPARK_START_UNCAP_BY_STARS[1]} / +${BLUE_SPARK_START_UNCAP_BY_STARS[2]} / +${BLUE_SPARK_START_UNCAP_BY_STARS[3]} by stars.`;
const APT_TIP = 'Copy all grades from the legacy screen after selecting both parents. The agenda uses the starting surface and distance grades. Parent goals also use style grades and the pink lineage below to estimate B-to-A increases at inspiration events. S is reached only during a career.';

function pinkForm() {
  return html`<details class="goal-pink-lineage" ?open=${true}><summary>Pink sparks in the six-uma lineage</summary>
    <p class="small muted">Enter each uma's pink spark for the goal estimate. Unknown entries stay unknown. Affinity uses the advanced setting.</p>
    ${PARENTS.map((pi) => html`<div class="goal-pink-side"><b>Parent ${pi + 1} side</b>${UMAS.map((ui) => {
      const index = pi * 3 + ui, spark = store.run.pinkLineage[index];
      return html`<div class="goal-pink-row"><span>${UMA_LABELS[ui]}</span>
        <select aria-label="Parent ${pi + 1} ${UMA_LABELS[ui]} pink aptitude" data-pink-lineage=${index} .value=${live(spark?.aptitude ?? '')} @change=${(e: Event) => update((s) => { const key = (e.target as HTMLSelectElement).value as AptKey; s.run.pinkLineage[index] = key ? { aptitude: key, stars: spark?.stars ?? 2 } : null; })}>
          <option value="">Unknown</option>${APTITUDE_KEYS.map((k) => html`<option value=${k} ?selected=${spark?.aptitude === k}>${APTITUDE_LABELS[k]}</option>`)}
        </select>
        <select aria-label="Parent ${pi + 1} ${UMA_LABELS[ui]} pink stars" data-pink-lineage-stars=${index} ?disabled=${!spark} .value=${live(spark ? String(spark.stars) : '')} @change=${(e: Event) => update((s) => { const cur = s.run.pinkLineage[index]; if (cur) cur.stars = Number((e.target as HTMLSelectElement).value); })}>
          ${spark ? nothing : html`<option value="">?</option>`}${STAR_OPTIONS.map((n) => html`<option value=${n} ?selected=${spark?.stars === n}>${n}★</option>`)}
        </select>
      </div>`;
    })}</div>`)}
  </details>`;
}

export function renderLegacy(c: RunPlan) {
  const t = c.trainee;
  const body = t ? html`
    ${store.run.goal.enabled ? pinkForm() : nothing}
    ${view.showSparks ? sparksForm() : nothing}
    <div class="legacy-legend"><span class="p1">Parent 1</span><span class="p2">Parent 2</span><span>start gain per stat${tip(GAINS_TIP)}</span></div>
    <div class="legacy-stats">${STATS.map((st, i) => {
      const gains = PARENTS.map((pi) => c.parentGains[pi]![i]!);
      const start = gains[0]! + gains[1]!;
      const parts = PARENTS.map((pi) => inheritedFromGain(gains[pi]!, store.settings));
      const later = parts.reduce((a, x) => a + x.inspiration, 0);
      const max = parts.reduce((a, x) => a + x.inspirationMax, 0);
      return html`<div class="legacy-stat">
        <div class="gains">${PARENTS.map((pi) => gainSelect(c, pi, i))}</div>
        <div class="head">${statIcon(st)}${capitalize(st)}</div>
        <div class="body"><div class="v">${t.baseStats[i]! + start}</div><div class="sub">base ${t.baseStats[i]}</div><div class="sub" title="${max ? `at most +${max}` : ''}">≈+${num(later)} later${i === 0 ? tip(LATER_TIP) : nothing}</div></div>
      </div>`; })}</div>
    <div class="legacy-apts">
      ${ROWS.map(([label, keys], ri) => html`<div class="rowlbl">${label}${ri === 0 ? tip(APT_TIP) : nothing}</div><div class="cells">${keys.map((k) => html`<span class="cell ${store.run.aptOverrides[k] ? 'over' : ''}">${APTITUDE_LABELS[k]} <select data-apt="${k}" .value=${live(c.apt[k] === 'S' ? 'A' : c.apt[k])} @change=${(e: Event) => setAptitude(k, (e.target as HTMLSelectElement).value as Grade)}>${GRADES.map((g) => html`<option value="${g}" ?selected=${(c.apt[k] === 'S' ? 'A' : c.apt[k]) === g}>${g}</option>`)}</select></span>`)}</div>`)}
    </div>` : html`<div class="small muted">Pick a trainee first.</div>`;
  const actions = t ? html`<button class="small ${view.showSparks ? 'active' : ''}" data-action="toggle-sparks" aria-expanded="${view.showSparks}" title="Enter each uma's blue spark by stars instead of the +XX" @click=${toggleSparks}>By stars</button><button class="small" data-action="reset-legacy" title="Clear all gains to +0 and restore the trainee's own aptitudes" @click=${resetLegacy}>Reset</button>` : nothing;
  return panel({ title: 'Legacy', tip: PANEL_TIP, actions }, body);
}
