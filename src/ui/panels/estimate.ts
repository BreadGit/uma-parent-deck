// The parent goal estimate: the headline chance and the attempts needed at three confidence levels. What limits the
// estimate and the per-requirement breakdown go to the prediction details panel; anything that needs the user's
// attention goes to the warnings panel.
import { html, nothing } from 'lit-html';
import { APTITUDE_LABELS } from '../../model/goal-input.ts';
import { attemptsFor } from '../../model/goal.ts';
import { BLUE_GENERATION_BANDS } from '../../model/rules.ts';
import { hasWhiteSpark } from '../../model/sparks.ts';
import type { RunPlan } from '../../model/run.ts';
import { store } from '../context.ts';
import { openPinkSparks } from '../actions.ts';
import { COPY } from '../copy.ts';
import { capitalize, estimatedProbability, int, probability } from '../format.ts';
import { about, panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

const E = COPY.estimate;
const pinkLabel = (aptitude: 'any' | keyof typeof APTITUDE_LABELS) => aptitude === 'any' ? E.any : APTITUDE_LABELS[aptitude];
const range = (low: number, high: number) => low === high ? probability(low) : `${probability(low)} to ${probability(high)}`;

/** Why the estimate is what it is: an impossibility if there is one, otherwise the weakest requirement. */
function goalLimits(c: RunPlan): string[] {
  const r = c.goalEstimate, g = store.run.goal;
  if (r.probability === null) return [];
  const L = E.limits;
  const pinkName = g.pink.length > 1 ? E.pinkAlternatives : g.pink[0]!.aptitude === 'any' ? E.anyPink : E.pinkOf(APTITUDE_LABELS[g.pink[0]!.aptitude]);
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
  const F = E.fallback;
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
    ${r.pink.warnings.length ? html`<ul class="small warn" data-goal-warnings>${r.pink.warnings.map((warning) => html`<li>${warning}</li>`)}<li><button class="small" data-action="goal-refine-pink" @click=${openPinkSparks}>${COPY.estimate.editPink}</button></li></ul>` : nothing}
    ${r.upperProbability === 0 ? html`<p class="warn" data-goal-zero>${E.zero}</p>` : nothing}
    ${fallback(c)}`;
}

function breakdown(c: RunPlan) {
  const result = c.goalEstimate, g = store.run.goal, B = E.breakdown;
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
    ${result.preferred.length ? html`<p class="small"><b>${COPY.estimate.preferred}:</b> ${result.preferred.map((w) => E.preferredChance(w.target.name, probability(w.probability))).join(' · ')}.</p>` : nothing}
    ${about(COPY.details.aboutGoal, html`
      <p class="small" data-goal-availability>${E.availability}${result.preferred.length ? ` ${E.preferredNote}` : ''}</p>
      ${g.pink.length > 1 && result.pink.probability !== result.pink.upperProbability ? html`<p class="small">${E.alternativeRanges}</p>` : nothing}
      ${selected && result.preferred.length ? html`<p class="small" data-goal-preferred>${E.preferredScore(selected.preferred.toFixed(2), !selected.count ? 'roll' : selected.count === selected.total ? 'every' : 'remaining')}</p>` : nothing}
      <p class="small"><b>${COPY.estimate.assumptions}</b></p>
      <ul class="small">${result.notes.map((note) => html`<li>${note}</li>`)}</ul>
      <p class="small">${COPY.estimate.assumptionsNote}</p>
      ${eligibility.length ? html`<ul class="small">${eligibility.map((e) => html`<li>${E.eligible(APTITUDE_LABELS[e.aptitude], e.probability === null ? E.eligibleUnknown : probability(e.probability))}</li>`)}</ul>` : nothing}`)}`;
}

function attempts(p: number, upper: number | null) {
  const text = (confidence: number) => {
    const n = attemptsFor(p, confidence), best = attemptsFor(upper ?? p, confidence);
    return best === Infinity ? E.unreachable : n === best ? E.attempts(int(n)) : n === Infinity ? E.attemptsUnbounded(int(best)) : E.attemptsRange(int(best), int(n));
  };
  return html`<div class="goal-attempts">${[0.5, 0.75, 0.95].map((confidence) => html`<div><b>${E.confidence(confidence * 100)}${confidence === 0.5 ? tip(COPY.estimate.attemptsTip) : nothing}</b><span data-goal-attempts=${confidence}>${text(confidence)}</span></div>`)}</div>`;
}

export function renderGoalResult(c: RunPlan) {
  const result = c.goalEstimate;
  const p = result.probability, upper = result.upperProbability;
  return panel({ title: COPY.estimate.title, kind: 'result', tip: COPY.estimate.tip }, html`<div data-goal-result>
    ${p === null ? html`<p class="muted" data-goal-probability>${COPY.estimate.incomplete}</p>` : html`<div class="goal-total" data-goal-probability>${range(p, upper ?? p)}<span class="small muted">${COPY.estimate.headline}</span></div>`}
    ${p !== null ? attempts(p, upper) : nothing}
  </div>`);
}
