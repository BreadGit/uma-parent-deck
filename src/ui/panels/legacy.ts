// The legacy screen: what the game shows before a run. Per stat, each parent's "+XX" start gain from her side's
// blue sparks, the trainee's start value, and the aptitude table with the surface and distance overrides.
import { html, nothing } from 'lit-html';
import { STATS, type AptKey, type Grade, type Stat } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import { inheritedFromGain, START_GAINS } from '../../model/inherit.ts';
import { data, store, update } from '../context.ts';
import { capitalize, num } from '../format.ts';
import { tip } from '../tooltip.ts';

const PARENTS = [0, 1];
const ROWS: [string, AptKey[]][] = [['Track', ['turf', 'dirt']], ['Distance', ['sprint', 'mile', 'medium', 'long']]];
const GRADES: Grade[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
const icon = (st: Stat) => html`<img src="/assets/icons/type_${st}.png" alt="" />`;

function setGain(pi: number, si: number, gain: number) {
  update((s) => { s.run.parentGains = s.run.parentGains.map((p, j) => (j === pi ? p.map((g, i) => (i === si ? gain : g)) : p)); });
}
/** An override equal to the trainee's own grade is just the base again. */
function setAptitude(k: AptKey, grade: Grade) {
  update((s) => {
    const t = s.run.traineeCardId != null ? data.charByCardId.get(s.run.traineeCardId) : null;
    if (t && t.aptitudes[k] === grade) delete s.run.aptOverrides[k]; else s.run.aptOverrides[k] = grade;
  });
}

const gainSelect = (pi: number, si: number) => html`<select class="gain p${pi + 1} ${store.run.parentGains[pi]![si] ? 'set' : ''}" data-gain="${pi}-${si}" title="Parent ${pi + 1}" @change=${(e: Event) => setGain(pi, si, Number((e.target as HTMLSelectElement).value))}>
  ${START_GAINS.map((g) => html`<option value="${g.gain}" ?selected=${store.run.parentGains[pi]![si] === g.gain}>+${g.gain}</option>`)}</select>`;

/** Back to a blank legacy screen: no start gains and the trainee's own aptitudes. */
const resetLegacy = () => update((s) => { s.run.parentGains = s.run.parentGains.map((p) => p.map(() => 0)); s.run.aptOverrides = {}; });

export function renderLegacy(c: RunPlan) {
  const t = c.trainee;
  return html`
    <section class="panel">
      <h2 class="h-row">Legacy screen <span class="small muted">(copy the game's pre-run screen)</span>${t ? html`<button class="small push-right" data-action="reset-legacy" title="Clear every start gain and aptitude override" @click=${resetLegacy}>Reset</button>` : nothing}</h2>
      ${t ? html`
        <div class="legacy-legend"><span class="p1">Parent 1</span><span class="p2">Parent 2</span><span>start gain per stat, as the legacy screen shows it</span></div>
        <div class="legacy-stats">${STATS.map((st, i) => {
          const gains = PARENTS.map((pi) => store.run.parentGains[pi]![i]!);
          const start = gains[0]! + gains[1]!;
          const later = PARENTS.reduce((a, pi) => a + inheritedFromGain(gains[pi]!, store.settings).inspiration, 0);
          return html`<div class="legacy-stat">
            <div class="gains">${PARENTS.map((pi) => gainSelect(pi, i))}</div>
            <div class="head">${icon(st)}${capitalize(st)}</div>
            <div class="body"><div class="v">${t.baseStats[i]! + start}</div><div class="sub">base ${t.baseStats[i]}</div><div class="sub">+${num(later)} later${i === 0 ? tip('Expected extra stats from the two inspiration events, from the sparks behind each +XX: a 3★ spark procs at 90%, 2★ at 80%, 1★ at 70%, scaled by the affinity setting.') : nothing}</div></div>
          </div>`; })}</div>
        <div class="legacy-apts">
          ${ROWS.map(([label, keys]) => html`<div class="rowlbl">${label}</div><div class="cells">${keys.map((k) => html`<span class="cell ${store.run.aptOverrides[k] ? 'over' : ''}">${capitalize(k)} <select data-apt="${k}" @change=${(e: Event) => setAptitude(k, (e.target as HTMLSelectElement).value as Grade)}>${GRADES.map((g) => html`<option value="${g}" ?selected=${c.apt[k] === g}>${g}</option>`)}</select></span>`)}</div>`)}
          <div class="rowlbl">Style${tip('Running style aptitudes are not needed: the tool only uses surface and distance to pick the G1 agenda, and independent training picks the style itself.')}</div><div class="cells muted small">not used by the tool</div>
        </div>
        <div class="small muted">Set surface and distance to what the legacy screen shows after inheritance, since pink sparks can raise them.</div>
      ` : html`<div class="small muted">Pick a trainee first. This panel then mirrors her pre-run screen: the "+XX" each parent adds per stat and her aptitudes after inheritance.</div>`}
    </section>`;
}
