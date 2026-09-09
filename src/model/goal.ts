import { STATS, type AptKey, type Card, type Grade } from '../types.ts';
import { type Ctx, evaluate, traineeCoverage } from './deck.ts';
import { APTITUDE_KEYS, APTITUDE_LABELS, type ParentGoal, type PinkSpark } from './goal-input.ts';
import { BLUE_GENERATION_BANDS, WHITE_GENERATION_BANDS, PINK_GENERATION_RATES, PINK_INSPIRATION_RATES, INSPIRATION_EVENTS, OUR_GRAND_CONCERT } from './rules.ts';
import { cardSourcesForTarget, lineageCount, resolveTarget, type Target } from './sparks.ts';
import { jointSkillForms, whiteGenerationMoments } from './goal-skills.ts';
import { phi } from './stats.ts';
import { MAX_STAT_VALUE, statScore } from './rank.ts';

export const starChance = (rates: readonly number[], stars: number, exact = false) => exact ? rates[stars - 1] ?? 0 : rates.slice(stars - 1).reduce((a, p) => a + p, 0);
export function blueChance(stats: number[], accepted: string[], stars: number): number {
  return STATS.reduce((p, stat, i) => {
    if (!accepted.includes(stat)) return p;
    const band = [...BLUE_GENERATION_BANDS].reverse().find((b) => stats[i]! >= b.min) ?? BLUE_GENERATION_BANDS[0];
    return p + starChance(band.rates, stars) / STATS.length;
  }, 0);
}
export function attemptsFor(p: number, confidence: number): number {
  if (p <= 0) return Infinity;
  if (p >= 1) return 1;
  return Math.ceil(Math.log1p(-confidence) / Math.log1p(-p));
}

export interface PinkEstimate { probability: number | null; issues: string[]; warnings: string[]; eligibility: { aptitude: AptKey; probability: number | null }[] }
export function pinkEstimate(apt: Record<AptKey, Grade>, target: ParentGoal['pink'], stars: number, lineage: (PinkSpark | null)[], affinity: number): PinkEstimate {
  const issues: string[] = [], warnings: string[] = [];
  const unknown = lineage.length !== 6 || lineage.some((p) => p === null);
  const eligibility = APTITUDE_KEYS.map((key) => {
    if (apt[key] === 'A' || apt[key] === 'S') return { aptitude: key, probability: 1 };
    const matching = lineage.filter((p): p is PinkSpark => p?.aptitude === key);
    if (!matching.length) return { aptitude: key, probability: 0 };
    if (apt[key] !== 'B') {
      issues.push(`${APTITUDE_LABELS[key]} starts below B and has matching pink sparks. Its chance of reaching A is outside this estimate.`);
      return { aptitude: key, probability: null };
    }
    const miss = matching.reduce((p, spark) => p * (1 - Math.min(1, PINK_INSPIRATION_RATES[spark.stars]! * (1 + affinity / 100))) ** INSPIRATION_EVENTS, 1);
    return { aptitude: key, probability: 1 - miss };
  });
  if (target === 'any' && eligibility.some((e) => e.probability === 1)) {
    return { probability: starChance(PINK_GENERATION_RATES, stars), issues: [], warnings, eligibility };
  }
  if (unknown && APTITUDE_KEYS.some((key) => apt[key] !== 'A' && apt[key] !== 'S')) warnings.push('Open Pink sparks in Legacy and enter all six lineage sparks to get a more accurate pink spark probability.');
  if (issues.length) return { probability: null, issues, warnings, eligibility };
  if (target === 'any') {
    const noneEligible = eligibility.reduce((p, e) => p * (1 - e.probability!), 1);
    return { probability: (1 - noneEligible) * starChance(PINK_GENERATION_RATES, stars), issues, warnings, eligibility };
  }
  const desired = eligibility.find((e) => e.aptitude === target)!.probability!;
  // The count of other eligible aptitudes is a Poisson-binomial distribution.
  let count = [1];
  for (const e of eligibility.filter((e) => e.aptitude !== target)) {
    const next = Array<number>(count.length + 1).fill(0), p = e.probability!;
    count.forEach((mass, k) => { next[k]! += mass * (1 - p); next[k + 1]! += mass * p; });
    count = next;
  }
  return { probability: desired * starChance(PINK_GENERATION_RATES, stars) * count.reduce((p, mass, k) => p + mass / (k + 1), 0), issues, warnings, eligibility };
}

export interface GoalStats { rawMean: number[]; sd: number[]; caps?: number[]; skillPoints: number; skillSd: number }
export interface StatGoalMoments { blue: number; whiteStars: number[]; blueAllWhiteStars: number; preferredStars: number; pSS: number; approximateRank: number }
function halton(index: number, base: number): number {
  let value = 0, fraction = 1 / base;
  while (index > 0) { value += fraction * (index % base); index = Math.floor(index / base); fraction /= base; }
  return value;
}
let samples: number[][] | undefined;
function statSamples(): number[][] {
  return samples ??= Array.from({ length: 2048 }, (_, i) => [2, 3, 5, 7, 11].map((base) => halton(i + 1, base)));
}

