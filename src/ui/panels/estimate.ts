// The parent goal estimate: the headline chance and the attempts needed at three confidence levels. What limits the
// estimate and the per-requirement breakdown go to the prediction details panel; anything that needs the user's
// attention goes to the warnings panel.
import { html, nothing } from 'lit-html';
import { APTITUDE_LABELS } from '../../model/goal-input.ts';
import { attemptsFor } from '../../model/goal.ts';
import { BLUE_GENERATION_BANDS, PRIORITIZED_SKILLS_MAX } from '../../model/rules.ts';
import { hasWhiteSpark } from '../../model/sparks.ts';
import type { RunPlan } from '../../model/run.ts';
import { store } from '../context.ts';
import { openPinkSparks } from '../actions.ts';
import { TITLE } from '../copy.ts';
import { capitalize, estimatedProbability, int, probability } from '../format.ts';
import { about, panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

const NEEDS_FINAL_A = 'Needs final A/S';
const pinkLabel = (aptitude: 'any' | keyof typeof APTITUDE_LABELS) => aptitude === 'any' ? 'Any' : APTITUDE_LABELS[aptitude];
const range = (low: number, high: number) => low === high ? probability(low) : `${probability(low)} to ${probability(high)}`;

/** Why the estimate is what it is: an impossibility if there is one, otherwise the weakest requirement. */
function goalLimits(c: RunPlan): string[] {
  const r = c.goalEstimate, g = store.run.goal;
  if (r.probability === null) return [];
  // Skill availability is the chance the run can obtain a skill; the estimate assumes every obtainable target form is
  // then bought, and compares the full-price cost with estimated SP only in Target coverage.
  const pinkName = g.pink.length > 1 ? 'Accepted pink alternatives' : g.pink[0]!.aptitude === 'any' ? 'Any pink aptitude' : `${APTITUDE_LABELS[g.pink[0]!.aptitude]} pink`;
  const limits: string[] = [];
  if (r.blue === 0) limits.push(`Required blue spark has no estimated chance with this deck at ${g.blueStars}★ or better. Check the accepted stats and their predicted values in ${TITLE.prediction}.`);
  if (r.pink.upperProbability === 0) limits.push(`${pinkName} cannot reach final A/S under the entered grades and pink sparks. Empty lineage slots count as zero; check ${TITLE.legacy} if sparks are missing.`);
  for (const w of r.required) {
    const name = w.target.name;
    if (!hasWhiteSpark(w.target)) limits.push(`${name} is impossible as a white spark because it has no released white form.`);
    else if (c.search?.unavailableWhiteIds.includes(w.target.id)) limits.push(`${name} is impossible under the current inputs: no modeled skill source exists in the allowed card pool, trainee, or lineage. Check the source-rate settings.`);
    else if (w.available === 0) limits.push(`${name} has no estimated chance of becoming available with this deck and its current event choices. Check its skill sources and whether it is among the ${PRIORITIZED_SKILLS_MAX} prioritized skills.`);
    else if (w.probability === 0) limits.push(`${name} can become available, but has no estimated chance at the required stars with this deck. Check spark-generation settings and predicted rank.`);
  }
  if (limits.length) return limits;
  if (r.upperProbability === 0) return ['The model found no outcome with every required spark together, even though each has an individual chance. Shared event choices can prevent joint success; large sampled groups can also miss rare outcomes.'];
  if (r.pink.probability !== r.pink.upperProbability) return ['Pink eligibility is uncertain, so the complete goal is shown as a range. A zero lower estimate does not mean the goal is impossible. Review the pink aptitude explanation below.'];
  const candidates = [
    { name: `Blue at ${g.blueStars}★ or better`, p: r.blue, detail: g.blueStars === 3 ? ` A 3★ blue spark needs at least ${BLUE_GENERATION_BANDS[1].min} in the selected stat, with better odds at ${BLUE_GENERATION_BANDS[2].min}.` : ' Both the chosen stat and its stars must match your goal.' },
    { name: g.pink.length === 1 ? `${pinkName} at ${g.pink[0]!.stars}★ or better` : pinkName, p: r.pink.probability, detail: g.pink[0]?.aptitude === 'any' ? ' Any accepts every eligible aptitude; the star requirement still applies.' : ' The aptitude must finish at A/S, then be selected from the eligible aptitudes and roll enough stars.' },
    ...r.required.map((w) => ({ name: w.target.name, p: w.probability, detail: ` Its skill has a ${probability(w.available)} chance of becoming available. The estimate assumes an available skill is bought, without checking the SP budget; the spark must then roll enough stars.` })),
  ];
  const lowest = candidates.reduce((a, b) => a.p <= b.p ? a : b);
  return lowest.p < 1 ? [`Lowest individual chance is ${lowest.name} at ${probability(lowest.p)}.${lowest.detail} Shared events and rank also affect complete success, so this alone does not identify the best deck change.`] : [];
}

/** The search settled for a subset of the requirements. */
const hasFallback = (c: RunPlan) => !!c.search?.score && c.search.score.count < c.search.score.total;
function fallback(c: RunPlan) {
  const result = c.goalEstimate, selected = c.search?.score;
  if (!selected || !hasFallback(c)) return nothing;
  const kept = [...(selected.blue ? ['Blue'] : []), ...(selected.pink ? ['Pink'] : []), ...result.required.filter((w) => selected.whiteIds.includes(w.target.id)).map((w) => w.target.name)];
  return html`<div data-goal-fallback><p class="warn">No complete success found under these estimates. This deck prioritizes ${selected.count} of ${selected.total} required sparks.</p>
    ${selected.count ? html`<p class="small">Remaining goal: ${kept.join(', ')}. Chance per final spark roll for this set: ${range(selected.probability, selected.upperProbability)}.</p>` : html`<p class="small">No required spark was achievable in the search. The fallback favors preferred sparks, then stats.</p>`}
    <p class="small muted">Your original requirements remain selected. ${selected.subsetApproximate ? 'The search also limits how many requirement subsets it checks. ' : ''}The complete-goal estimate and attempts still refer to every requirement.</p></div>`;
}

/** Whether goalWarnings() has anything to show. */
export function hasGoalWarnings(c: RunPlan) {
  const r = c.goalEstimate;
  return r.issues.length > 0 || r.pink.warnings.length > 0 || r.upperProbability === 0 || hasFallback(c);
}
/** Missing inputs, pink sparks worth entering, a zero estimate and a partial search result, for the warnings panel. */
export function goalWarnings(c: RunPlan) {
  const r = c.goalEstimate;
  return html`
    ${r.issues.length ? html`<ul class="small" data-goal-issues>${r.issues.map((issue) => html`<li>${issue}</li>`)}</ul>` : nothing}
    ${r.pink.warnings.length ? html`<ul class="small warn" data-goal-warnings>${r.pink.warnings.map((warning) => html`<li>${warning}</li>`)}<li><button class="small" data-action="goal-refine-pink" @click=${openPinkSparks}>Edit pink sparks in ${TITLE.legacy}</button></li></ul>` : nothing}
    ${r.upperProbability === 0 ? html`<p class="warn" data-goal-zero>The modeled outcomes give a zero estimate. Check blue spark thresholds, skill availability, and pink eligibility in ${TITLE.details}.</p>` : nothing}
    ${fallback(c)}`;
}

function breakdown(c: RunPlan) {
  const result = c.goalEstimate, g = store.run.goal, required = result.required.length;
  return html`<div class="scroll-x"><table class="goal-breakdown"><thead><tr><th>Required spark</th><th class="num">Available</th><th class="num">Spark chance</th></tr></thead><tbody>
    <tr><td>Blue (${g.blueStats.length === 5 ? 'any stat' : g.blueStats.map(capitalize).join(', ') || 'none selected'})</td><td class="num">Always</td><td class="num">${probability(result.blue)}</td></tr>
    <tr><td>Pink (${g.pink.map((p) => `${pinkLabel(p.aptitude)} ${p.stars}★+`).join(' or ')})</td><td class="num">${NEEDS_FINAL_A}</td><td class="num">${range(result.pink.probability, result.pink.upperProbability)}</td></tr>
    ${g.pink.length > 1 ? result.pink.alternatives?.map((p) => html`<tr><td>${pinkLabel(p.aptitude)} ${p.stars}★+ contribution</td><td class="num">${NEEDS_FINAL_A}</td><td class="num">${range(p.probability, p.upperProbability)}</td></tr>`) : nothing}
    ${result.required.map((w) => html`<tr><td>${w.target.name}</td><td class="num">${probability(w.available)}</td><td class="num">${probability(w.probability)}</td></tr>`)}
  </tbody></table></div>
  <p class="small muted">${required ? `All ${required} required white skill${required === 1 ? '' : 's'} available ${probability(result.allAvailable)}` : 'No required white sparks'} · SS or better ${estimatedProbability(result.pSS)}.</p>`;
}

/**
 * For the details panel: what limits the estimate, the per-requirement breakdown and the preferred sparks, with the
 * assumptions and the search's preferred score behind a disclosure.
 */
export function goalDetails(c: RunPlan) {
  const result = c.goalEstimate, limits = goalLimits(c), selected = c.search?.score, g = store.run.goal;
  const eligibility = result.pink.eligibility.filter((e) => e.probability === null || (e.probability > 0 && e.probability < 1));
  return html`
    ${limits.length ? html`<ul class="small" data-goal-limits>${limits.map((limit) => html`<li>${limit}</li>`)}</ul>` : nothing}
    ${breakdown(c)}
    ${result.preferred.length ? html`<p class="small"><b>Preferred white sparks:</b> ${result.preferred.map((w) => `${w.target.name} ${probability(w.probability)} per attempt`).join(' · ')}.</p>` : nothing}
    ${about('How the goal estimate is computed', html`
      <p class="small" data-goal-availability>Available is the chance the run can obtain each required white skill. These chances assume every obtainable target form is bought; they do not check the SP budget. ${TITLE.coverage} compares the full-price cost with the estimated SP. Each spark chance is shown individually; shared events and rank affect the combined result.${result.preferred.length ? ' These individual chances do not require the rest of the goal to succeed.' : ''}</p>
      ${g.pink.length > 1 && result.pink.probability !== result.pink.upperProbability ? html`<p class="small">Alternative contribution ranges can use different eligibility scenarios. Their endpoints need not add to the combined pink range.</p>` : nothing}
      ${selected && result.preferred.length ? html`<p class="small" data-goal-preferred>Preferred score: ${selected.preferred.toFixed(2)} ${!selected.count ? 'per final spark roll' : `on parents meeting ${selected.count === selected.total ? 'every requirement' : 'the remaining goal'}`}, the tie-breaker the search uses between decks with the same required chance.</p>` : nothing}
      <p class="small"><b>Assumptions and aptitude eligibility</b></p>
      <ul class="small">${result.notes.map((note) => html`<li>${note}</li>`)}</ul>
      <p class="small">Stats share the same outcome with rank. Hint pickups and unlinked events are treated as independent. The agenda keeps its starting aptitude estimates.</p>
      ${eligibility.length ? html`<ul class="small">${eligibility.map((e) => html`<li>${APTITUDE_LABELS[e.aptitude]} eligible at the end: ${e.probability === null ? '0% to 100%' : probability(e.probability)}</li>`)}</ul>` : nothing}`)}`;
}

function attempts(p: number, upper: number | null) {
  const text = (confidence: number) => {
    const n = attemptsFor(p, confidence), best = attemptsFor(upper ?? p, confidence);
    return best === Infinity ? 'Not reachable' : n === best ? `${int(n)} attempts` : n === Infinity ? `${int(best)} or more; no finite upper bound` : `${int(best)} to ${int(n)} attempts`;
  };
  return html`<div class="goal-attempts">${[0.5, 0.75, 0.95].map((confidence) => html`<div><b>${confidence * 100}% chance${confidence === 0.5 ? tip('Attempts count final spark rolls, including rerolls. The estimate treats them as independent with the same odds.') : nothing}</b><span data-goal-attempts=${confidence}>${text(confidence)}</span></div>`)}</div>`;
}

export function renderGoalResult(c: RunPlan) {
  const result = c.goalEstimate;
  const p = result.probability, upper = result.upperProbability;
  return panel({ title: 'Parent goal estimate', kind: 'result', tip: `The chance that one run's final spark roll gives every required spark, and how many runs that takes at three confidence levels. ${TITLE.details} below explains what limits it.` }, html`<div data-goal-result>
    ${p === null ? html`<p class="muted" data-goal-probability>Complete the goal inputs for a combined estimate.</p>` : html`<div class="goal-total" data-goal-probability>${range(p, upper ?? p)}<span class="small muted">Chance per final spark roll that the parent gets every required spark</span></div>`}
    ${p !== null ? attempts(p, upper) : nothing}
  </div>`);
}
