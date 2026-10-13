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

const copy = {
  aboutGoal: 'How the goal estimate is computed',
  title: 'Parent goal estimate',
  tip: `The chance that one run's final spark roll gives every required spark, and how many runs that takes at three confidence levels. ${TITLE.details} below explains what limits it.`,
  incomplete: 'Complete the goal inputs for a combined estimate.',
  headline: 'Chance per final spark roll that the parent gets every required spark',
  attemptsTip: 'Attempts count final spark rolls, including rerolls. The estimate treats them as independent with the same odds.',
  editPink: `Edit pink sparks in ${TITLE.legacy}`,
  preferred: 'Preferred white sparks',
  preferredNote: 'These individual chances do not require the rest of the goal to succeed.',
  assumptions: 'Assumptions and aptitude eligibility',
  assumptionsNote: 'Stats share the same outcome with rank. Hint pickups and unlinked events are treated as independent. The agenda keeps its starting aptitude estimates.',
  any: 'Any',
  anyPink: 'Any pink aptitude',
  pinkAlternatives: 'Accepted pink alternatives',
  pinkOf: (aptitude: string) => `${aptitude} pink`,
  // What limits the estimate. Skill availability is the chance the run can obtain a skill; the estimate assumes every
  // obtainable target form is then bought, and compares the full-price cost with estimated SP only in Target coverage.
  limits: {
    blueNone: (stars: number) => `Required blue spark has no estimated chance with this deck at ${stars}★ or better. Check the accepted stats and their predicted values in ${TITLE.prediction}.`,
    pinkUnreachable: (pink: string) => `${pink} cannot reach final A/S under the entered grades and pink sparks. Empty lineage slots count as zero; check ${TITLE.legacy} if sparks are missing.`,
    noWhiteForm: (name: string) => `${name} is impossible as a white spark because it has no released white form.`,
    noSource: (name: string) => `${name} is impossible under the current inputs: no modeled skill source exists in the allowed card pool, trainee, or lineage. Check the source-rate settings.`,
    unavailable: (name: string) => `${name} has no estimated chance of becoming available with this deck and its current event choices. Check its skill sources and whether it is among the ${PRIORITIZED_SKILLS_MAX} prioritized skills.`,
    noStars: (name: string) => `${name} can become available, but has no estimated chance at the required stars with this deck. Check spark-generation settings and predicted rank.`,
    jointZero: 'The model found no outcome with every required spark together, even though each has an individual chance. Shared event choices can prevent joint success; large sampled groups can also miss rare outcomes.',
    pinkRange: 'Pink eligibility is uncertain, so the complete goal is shown as a range. A zero lower estimate does not mean the goal is impossible. Review the pink aptitude explanation below.',
    blue: (stars: number) => `Blue at ${stars}★ or better`,
    blueThree: (min: number, better: number) => ` A 3★ blue spark needs at least ${min} in the selected stat, with better odds at ${better}.`,
    blueMatch: ' Both the chosen stat and its stars must match your goal.',
    pinkStars: (pink: string, stars: number) => `${pink} at ${stars}★ or better`,
    pinkAny: ' Any accepts every eligible aptitude; the star requirement still applies.',
    pinkSpecific: ' The aptitude must finish at A/S, then be selected from the eligible aptitudes and roll enough stars.',
    white: (available: string) => ` Its skill has a ${available} chance of becoming available. The estimate assumes an available skill is bought, without checking the SP budget; the spark must then roll enough stars.`,
    lowest: (name: string, chance: string, detail: string) => `Lowest individual chance is ${name} at ${chance}.${detail} Shared events and rank also affect complete success, so this alone does not identify the best deck change.`,
  },
  fallback: {
    blue: 'Blue',
    pink: 'Pink',
    noComplete: (count: number, total: number) => `No complete success found under these estimates. This deck prioritizes ${count} of ${total} required sparks.`,
    remaining: (kept: string, chance: string) => `Remaining goal: ${kept}. Chance per final spark roll for this set: ${chance}.`,
    none: 'No required spark was achievable in the search. The fallback favors preferred sparks, then stats.',
    kept: (subsetsLimited: boolean) => `Your original requirements remain selected. ${subsetsLimited ? 'The search also limits how many requirement subsets it checks. ' : ''}The complete-goal estimate and attempts still refer to every requirement.`,
  },
  zero: `The modeled outcomes give a zero estimate. Check blue spark thresholds, skill availability, and pink eligibility in ${TITLE.details}.`,
  breakdown: {
    requirement: 'Required spark',
    available: 'Available',
    chance: 'Spark chance',
    blue: (stats: string) => `Blue (${stats})`,
    anyStat: 'any stat',
    noStat: 'none selected',
    always: 'Always',
    pink: (alternatives: string) => `Pink (${alternatives})`,
    needsA: 'Needs final A/S',
    contribution: (pink: string) => `${pink} contribution`,
    allAvailable: (n: number, chance: string) => `All ${n} required white skill${n === 1 ? '' : 's'} available ${chance}`,
    noWhite: 'No required white sparks',
    ss: (chance: string) => `SS or better ${chance}`,
  },
  preferredChance: (name: string, chance: string) => `${name} ${chance} per attempt`,
  availability: `Available is the chance the run can obtain each required white skill. These chances assume every obtainable target form is bought; they do not check the SP budget. ${TITLE.coverage} compares the full-price cost with the estimated SP. Each spark chance is shown individually; shared events and rank affect the combined result.`,
  alternativeRanges: 'Alternative contribution ranges can use different eligibility scenarios. Their endpoints need not add to the combined pink range.',
  preferredScore: (score: string, basis: 'every' | 'remaining' | 'roll') => `Preferred score: ${score} ${basis === 'roll' ? 'per final spark roll' : `on parents meeting ${basis === 'every' ? 'every requirement' : 'the remaining goal'}`}, the tie-breaker the search uses between decks with the same required chance.`,
  eligible: (aptitude: string, chance: string) => `${aptitude} eligible at the end: ${chance}`,
  eligibleUnknown: '0% to 100%',
  unreachable: 'Not reachable',
  attempts: (n: string) => `${n} attempts`,
  attemptsRange: (best: string, n: string) => `${best} to ${n} attempts`,
  attemptsUnbounded: (best: string) => `${best} or more; no finite upper bound`,
  confidence: (percent: number) => `${percent}% chance`,
} as const;
const pinkLabel = (aptitude: 'any' | keyof typeof APTITUDE_LABELS) => aptitude === 'any' ? copy.any : APTITUDE_LABELS[aptitude];
const range = (low: number, high: number) => low === high ? probability(low) : `${probability(low)} to ${probability(high)}`;