interface StatMass { value: number; probability: number }
interface StatDistribution { outcomes: { value: number; cumulative: number }[]; mass: number }
/** Rounded normal outcomes, with the tails folded into zero and the cap. */
function statMasses(mean: number, sd: number, cap = Infinity): StatMass[] {
  // Higher values have the same rating and blue band, so they can share one outcome.
  const maximum = Math.max(0, Math.min(Math.round(cap), MAX_STAT_VALUE));
  if (sd === 0 || maximum === 0) return [{ value: Math.max(0, Math.min(maximum, Math.round(mean))), probability: 1 }];
  return Array.from({ length: maximum + 1 }, (_, value) => {
    const lower = value === 0 ? -Infinity : (value - .5 - mean) / sd;
    const upper = value === maximum ? Infinity : (value + .5 - mean) / sd;
    // Use the survival function in the upper tail to avoid subtracting two CDFs rounded to one.
    const probability = lower > 0 ? phi(-lower) - phi(-upper) : phi(upper) - phi(lower);
    return { value, probability };
  }).filter((outcome) => outcome.probability > 0);
}
function statDistribution(outcomes: StatMass[]): StatDistribution {
  let mass = 0;
  return { outcomes: outcomes.map(({ value, probability }) => ({ value, cumulative: mass += probability })), mass };
}
function sampleStat(distribution: StatDistribution, quantile: number): number {
  const q = quantile * distribution.mass;
  let low = 0, high = distribution.outcomes.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (distribution.outcomes[mid]!.cumulative < q) low = mid + 1; else high = mid;
  }
  return distribution.outcomes[low]!.value;
}

/** Integrate blue bands analytically; sample rank conditional on each selected stat and blue band. */
export function statGoalMoments(input: GoalStats, goal: ParentGoal): StatGoalMoments {
  const result: StatGoalMoments = { blue: 0, whiteStars: goal.required.map(() => 0), blueAllWhiteStars: 0, preferredStars: 0, pSS: 0, approximateRank: 0 };
  const masses = input.rawMean.map((mean, i) => statMasses(mean, input.sd[i] ?? 0, input.caps?.[i]));
  const distributions = masses.map(statDistribution);
  const draws = input.sd.every((sd) => sd === 0) ? [[.5, .5, .5, .5, .5]] : statSamples();
  const statRatings = draws.map((draw) => distributions.map((distribution, i) => statScore(sampleStat(distribution, draw[i]!))));
  const scores = statRatings.map((ratings) => ratings.reduce((sum, rating) => sum + rating, input.skillPoints));
  const whiteProducts = WHITE_GENERATION_BANDS.map((band) => goal.required.reduce((p, r) => p * starChance(band.rates, r.stars), 1));
  for (const score of scores) {
    const below = (limit: number) => input.skillSd > 0 ? phi((limit - score) / input.skillSd) : Number(score < limit);
    result.pSS += (1 - below(17500)) / draws.length;
    WHITE_GENERATION_BANDS.forEach((band, i) => {
      const upper = WHITE_GENERATION_BANDS[i + 1]?.min;
      const weight = ((upper === undefined ? 1 : below(upper)) - (i === 0 ? 0 : below(band.min))) / draws.length;
      const stars = goal.required.map((r) => starChance(band.rates, r.stars));
      stars.forEach((p, j) => { result.whiteStars[j]! += p * weight; });
      result.preferredStars += starChance(band.rates, 2) * weight;
      if (band.approximate) result.approximateRank += weight;
    });
  }
  STATS.forEach((stat, i) => {
    if (!goal.blueStats.includes(stat)) return;
    BLUE_GENERATION_BANDS.forEach((band, b) => {
      const distribution = statDistribution(masses[i]!.filter(({ value }) => value >= band.min && value < (BLUE_GENERATION_BANDS[b + 1]?.min ?? Infinity)));
      const blue = distribution.mass * starChance(band.rates, goal.blueStars) / STATS.length;
      result.blue += blue;
      if (blue === 0) return;
      if (goal.required.every((r) => r.stars === 1)) { result.blueAllWhiteStars += blue; return; }
      for (let n = 0; n < draws.length; n++) {
        const score = scores[n]! - statRatings[n]![i]! + statScore(sampleStat(distribution, draws[n]![i]!));
        // Each higher rank band replaces the previous band's shared white-star product.
        let white = whiteProducts[0]!;
        for (let j = 1; j < WHITE_GENERATION_BANDS.length; j++) {
          const min = WHITE_GENERATION_BANDS[j]!.min;
          const above = input.skillSd > 0 ? phi((score - min) / input.skillSd) : Number(score >= min);
          white += (whiteProducts[j]! - whiteProducts[j - 1]!) * above;
        }
        result.blueAllWhiteStars += blue * white / draws.length;
      }
    });
  });
  return result;
}

