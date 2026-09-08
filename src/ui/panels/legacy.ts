// The legacy screen: what the game shows before a run. Per stat, each parent's "+XX" start gain from her side's
// blue sparks, the trainee's start value, and the aptitude table with the surface and distance overrides.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { STATS, type AptKey, type Grade } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import { canSetParentGain, inheritedFromGain, parentGainIssues, START_GAINS } from '../../model/inherit.ts';
import { BLUE_SPARK_INSPIRATION_RANGE_BY_STARS, BLUE_SPARK_START_UNCAP_BY_STARS, UMAS_PER_PARENT_SIDE } from '../../model/rules.ts';
import { data, store, update } from '../context.ts';
import { capitalize, num, statIcon } from '../format.ts';
import { panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

const PARENTS = [0, 1];
/**
 * Only surface and distance are shown, like the aptitude rows the tool reads. The game's table also has a running
 * style row, but independent training picks the style itself and the agenda ignores it, so offering it would only
 * invite input that changes nothing.
 */
const ROWS: [string, AptKey[]][] = [['Track', ['turf', 'dirt']], ['Distance', ['sprint', 'mile', 'medium', 'long']]];
/** S is not offered: the pre-run screen cannot show it (only an inspiration event reaches S) and it wins races like A. */
const GRADES: Grade[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

function setGain(pi: number, si: number, gain: number) {
  if (!canSetParentGain(store.run.parentGains[pi]!, si, gain)) return;
  update((s) => { s.run.parentGains = s.run.parentGains.map((p, j) => (j === pi ? p.map((g, i) => (i === si ? gain : g)) : p)); });
}
/** An override equal to the trainee's own grade is just the base again. */
function setAptitude(k: AptKey, grade: Grade) {
  update((s) => {
    const t = s.run.traineeCardId != null ? data.charByCardId.get(s.run.traineeCardId) : null;
    if (t && t.aptitudes[k] === grade) delete s.run.aptOverrides[k]; else s.run.aptOverrides[k] = grade;
  });
}

const gainSelect = (pi: number, si: number) => html`<select class="gain p${pi + 1} ${store.run.parentGains[pi]![si] ? 'set' : ''}" data-gain="${pi}-${si}" title="Parent ${pi + 1}" .value=${live(String(store.run.parentGains[pi]![si]))} @change=${(e: Event) => setGain(pi, si, Number((e.target as HTMLSelectElement).value))}>
  ${START_GAINS.map((g) => html`<option value="${g.gain}" ?disabled=${!canSetParentGain(store.run.parentGains[pi]!, si, g.gain)} ?selected=${store.run.parentGains[pi]![si] === g.gain}>+${g.gain}</option>`)}</select>`;

/** Back to a blank legacy screen: no start gains and the trainee's own aptitudes. */
const resetLegacy = () => update((s) => { s.run.parentGains = s.run.parentGains.map((p) => p.map(() => 0)); s.run.aptOverrides = {}; });

const PANEL_TIP = 'Copy the game\'s legacy screen, shown before the run starts: the "+XX" each parent adds above every stat, and the aptitudes after inheritance.';
const GAINS_TIP = `The "+XX" above each stat on the legacy screen, per parent. Each value decodes to the blue sparks behind it,. One parent side has ${UMAS_PER_PARENT_SIDE} umas (the parent and her two grandparents) with one blue spark each, so only sums those ${UMAS_PER_PARENT_SIDE} sparks can make are offered, and choosing them on one stat greys them out on the others.`;
const LATER_TIP = `Expected extra stat from the two inspiration events, from the sparks behind each +XX. A 3★ spark procs at 90%, 2★ at 80%, 1★ at 70%, times (1 + affinity/100) with the affinity from the advanced settings. Each proc rolls 1 to ${BLUE_SPARK_INSPIRATION_RANGE_BY_STARS[1]![1]} for 1★, 1 to ${BLUE_SPARK_INSPIRATION_RANGE_BY_STARS[2]![1]} for 2★, 1 to ${BLUE_SPARK_INSPIRATION_RANGE_BY_STARS[3]![1]} for 3★; the average assumed per star is an advanced setting. Each spark also raises the stat's cap at the start by +${BLUE_SPARK_START_UNCAP_BY_STARS[1]} / +${BLUE_SPARK_START_UNCAP_BY_STARS[2]} / +${BLUE_SPARK_START_UNCAP_BY_STARS[3]} by stars.`;
const APT_TIP = 'Set surface and distance to what the legacy screen shows after inheritance, since pink sparks can raise them. The agenda uses these for the whole run; a pink spark proc at an inspiration event is not modelled, and S is not offered because only such a proc reaches it.';

export function renderLegacy(c: RunPlan) {
  const t = c.trainee;
  const body = t ? html`
    <div class="legacy-legend"><span class="p1">Parent 1</span><span class="p2">Parent 2</span><span>start gain per stat${tip(GAINS_TIP)}</span></div>
    ${parentGainIssues(store.run.parentGains).map((issue) => html`<p class="warn" role="alert">${issue}</p>`)}
    <div class="legacy-stats">${STATS.map((st, i) => {
      const gains = PARENTS.map((pi) => store.run.parentGains[pi]![i]!);
      const start = gains[0]! + gains[1]!;
      const parts = PARENTS.map((pi) => inheritedFromGain(gains[pi]!, store.settings));
      const later = parts.reduce((a, x) => a + x.inspiration, 0);
      const max = parts.reduce((a, x) => a + x.inspirationMax, 0);
      return html`<div class="legacy-stat">
        <div class="gains">${PARENTS.map((pi) => gainSelect(pi, i))}</div>
        <div class="head">${statIcon(st)}${capitalize(st)}</div>
        <div class="body"><div class="v">${t.baseStats[i]! + start}</div><div class="sub">base ${t.baseStats[i]}</div><div class="sub" title="${max ? `at most +${max}` : ''}">≈+${num(later)} later${i === 0 ? tip(LATER_TIP) : nothing}</div></div>
      </div>`; })}</div>
    <div class="legacy-apts">
      ${ROWS.map(([label, keys], ri) => html`<div class="rowlbl">${label}${ri === 0 ? tip(APT_TIP) : nothing}</div><div class="cells">${keys.map((k) => html`<span class="cell ${store.run.aptOverrides[k] ? 'over' : ''}">${capitalize(k)} <select data-apt="${k}" .value=${live(c.apt[k] === 'S' ? 'A' : c.apt[k])} @change=${(e: Event) => setAptitude(k, (e.target as HTMLSelectElement).value as Grade)}>${GRADES.map((g) => html`<option value="${g}" ?selected=${(c.apt[k] === 'S' ? 'A' : c.apt[k]) === g}>${g}</option>`)}</select></span>`)}</div>`)}
    </div>` : html`<div class="small muted">Pick a trainee first.</div>`;
  return panel({ title: 'Legacy', tip: PANEL_TIP, actions: t ? html`<button class="small" data-action="reset-legacy" title="Clear every start gain and aptitude override" @click=${resetLegacy}>Reset</button>` : nothing }, body);
}
