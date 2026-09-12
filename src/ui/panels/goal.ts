import { html, nothing } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import { live } from 'lit-html/directives/live.js';
import { STATS, APTITUDE_KEYS } from '../../types.ts';
import { APTITUDE_LABELS, sanitizeGoal, type ParentGoal, type PinkGoal } from '../../model/goal-input.ts';
import { attemptsFor } from '../../model/goal.ts';
import { BLUE_GENERATION_BANDS } from '../../model/rules.ts';
import { hasWhiteSpark } from '../../model/sparks.ts';
import type { RunPlan } from '../../model/run.ts';
import { store, update } from '../context.ts';
import { capitalize, goalProbability as probability } from '../format.ts';
import { panel } from '../panel.ts';
import { renderTargets } from './targets.ts';
import { openPinkSparks } from './legacy.ts';

const change = (fn: (goal: ParentGoal) => void) => update((s) => { fn(s.run.goal); s.run.goal = sanitizeGoal(s.run.goal); });
const stars = (current: number) => [1, 2, 3].map((n) => html`<option value=${n} ?selected=${current === n}>${n}★ or better</option>`);
export function renderGoalEditor(c: RunPlan) {
  const g = store.run.goal;
  return panel({ title: 'Parent goal' }, html`${renderTargets(c)}
    <fieldset class="goal-group"><legend>Required blue spark</legend>
      <div class="goal-stats">${STATS.map((stat) => html`<label><input type="checkbox" data-goal-blue=${stat} .checked=${live(g.blueStats.includes(stat))} @change=${(e: Event) => change((g) => { g.blueStats = (e.target as HTMLInputElement).checked ? [...g.blueStats, stat] : g.blueStats.filter((s) => s !== stat); })} /> ${capitalize(stat)}</label>`)}
      <button class="small" data-action="goal-any-blue" @click=${() => change((g) => { g.blueStats = [...STATS]; })}>Any stat</button></div>
      <label class="goal-field">Minimum stars<select data-goal-stars="blue" .value=${live(String(g.blueStars))} @change=${(e: Event) => change((g) => { g.blueStars = Number((e.target as HTMLSelectElement).value); })}>${stars(g.blueStars)}</select></label>
    </fieldset>
    <fieldset class="goal-group"><legend>Required pink spark</legend>
      <p class="small muted">Any one of these results satisfies the pink requirement.</p>
      ${repeat(g.pink, (p) => p.aptitude, (p) => html`<div class="goal-pair" data-pink-goal-row=${p.aptitude}>
        <label class="goal-field">Aptitude<select data-goal-pink=${p.aptitude} .value=${live(p.aptitude)} @change=${(e: Event) => change((g) => { g.pink.find((r) => r.aptitude === p.aptitude)!.aptitude = (e.target as HTMLSelectElement).value as PinkGoal['aptitude']; })}>
          ${p.aptitude === 'any' ? html`<option value="any">Any</option>` : nothing}
          ${APTITUDE_KEYS.filter((k) => k === p.aptitude || !g.pink.some((r) => r.aptitude === k)).map((k) => html`<option value=${k} ?selected=${p.aptitude === k}>${APTITUDE_LABELS[k]}</option>`)}
        </select></label>
        <label class="goal-field">Minimum stars<select data-goal-stars="pink" data-pink-aptitude=${p.aptitude} .value=${live(String(p.stars))} @change=${(e: Event) => change((g) => { g.pink.find((r) => r.aptitude === p.aptitude)!.stars = Number((e.target as HTMLSelectElement).value); })}>${stars(p.stars)}</select></label>
        ${p.aptitude !== 'any' ? html`<button class="small" data-action="remove-pink-goal" data-aptitude=${p.aptitude} @click=${() => change((g) => { g.pink = g.pink.filter((r) => r.aptitude !== p.aptitude); })}>Remove ${APTITUDE_LABELS[p.aptitude]}</button>` : nothing}
      </div>`)}
      <div class="goal-stats">
        <button class="small" data-action="add-pink-goal" ?disabled=${g.pink.length >= APTITUDE_KEYS.length} @click=${() => change((g) => {
          const aptitude = APTITUDE_KEYS.find((k) => !g.pink.some((r) => r.aptitude === k));
          if (aptitude) g.pink = g.pink[0]?.aptitude === 'any' ? [{ aptitude, stars: g.pink[0].stars }] : [...g.pink, { aptitude, stars: 2 }];
        })}>Add pink alternative</button>
        <button class="small" data-action="reset-pink-goal" @click=${() => change((g) => { g.pink = []; })}>Reset pink goal</button>
        <button class="small" data-action="goal-open-pink" @click=${openPinkSparks}>Edit pink sparks in Legacy</button>
      </div>
    </fieldset>
  `);
}