export interface GoalWhiteEstimate { target: Target; available: number; probability: number }
export interface GoalEstimate {
  probability: number | null;
  issues: string[];
  notes: string[];
  blue: number;
  pink: PinkEstimate | null;
  required: GoalWhiteEstimate[];
  preferred: GoalWhiteEstimate[];
  allAvailable: number;
  pSS: number;
}
export function evaluateParentGoal(goal: ParentGoal, pinkLineage: (PinkSpark | null)[], apt: Record<AptKey, Grade>, deck: { card: Card; lb: number }[], ctx: Ctx, stats: GoalStats, runIssues: string[]): GoalEstimate {
  const issues = [...runIssues];
  if (!ctx.trainee) issues.push('Choose the trainee to estimate the parent goal.');
  if (ctx.settings.scenarioId !== OUR_GRAND_CONCERT) issues.push('Parent goals currently estimate Our Grand Concert independent training.');
  if (!goal.blueStats.length) issues.push('Choose at least one acceptable blue stat.');
  const required = goal.required.map((r) => resolveTarget(r.id, ctx.data)).filter((t): t is Target => !!t);
  if (required.length !== goal.required.length || new Set(required.map((t) => t.id)).size !== required.length) issues.push('Each required white spark must be a different valid skill family.');
  const preferred = goal.preferred.map((id) => resolveTarget(id, ctx.data)).filter((t): t is Target => !!t && !required.some((r) => r.id === t.id));
  const targets = [...required, ...preferred];
  const state = traineeCoverage(targets, ctx);
  for (const entry of deck) {
    state.cards.push(entry.card); state.chars.add(entry.card.charId);
    for (const t of targets) state.sources.set(t.id, [...(state.sources.get(t.id) ?? []), ...cardSourcesForTarget(entry.card, entry.lb, t, ctx.races, ctx.totalTurns, ctx.data, ctx.settings)]);
  }
  const coverage = evaluate(state, targets, ctx);
  const joint = jointSkillForms(required, coverage.map, ctx.data, ctx.settings);
  const copies = (t: Target) => { const l = ctx.lineage.get(t.id); return l ? lineageCount(l) : 0; };
  const skills = whiteGenerationMoments(joint, required.map(copies), ctx.settings);
  const moments = statGoalMoments(stats, goal);
  const pink = pinkEstimate(apt, goal.pink, goal.pinkStars, pinkLineage, ctx.settings.affinity);
  issues.push(...pink.issues);
  const notes = ['Starting aptitude grades already include parent selection. Pink ancestry estimates additional mid-run inspiration increases without changing the entered grades.', 'Available target skills and their best available upgrades are assumed purchased. Skill acquisition is modeled independently of the stat and rank outcomes.'];
  if (pink.warnings.length) notes.push('Pink probabilities use the entered starting grades and known lineage sparks. Unknown slots contribute no additional aptitude increases in this estimate.');
  if (goal.pink === 'any') notes.push('Any pink aptitude counts toward the goal. With an A/S aptitude already eligible, only the minimum stars affect its chance.');
  if (pinkLineage.some((spark) => spark?.inferred)) notes.push('Some pink sparks are minimum-star estimates inferred from starting aptitude increases. Other lineages can produce the same grades. Refine them in Legacy > Pink sparks.');
  if (skills.approximate) notes.push('A large group of linked skill sources uses a fixed sample approximation. Very rare joint outcomes may be missed.');
  if (coverage.conflicts.length) notes.push('Some goal skills compete for event choices. This estimate follows the current prioritized-skill order.');
  if (moments.approximateRank > 0.001) notes.push(`${(100 * moments.approximateRank).toFixed(1)}% of predicted ranks use Crazyfellow's additional below-B or UE star-rate estimates.`);
  return {
    probability: issues.length ? null : skills.all * moments.blueAllWhiteStars * pink!.probability!,
    issues, notes, blue: moments.blue, pink, allAvailable: skills.allAvailable, pSS: moments.pSS,
    required: required.map((target, i) => ({ target, available: skills.available[i]!, probability: skills.each[i]! * moments.whiteStars[goal.required.findIndex((r) => r.id === target.id)]! })),
    preferred: preferred.map((target) => {
      const m = whiteGenerationMoments(jointSkillForms([target], coverage.map, ctx.data, ctx.settings), [copies(target)], ctx.settings);
      return { target, available: m.available[0]!, probability: m.each[0]! * moments.preferredStars };
    }),
  };
}