/** Why the estimate is what it is: an impossibility if there is one, otherwise the weakest requirement. */
function goalLimits(c: RunPlan): string[] {
  const r = c.goalEstimate, g = store.run.goal;
  if (r.probability === null) return [];
  const L = copy.limits;
  const pinkName = g.pink.length > 1 ? copy.pinkAlternatives : g.pink[0]!.aptitude === 'any' ? copy.anyPink : copy.pinkOf(APTITUDE_LABELS[g.pink[0]!.aptitude]);
  const limits: string[] = [];
  if (r.blue === 0) limits.push(L.blueNone(g.blueStars));
  if (r.pink.upperProbability === 0) limits.push(L.pinkUnreachable(pinkName));
  for (const w of r.required) {
    if (!hasWhiteSpark(w.target)) limits.push(L.noWhiteForm(w.target.name));
    else if (c.search?.unavailableWhiteIds.includes(w.target.id)) limits.push(L.noSource(w.target.name));
    else if (w.available === 0) limits.push(L.unavailable(w.target.name));
    else if (w.probability === 0) limits.push(L.noStars(w.target.name));
  }
  if (limits.length) return limits;
  if (r.upperProbability === 0) return [L.jointZero];
  if (r.pink.probability !== r.pink.upperProbability) return [L.pinkRange];
  const candidates = [
    { name: L.blue(g.blueStars), p: r.blue, detail: g.blueStars === 3 ? L.blueThree(BLUE_GENERATION_BANDS[1].min, BLUE_GENERATION_BANDS[2].min) : L.blueMatch },
    { name: g.pink.length === 1 ? L.pinkStars(pinkName, g.pink[0]!.stars) : pinkName, p: r.pink.probability, detail: g.pink[0]?.aptitude === 'any' ? L.pinkAny : L.pinkSpecific },
    ...r.required.map((w) => ({ name: w.target.name, p: w.probability, detail: L.white(probability(w.available)) })),
  ];
  const lowest = candidates.reduce((a, b) => a.p <= b.p ? a : b);
  return lowest.p < 1 ? [L.lowest(lowest.name, probability(lowest.p), lowest.detail)] : [];
}