function goalLimits(c: RunPlan): string[] {
  const r = c.goalEstimate, g = store.run.goal;
  if (r.probability === null) return [];
  const pinkName = g.pink.length > 1 ? 'Accepted pink alternatives' : g.pink[0]!.aptitude === 'any' ? 'Any pink aptitude' : `${APTITUDE_LABELS[g.pink[0]!.aptitude]} pink`;
  const limits: string[] = [];
  if (r.blue === 0) limits.push(`Required blue spark has no estimated chance with this deck at ${g.blueStars}★ or better. Check the accepted stats and their predicted values below the suggested deck.`);
  if (r.pink.upperProbability === 0) limits.push(`${pinkName} cannot reach final A/S under the entered grades and pink sparks. Empty lineage slots count as zero; check Legacy if sparks are missing.`);
  for (const w of r.required) {
    if (!hasWhiteSpark(w.target)) limits.push(`${w.target.name} is impossible as a white spark because it has no released white form.`);
    else if (c.search?.unavailableWhiteIds.includes(w.target.id)) limits.push(`${w.target.name} is impossible under the current inputs: no modeled skill source exists in the allowed card pool, trainee, or lineage. Check excluded skill choices and source-rate settings.`);
    else if (w.available === 0) limits.push(`${w.target.name} has no estimated acquisition chance with this deck and its current event choices. Check its skill sources and the prioritized skill list.`);
    else if (w.probability === 0) limits.push(`${w.target.name} can be acquired, but has no estimated chance at the required stars with this deck. Check spark-generation settings and predicted rank.`);
  }
  if (limits.length) return limits;
  if (r.upperProbability === 0) return ['The model found no outcome with every required spark together, even though each has an individual chance. Shared event choices can prevent joint success; large sampled groups can also miss rare outcomes.'];
  if (r.pink.probability !== r.pink.upperProbability) return ['Pink eligibility is uncertain, so the complete goal is shown as a range. A zero lower estimate does not mean the goal is impossible. Review the pink aptitude explanation below.'];
  const candidates = [
    { name: `Blue at ${g.blueStars}★ or better`, p: r.blue, detail: g.blueStars === 3 ? ` A 3★ blue spark needs at least ${BLUE_GENERATION_BANDS[1].min} in the selected stat, with better odds at ${BLUE_GENERATION_BANDS[2].min}.` : ' Both the chosen stat and its stars must match your goal.' },
    { name: g.pink.length === 1 ? `${pinkName} at ${g.pink[0]!.stars}★ or better` : pinkName, p: r.pink.probability, detail: g.pink[0]?.aptitude === 'any' ? ' Any accepts every eligible aptitude; the star requirement still applies.' : ' The aptitude must finish at A/S, then be selected from the eligible aptitudes and roll enough stars.' },
    ...r.required.map((w) => ({ name: w.target.name, p: w.probability, detail: ` Its skill has a ${probability(w.available)} acquisition chance; it must then generate a spark with enough stars.` })),
  ];
  const lowest = candidates.reduce((a, b) => a.p <= b.p ? a : b);
  return lowest.p < 1 ? [`Lowest individual chance is ${lowest.name} at ${probability(lowest.p)}.${lowest.detail} Shared events and rank also affect complete success, so this alone does not identify the best deck change.`] : [];
}

