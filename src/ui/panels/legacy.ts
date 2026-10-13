// The legacy screen: what the game shows before a run. Per stat, each parent's "+XX" start gain from her side's
// blue sparks, the trainee's start value, and the aptitude table with the surface, distance, and style overrides. The
// "Blue per parent" form enters the same sparks per uma, for a parent read off a database instead of the screen, and the
// pink form enters the ancestors' pink sparks behind the aptitude grades.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { STATS, APTITUDE_KEYS, APT_GRADES, perStat, type AptKey, type Grade, type Stat, type StatIndex } from '../../types.ts';
import { APTITUDE_LABELS, emptyPinkLineage, type PinkSpark } from '../../model/goal-input.ts';
import { pinkAptitudeGrades, withPinkAptitude, withPinkLineage } from '../../model/pink-inherit.ts';
import type { RunPlan } from '../../model/run.ts';
import { defaultParentSparks, inheritedFromGain, START_GAINS, UMA_LABELS, withParentGain, type BlueSpark } from '../../model/inherit.ts';
import { BLUE_SPARK_INSPIRATION_RANGE_BY_STARS, BLUE_SPARK_START_UNCAP_BY_STARS, STARS_PER_SPARK_MAX, UMAS_PER_PARENT_SIDE } from '../../model/rules.ts';
import { data, refresh, store, update, view } from '../context.ts';
import { TITLE } from '../copy.ts';
import { numbered, options, selectValue } from '../fields.ts';
import { capitalize, num, statIcon } from '../format.ts';
import { about, panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

const BLUE_BY_STARS = 'Blue per parent';
const copy = {
  tip: `Copy the game's legacy screen, shown before the run starts: the "+XX" each parent adds above every stat, and the aptitudes after inheritance. "${BLUE_BY_STARS}" enters the blue spark of each uma instead, for a parent found on a database.`,
  byStars: BLUE_BY_STARS,
  byStarsTip: 'Enter the blue spark of each parent and grandparent instead of the +XX',
  reset: 'Reset',
  resetTip: "Clear every gain to +0 and restore the trainee's own aptitudes",
  pinkSparks: 'Pink per parent',
  pinkSparksTip: 'Enter the pink spark of each parent and grandparent for mid-run aptitude estimates',
  resetPink: 'Reset',
  resetPinkTip: "Clear pink sparks and restore the trainee's base aptitudes",
  gainsLabel: 'start gain per stat',
  gainsTip: `The "+XX" above each stat on the legacy screen, per parent. Each value decodes to the blue sparks behind it. One parent side has ${UMAS_PER_PARENT_SIDE} umas (the parent and her two grandparents) with one blue spark each. Dimmed choices need sparks already assigned to other stats; selecting one takes those sparks, fewest stars first.`,
  sparksTip: `Each parent and her two grandparents carry one blue spark: a stat and 1 to ${STARS_PER_SPARK_MAX} stars, as a database lists them. A slot shows — after its stat was set to +0 above; pick her stat to fill it.`,
  laterTip: `Expected extra stat from the two inspiration events. A 3★ spark procs at 90%, 2★ at 80%, 1★ at 70%, times (1 + affinity/100). Each proc rolls 1 to ${BLUE_SPARK_INSPIRATION_RANGE_BY_STARS[1]![1]} for 1★, 1 to ${BLUE_SPARK_INSPIRATION_RANGE_BY_STARS[2]![1]} for 2★, 1 to ${BLUE_SPARK_INSPIRATION_RANGE_BY_STARS[3]![1]} for 3★; the assumed mean per star is an advanced setting. Each spark also raises the stat's starting cap by +${BLUE_SPARK_START_UNCAP_BY_STARS[1]} / +${BLUE_SPARK_START_UNCAP_BY_STARS[2]} / +${BLUE_SPARK_START_UNCAP_BY_STARS[3]} by stars.`,
  aptTip: "Copy all grades from the legacy screen after selecting both parents. Raising a grade above the trainee's base estimates the minimum pink stars behind it.",
  planningOverride: 'Some grades are planning overrides outside starting inheritance. They still control the agenda. Pink sparks remain unchanged.',
  aboutTitle: 'How grades and pink sparks relate',
  about: [
    'The agenda uses the starting surface and distance grades. These grades already include starting increases from parent sparks.',
    "Raising a grade above the trainee's base estimates the minimum pink stars behind it. Grades outside the starting-inheritance range are planning overrides and keep the pink lineage unchanged.",
    'Dimmed grade choices need slots used by other pink sparks. Selecting one reassigns the weakest other sparks and adjusts the affected aptitudes, never below their base.',
    'Parent goals use the pink sparks to estimate mid-run increases. Unknown below-B eligibility produces a probability range. S is reached only during a career.',
  ],
  pickTrainee: 'Pick a trainee first.',
} as const;

const PARENTS = [0, 1] as const;
const UMAS = [0, 1, 2] as const;
const STAR_OPTIONS = [1, 2, 3];
const STAR_CHOICES = numbered(STAR_OPTIONS, (n) => `${n}★`);
const STAT_CHOICES = STATS.map((st) => ({ value: st, label: capitalize(st) }));
const ROWS: [string, AptKey[]][] = [['Track', ['turf', 'dirt']], ['Distance', ['sprint', 'mile', 'medium', 'long']], ['Style', ['front', 'pace', 'late', 'end']]];
/** Stars a uma gets when her spark is picked in the form; rental parents on the databases are mostly 3★. */
const NEW_SPARK_STARS = STARS_PER_SPARK_MAX;
const EMPTY = { value: '', label: '—' };

function setGain(pi: number, si: number, gain: number) {
  update((s) => { s.run.parentSparks = s.run.parentSparks.map((p, j) => (j === pi ? withParentGain(p, si, gain) : p)); });
}
/**
 * Change one uma's spark. A stat on an empty slot starts at NEW_SPARK_STARS. The form never empties a slot (every real
 * uma has a spark; only the "+0" dropdown does), and stars alone cannot fill one, so those edits are ignored.
 */
function setSpark(pi: number, ui: number, patch: { stat?: Stat; stars?: number }) {
  update((s) => {
    const cur = s.run.parentSparks[pi]![ui] ?? null;
    const stat = patch.stat ?? cur?.stat;
    const stars = patch.stars ?? cur?.stars ?? NEW_SPARK_STARS;
    if (!STATS.includes(stat as Stat) || !STAR_OPTIONS.includes(stars)) return;
    const next: BlueSpark = { stat: stat as Stat, stars };
    s.run.parentSparks = s.run.parentSparks.map((p, j) => (j === pi ? p.map((u, k) => (k === ui ? next : u)) : p));
  });
}
/** An override equal to the trainee's own grade is just the base again. */
function setAptitude(k: AptKey, grade: Grade) {
  update((s) => {
    const t = s.run.traineeCardId != null ? data.charByCardId.get(s.run.traineeCardId) : null;
    const inferred = t ? withPinkAptitude(t.aptitudes, { ...t.aptitudes, ...s.run.aptOverrides }, s.run.pinkLineage, k, grade) : null;
    if (!inferred) return;
    s.run.aptOverrides = Object.fromEntries(APTITUDE_KEYS.filter((key) => inferred.aptitudes[key] !== t!.aptitudes[key]).map((key) => [key, inferred.aptitudes[key]]));
    s.run.pinkLineage = inferred.lineage;
  });
}
/** Edit one ancestor's pink spark. */
function setPinkSpark(index: number, edit: (spark: PinkSpark | null) => PinkSpark | null) {
  update((s) => {
    const next = [...s.run.pinkLineage]; next[index] = edit(next[index] ?? null);
    const trainee = s.run.traineeCardId === null ? null : data.charByCardId.get(s.run.traineeCardId);
    if (trainee) {
      const aptitudes = withPinkLineage(trainee.aptitudes, s.run.aptOverrides, s.run.pinkLineage, next);
      s.run.aptOverrides = Object.fromEntries(APTITUDE_KEYS.filter((key) => aptitudes[key] !== trainee.aptitudes[key]).map((key) => [key, aptitudes[key]]));
    }
    s.run.pinkLineage = next;
  });
}
/** Clear the entered sparks and restore the trainee's own aptitudes. */
const resetLegacy = () => update((s) => { s.run.parentSparks = PARENTS.map(() => defaultParentSparks()); s.run.aptOverrides = {}; s.run.pinkLineage = emptyPinkLineage(); });
const resetPinkSparks = () => update((s) => { s.run.pinkLineage = emptyPinkLineage(); s.run.aptOverrides = {}; });
const toggleSparks = () => { view.showSparks = !view.showSparks; refresh(); };
const togglePinkSparks = () => { view.showPinkSparks = !view.showPinkSparks; refresh(); };

function gainSelect(c: RunPlan, pi: number, si: number) {
  // Empty slots and this stat's current sparks are available without changing another stat.
  const available = UMAS_PER_PARENT_SIDE - store.run.parentSparks[pi]!.filter((s) => s && s.stat !== STATS[si]).length;
  const current = String(c.parentGains[pi]![si]);
  const items = START_GAINS.map((g) => ({ value: String(g.gain), label: `+${g.gain}`, cls: g.stars.length > available ? 'dim' : '' }));
  return html`<select class="gain p${pi + 1} ${c.parentGains[pi]![si] ? 'set' : ''}" data-gain="${pi}-${si}" aria-label="Parent ${pi + 1} ${capitalize(STATS[si]!)} gain" .value=${live(current)} @change=${(e: Event) => setGain(pi, si, Number(selectValue(e)))}>${options(items, current)}</select>`;
}

/**
 * One uma's row in the "Blue per parent" form: who she is, the stat her blue spark raises, and its stars. An empty slot
 * (its stat was set to +0 above) shows "—" in both selects, offers no "—" once a stat is picked, and keeps the stars
 * select disabled until then.
 */
function sparkRow(pi: number, ui: number) {
  const spark = store.run.parentSparks[pi]![ui] ?? null;
  const stat = spark?.stat ?? '', stars = spark ? String(spark.stars) : '';
  return html`<span class="who">${UMA_LABELS[ui]}</span>
    <select data-spark-stat="${pi}-${ui}" aria-label="Parent ${pi + 1} ${UMA_LABELS[ui]} stat" .value=${live(stat)} @change=${(e: Event) => setSpark(pi, ui, { stat: selectValue(e) as Stat })}>${options(spark ? STAT_CHOICES : [EMPTY, ...STAT_CHOICES], stat)}</select>
    <select data-spark-stars="${pi}-${ui}" aria-label="Parent ${pi + 1} ${UMA_LABELS[ui]} stars" ?disabled=${!spark} .value=${live(stars)} @change=${(e: Event) => setSpark(pi, ui, { stars: Number(selectValue(e)) })}>${options(spark ? STAR_CHOICES : [EMPTY, ...STAR_CHOICES], stars)}</select>`;
}
const sparksForm = () => html`<div class="legacy-sparks per-parent blue" data-sparks-form>
  ${PARENTS.map((pi) => html`<div class="side p${pi + 1}"><div class="side-head">Parent ${pi + 1}${pi === 0 ? tip(copy.sparksTip) : nothing}</div>${UMAS.map((ui) => sparkRow(pi, ui))}</div>`)}
</div>`;

function pinkRow(pi: number, ui: number) {
  const index = pi * 3 + ui, spark = store.run.pinkLineage[index];
  const aptitude = spark?.aptitude ?? '', stars = spark ? String(spark.stars) : '';
  const aptitudes = [EMPTY, ...APTITUDE_KEYS.map((k) => ({ value: k, label: APTITUDE_LABELS[k] }))];
  return html`<span class="who">${UMA_LABELS[ui]}${spark?.inferred ? html`<small class="pink-inferred" data-pink-inferred=${index}>Estimated</small>` : nothing}</span>
    <select aria-label="Parent ${pi + 1} ${UMA_LABELS[ui]} pink aptitude" data-pink-lineage=${index} .value=${live(aptitude)} @change=${(e: Event) => { const key = selectValue(e) as AptKey | ''; setPinkSpark(index, (cur) => key ? { aptitude: key, stars: cur?.stars ?? NEW_SPARK_STARS } : null); }}>${options(aptitudes, aptitude)}</select>
    <select aria-label="Parent ${pi + 1} ${UMA_LABELS[ui]} pink stars" data-pink-lineage-stars=${index} ?disabled=${!spark} .value=${live(stars)} @change=${(e: Event) => { const picked = Number(selectValue(e)); setPinkSpark(index, (cur) => cur && { aptitude: cur.aptitude, stars: picked }); }}>${options(spark ? STAR_CHOICES : [EMPTY, ...STAR_CHOICES], stars)}</select>`;
}
const pinkForm = () => html`<div id="legacy-pink-sparks" data-pink-sparks-form>
  <div class="per-parent pink">${PARENTS.map((pi) => html`<div class="side p${pi + 1}"><span class="side-head">Parent ${pi + 1}</span>${UMAS.map((ui) => pinkRow(pi, ui))}</div>`)}</div>
</div>`;

function statColumn(c: RunPlan, i: StatIndex) {
  const st = STATS[i], t = c.trainee!;
  const gains = PARENTS.map((pi) => c.parentGains[pi]![i]);
  const start = gains[0]! + gains[1]!;
  const parts = PARENTS.map((pi) => inheritedFromGain(gains[pi]!, store.settings));
  const later = parts.reduce((a, x) => a + x.inspiration, 0);
  const max = parts.reduce((a, x) => a + x.inspirationMax, 0);
  return html`<div class="legacy-stat">
    <div class="gains">${PARENTS.map((pi) => gainSelect(c, pi, i))}</div>
    <div class="head">${statIcon(st)}${capitalize(st)}</div>
    <div class="body"><div class="legacy-v">${t.baseStats[i] + start}</div><div class="legacy-sub">base ${t.baseStats[i]}</div><div class="legacy-sub" data-tip=${max ? `at most +${max}` : nothing}>≈+${num(later)} later${i === 0 ? tip(copy.laterTip) : nothing}</div></div>
  </div>`;
}

function aptitudeCell(c: RunPlan, k: AptKey) {
  const t = c.trainee!;
  const current = c.apt[k] === 'S' ? 'A' : c.apt[k];
  const grades = APT_GRADES.filter((g) => g !== 'S').slice().reverse().map((g) => ({
    value: g, label: g, cls: g !== c.apt[k] && withPinkAptitude(t.aptitudes, c.apt, store.run.pinkLineage, k, g)?.adjustsOthers ? 'dim' : '',
  }));
  return html`<span class="cell ${store.run.aptOverrides[k] ? 'over' : ''}">${APTITUDE_LABELS[k]} <select data-apt="${k}" aria-label="${APTITUDE_LABELS[k]} grade" .value=${live(current)} @change=${(e: Event) => setAptitude(k, selectValue(e) as Grade)}>${options(grades, current)}</select></span>`;
}

function body(c: RunPlan) {
  const t = c.trainee!;
  const overridden = APTITUDE_KEYS.some((key) => !pinkAptitudeGrades(t.aptitudes[key]).includes(c.apt[key]));
  return html`
    ${view.showSparks ? sparksForm() : nothing}
    <div class="legacy-legend"><span class="p1">Parent 1</span><span class="p2">Parent 2</span><span>${copy.gainsLabel}${tip(copy.gainsTip)}</span></div>
    <div class="legacy-stats">${perStat((_, i) => statColumn(c, i))}</div>
    <div class="legacy-pink-controls">
      <button class="small ${view.showPinkSparks ? 'active' : ''}" data-action="toggle-pink-sparks" aria-expanded=${view.showPinkSparks} aria-controls="legacy-pink-sparks" data-tip=${copy.pinkSparksTip} @click=${togglePinkSparks}>${copy.pinkSparks}</button>
      <button class="small" data-action="reset-pink-sparks" data-tip=${copy.resetPinkTip} @click=${resetPinkSparks}>${copy.resetPink}</button>
    </div>
    ${view.showPinkSparks ? pinkForm() : nothing}
    ${overridden ? html`<p class="small warn" data-apt-planning-override>${copy.planningOverride}</p>` : nothing}
    <div class="legacy-apts">
      ${ROWS.map(([label, keys], ri) => html`<div class="rowlbl">${label}${ri === 0 ? tip(copy.aptTip) : nothing}</div><div class="cells">${keys.map((k) => aptitudeCell(c, k))}</div>`)}
    </div>
    ${about(copy.aboutTitle, copy.about)}`;
}

export function renderLegacy(c: RunPlan) {
  const actions = c.trainee ? html`
    <button class="small ${view.showSparks ? 'active' : ''}" data-action="toggle-sparks" aria-expanded="${view.showSparks}" data-tip=${copy.byStarsTip} @click=${toggleSparks}>${copy.byStars}</button>
    <button class="small" data-action="reset-legacy" data-tip=${copy.resetTip} @click=${resetLegacy}>${copy.reset}</button>` : nothing;
  return panel({ title: TITLE.legacy, step: 3, tip: copy.tip, actions }, c.trainee ? body(c) : html`<div class="small muted">${copy.pickTrainee}</div>`);
}