/** The search settled for a subset of the requirements. */
const hasFallback = (c: RunPlan) => !!c.search?.score && c.search.score.count < c.search.score.total;
function fallback(c: RunPlan) {
  const result = c.goalEstimate, selected = c.search?.score;
  if (!selected || !hasFallback(c)) return nothing;
  const F = copy.fallback;
  const kept = [...(selected.blue ? [F.blue] : []), ...(selected.pink ? [F.pink] : []), ...result.required.filter((w) => selected.whiteIds.includes(w.target.id)).map((w) => w.target.name)];
  return html`<div data-goal-fallback><p class="warn">${F.noComplete(selected.count, selected.total)}</p>
    ${selected.count ? html`<p class="small">${F.remaining(kept.join(', '), range(selected.probability, selected.upperProbability))}</p>` : html`<p class="small">${F.none}</p>`}
    <p class="small muted">${F.kept(selected.subsetApproximate)}</p></div>`;
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
    ${r.pink.warnings.length ? html`<ul class="small warn" data-goal-warnings>${r.pink.warnings.map((warning) => html`<li>${warning}</li>`)}<li><button class="small" data-action="goal-refine-pink" @click=${openPinkSparks}>${copy.editPink}</button></li></ul>` : nothing}
    ${r.upperProbability === 0 ? html`<p class="warn" data-goal-zero>${copy.zero}</p>` : nothing}
    ${fallback(c)}`;
}

function breakdown(c: RunPlan) {
  const result = c.goalEstimate, g = store.run.goal, B = copy.breakdown;
  return html`<div class="scroll-x"><table class="goal-breakdown"><thead><tr><th>${B.requirement}</th><th class="num">${B.available}</th><th class="num">${B.chance}</th></tr></thead><tbody>
    <tr><td>${B.blue(g.blueStats.length === 5 ? B.anyStat : g.blueStats.map(capitalize).join(', ') || B.noStat)}</td><td class="num">${B.always}</td><td class="num">${probability(result.blue)}</td></tr>
    <tr><td>${B.pink(g.pink.map((p) => `${pinkLabel(p.aptitude)} ${p.stars}★+`).join(' or '))}</td><td class="num">${B.needsA}</td><td class="num">${range(result.pink.probability, result.pink.upperProbability)}</td></tr>
    ${g.pink.length > 1 ? result.pink.alternatives?.map((p) => html`<tr><td>${B.contribution(`${pinkLabel(p.aptitude)} ${p.stars}★+`)}</td><td class="num">${B.needsA}</td><td class="num">${range(p.probability, p.upperProbability)}</td></tr>`) : nothing}
    ${result.required.map((w) => html`<tr><td>${w.target.name}</td><td class="num">${probability(w.available)}</td><td class="num">${probability(w.probability)}</td></tr>`)}
  </tbody></table></div>
  <p class="small muted">${result.required.length ? B.allAvailable(result.required.length, probability(result.allAvailable)) : B.noWhite} · ${B.ss(estimatedProbability(result.pSS))}.</p>`;
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
    ${result.preferred.length ? html`<p class="small"><b>${copy.preferred}:</b> ${result.preferred.map((w) => copy.preferredChance(w.target.name, probability(w.probability))).join(' · ')}.</p>` : nothing}
    ${about(copy.aboutGoal, html`
      <p class="small" data-goal-availability>${copy.availability}${result.preferred.length ? ` ${copy.preferredNote}` : ''}</p>
      ${g.pink.length > 1 && result.pink.probability !== result.pink.upperProbability ? html`<p class="small">${copy.alternativeRanges}</p>` : nothing}
      ${selected && result.preferred.length ? html`<p class="small" data-goal-preferred>${copy.preferredScore(selected.preferred.toFixed(2), !selected.count ? 'roll' : selected.count === selected.total ? 'every' : 'remaining')}</p>` : nothing}
      <p class="small"><b>${copy.assumptions}</b></p>
      <ul class="small">${result.notes.map((note) => html`<li>${note}</li>`)}</ul>
      <p class="small">${copy.assumptionsNote}</p>
      ${eligibility.length ? html`<ul class="small">${eligibility.map((e) => html`<li>${copy.eligible(APTITUDE_LABELS[e.aptitude], e.probability === null ? copy.eligibleUnknown : probability(e.probability))}</li>`)}</ul>` : nothing}`)}`;
}

function attempts(p: number, upper: number | null) {
  const text = (confidence: number) => {
    const n = attemptsFor(p, confidence), best = attemptsFor(upper ?? p, confidence);
    return best === Infinity ? copy.unreachable : n === best ? copy.attempts(int(n)) : n === Infinity ? copy.attemptsUnbounded(int(best)) : copy.attemptsRange(int(best), int(n));
  };
  return html`<div class="goal-attempts">${[0.5, 0.75, 0.95].map((confidence) => html`<div><b>${copy.confidence(confidence * 100)}${confidence === 0.5 ? tip(copy.attemptsTip) : nothing}</b><span data-goal-attempts=${confidence}>${text(confidence)}</span></div>`)}</div>`;
}

export function renderGoalResult(c: RunPlan) {
  const result = c.goalEstimate;
  const p = result.probability, upper = result.upperProbability;
  return panel({ title: copy.title, kind: 'result', tip: copy.tip }, html`<div data-goal-result>
    ${p === null ? html`<p class="muted" data-goal-probability>${copy.incomplete}</p>` : html`<div class="goal-total" data-goal-probability>${range(p, upper ?? p)}<span class="small muted">${copy.headline}</span></div>`}
    ${p !== null ? attempts(p, upper) : nothing}
  </div>`);
}