export function renderGoalResult(c: RunPlan) {
  const result = c.goalEstimate;
  const limits = goalLimits(c);
  const p = result.probability, upper = result.upperProbability;
  const range = (low: number, high: number) => low === high ? probability(low) : `${probability(low)} to ${probability(high)}`;
  const selected = c.search?.score;
  const kept = selected ? [...(selected.blue ? ['Blue'] : []), ...(selected.pink ? ['Pink'] : []), ...result.required.filter((w) => selected.whiteIds.includes(w.target.id)).map((w) => w.target.name)] : [];
  return panel({ title: 'Parent goal estimate' }, html`<div data-goal-result>
    ${p === null ? html`<p class="muted" data-goal-probability>Complete the goal inputs for a combined estimate.</p>` : html`<div class="goal-total" data-goal-probability>${range(p, upper ?? p)}<span class="small muted">Chance per final spark roll that the parent gets every required spark</span></div>`}
    ${result.issues.length ? html`<ul class="small" data-goal-issues>${result.issues.map((issue) => html`<li>${issue}</li>`)}</ul>` : nothing}
    ${result.pink.warnings.length ? html`<ul class="small warn" data-goal-warnings>${result.pink.warnings.map((warning) => html`<li>${warning}</li>`)}<li><button class="small" data-action="goal-refine-pink" @click=${openPinkSparks}>Edit pink sparks in Legacy</button></li></ul>` : nothing}
    ${upper === 0 ? html`<p class="warn" data-goal-zero>The modeled outcomes give a zero estimate. Check blue spark thresholds, skill availability, and pink eligibility below.</p>` : nothing}
    ${limits.length ? html`<ul class="small" data-goal-limits>${limits.map((limit) => html`<li>${limit}</li>`)}</ul>` : nothing}
    ${selected && selected.count < selected.total ? html`<div data-goal-fallback><p class="warn">No complete success found under these estimates. This deck prioritizes ${selected.count} of ${selected.total} required sparks.</p>
      ${selected.count ? html`<p class="small">Remaining goal: ${kept.join(', ')}. Chance per final spark roll for this set: ${range(selected.probability, selected.upperProbability)}.</p>` : html`<p class="small">No required spark was achievable in the search. The fallback favors preferred sparks, then stats.</p>`}
      <p class="small muted">Your original requirements remain selected. ${selected.subsetApproximate ? 'The search also limits how many requirement subsets it checks. ' : ''}The original complete-goal estimate and attempts above and below still refer to every requirement.</p></div>` : nothing}
    ${selected && result.preferred.length ? html`<p class="small" data-goal-preferred>Preferred score: ${selected.preferred.toFixed(2)} ${selected.count ? 'on parents meeting ' + (selected.count === selected.total ? 'every requirement' : 'the remaining goal') : 'per final spark roll'}.</p>` : nothing}
    <div class="scroll-x"><table class="goal-breakdown"><thead><tr><th>Required spark</th><th class="num">Available</th><th class="num">Spark chance</th></tr></thead><tbody>
      <tr><td>Blue (${store.run.goal.blueStats.length === 5 ? 'any stat' : store.run.goal.blueStats.map(capitalize).join(', ') || 'none selected'})</td><td class="num">Always</td><td class="num">${probability(result.blue)}</td></tr>
      <tr><td>Pink (${store.run.goal.pink.map((g) => `${g.aptitude === 'any' ? 'Any' : APTITUDE_LABELS[g.aptitude]} ${g.stars}★+`).join(' or ')})</td><td class="num">Needs final A/S</td><td class="num">${range(result.pink.probability, result.pink.upperProbability)}</td></tr>
      ${store.run.goal.pink.length > 1 ? result.pink.alternatives?.map((g) => html`<tr><td>${g.aptitude === 'any' ? 'Any' : APTITUDE_LABELS[g.aptitude]} ${g.stars}★+ contribution</td><td class="num">Needs final A/S</td><td class="num">${range(g.probability, g.upperProbability)}</td></tr>`) : nothing}
      ${result.required.map((w) => html`<tr><td>${w.target.name}</td><td class="num">${probability(w.available)}</td><td class="num">${probability(w.probability)}</td></tr>`)}
    </tbody></table></div>
    ${store.run.goal.pink.length > 1 && result.pink.probability !== result.pink.upperProbability ? html`<p class="small muted">Alternative contribution ranges can use different eligibility scenarios. Their endpoints need not add to the combined pink range.</p>` : nothing}
    <p class="small muted">${result.required.length ? `All ${result.required.length} required white skill${result.required.length === 1 ? '' : 's'} available ${probability(result.allAvailable)} · ` : 'No required white sparks · '}SS or better ${probability(result.pSS)}. Each spark chance is shown individually; shared events and rank affect the combined result.</p>
    ${p !== null ? html`<div class="goal-attempts">${[0.5, 0.75, 0.95].map((confidence) => { const n = attemptsFor(p, confidence), best = attemptsFor(upper ?? p, confidence); return html`<div><b>${confidence * 100}% chance</b><span data-goal-attempts=${confidence}>${best === Infinity ? 'Not reachable' : n === best ? `${n.toLocaleString()} attempts` : n === Infinity ? `${best.toLocaleString()} or more; no finite upper bound` : `${best.toLocaleString()} to ${n.toLocaleString()} attempts`}</span></div>`; })}</div>
      <p class="small muted">Attempts count final spark rolls. This estimate treats them as independent with the same odds, including rerolls.</p>` : nothing}
    ${result.preferred.length ? html`<details><summary>Preferred white sparks</summary><ul class="small">${result.preferred.map((w) => html`<li>${w.target.name}: ${probability(w.probability)} per attempt</li>`)}</ul><p class="small muted">These individual chances do not require the rest of the goal to succeed.</p></details>` : nothing}
    <details><summary>Assumptions and aptitude eligibility</summary><ul class="small">${result.notes.map((note) => html`<li>${note}</li>`)}</ul>
      <p class="small muted">Stats share the same outcome with rank. Hint pickups and unlinked events are treated as independent. The agenda keeps its starting aptitude estimates.</p>
      <ul class="small">${result.pink.eligibility.filter((e) => e.probability === null || (e.probability > 0 && e.probability < 1)).map((e) => html`<li>${APTITUDE_LABELS[e.aptitude]} eligible at the end: ${e.probability === null ? '0% to 100%' : probability(e.probability)}</li>`)}</ul>
    </details>
  </div>`);
}
