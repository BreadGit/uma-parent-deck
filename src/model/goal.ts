import { STATS, APTITUDE_KEYS, type AptKey, type Grade } from '../types.ts';
import type { Ctx, DeckResult } from './deck.ts';
import { DEFAULT_SETTINGS, whiteGenerationBands, type Settings } from '../settings.ts';
import { affinityMultiplier } from './inherit.ts';
import { APTITUDE_LABELS, type ParentGoal, type ResolvedGoal, type PinkSpark } from './goal-input.ts';
import { BLUE_GENERATION_BANDS, PINK_GENERATION_RATES, INSPIRATION_EVENTS } from './rules.ts';
import { hasWhiteSpark, lineageCount, resolveTarget, type Target } from './sparks.ts';
import { jointSkillForms, projectForms, whiteGenerationMoments, type FormDistribution } from './goal-skills.ts';
import { phi } from './stats.ts';
import { MAX_STAT_VALUE, statScore, thresholdFor } from './rank.ts';

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

export interface PinkEstimate { probability: number; upperProbability: number; warnings: string[]; eligibility: { aptitude: AptKey; probability: number | null }[] }
export function pinkEstimate(apt: Record<AptKey, Grade>, target: ParentGoal['pink'], stars: number, lineage: (PinkSpark | null)[], affinity: number, rates = DEFAULT_SETTINGS.pinkInspirationRates): PinkEstimate {
  const warnings: string[] = [];
  const eligibility = APTITUDE_KEYS.map((key) => {
    if (apt[key] === 'A' || apt[key] === 'S') return { aptitude: key, probability: 1 };
    const matching = lineage.filter((p): p is PinkSpark => p?.aptitude === key);
    if (!matching.length) return { aptitude: key, probability: 0 };
    if (apt[key] !== 'B') return { aptitude: key, probability: null };
    const miss = matching.reduce((p, spark) => p * (1 - Math.min(1, rates[spark.stars - 1]! * affinityMultiplier({ affinity }))) ** INSPIRATION_EVENTS, 1);
    return { aptitude: key, probability: 1 - miss };
  });
  const starRate = starChance(PINK_GENERATION_RATES, stars);
  if (target === 'any' && eligibility.some((e) => e.probability === 1)) {
    return { probability: starRate, upperProbability: starRate, warnings, eligibility };
  }
  for (const e of eligibility.filter((e) => e.probability === null)) warnings.push(`${APTITUDE_LABELS[e.aptitude]} starts below B with matching pink sparks. The range allows it to finish either below A or at A/S.`);
  const bound = (upper: boolean) => {
    const chance = (e: typeof eligibility[number]) => e.probability ?? Number(target === 'any' || e.aptitude === target ? upper : !upper);
    if (target === 'any') return (1 - eligibility.reduce((p, e) => p * (1 - chance(e)), 1)) * starRate;
    const desired = chance(eligibility.find((e) => e.aptitude === target)!);
    // The count of other eligible aptitudes is a Poisson-binomial distribution.
    let count = [1];
    for (const e of eligibility.filter((e) => e.aptitude !== target)) {
      const next = Array<number>(count.length + 1).fill(0), p = chance(e);
      count.forEach((mass, k) => { next[k]! += mass * (1 - p); next[k + 1]! += mass * p; });
      count = next;
    }
    return desired * starRate * count.reduce((p, mass, k) => p + mass / (k + 1), 0);
  };
  return { probability: bound(false), upperProbability: bound(true), warnings, eligibility };
}

export interface GoalStats { rawMean: number[]; sd: number[]; caps?: number[]; skillPoints: number; skillSd: number }
export interface StatGoalMoments { blue: number; whiteStars: number[]; blueAllWhiteStars: number; preferredStars: number; pSS: number; approximateRank: number }
export interface GoalRankBands { blue: number; rank: number[]; blueRank: number[]; pSS: number; approximateRank: number }
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
export function statGoalMoments(input: GoalStats, goal: ResolvedGoal, ssThreshold: number, settings: Settings = DEFAULT_SETTINGS, basis = goalRankBands(input, goal, ssThreshold, settings)): StatGoalMoments {
  const bands = whiteGenerationBands(settings);
  const quality = (stars: number[]) => bands.map((band) => stars.reduce((p, n) => p * starChance(band.rates, n), 1));
  const mean = (weights: number[], rates: number[]) => weights.reduce((p, w, i) => p + w * rates[i]!, 0);
  return { blue: basis.blue, whiteStars: goal.required.map((r) => mean(basis.rank, quality([r.stars]))),
    blueAllWhiteStars: goal.required.every((r) => r.stars === 1) ? basis.blue : mean(basis.blueRank, quality(goal.required.map((r) => r.stars))),
    preferredStars: mean(basis.rank, quality([2])), pSS: basis.pSS, approximateRank: basis.approximateRank };
}

/** Shared rank weights let every required subset and preferred intersection reuse the same outcomes. */
export function goalRankBands(input: GoalStats, goal: ParentGoal, ssThreshold: number, settings: Settings = DEFAULT_SETTINGS): GoalRankBands {
  const bands = whiteGenerationBands(settings);
  const result: GoalRankBands = { blue: 0, rank: bands.map(() => 0), blueRank: bands.map(() => 0), pSS: 0, approximateRank: 0 };
  const masses = input.rawMean.map((mean, i) => statMasses(mean, input.sd[i] ?? 0, input.caps?.[i]));
  const distributions = masses.map(statDistribution);
  const draws = input.sd.every((sd) => sd === 0) ? [[.5, .5, .5, .5, .5]] : statSamples();
  const statRatings = draws.map((draw) => distributions.map((distribution, i) => statScore(sampleStat(distribution, draw[i]!))));
  const scores = statRatings.map((ratings) => ratings.reduce((sum, rating) => sum + rating, input.skillPoints));
  for (const score of scores) {
    const below = (limit: number) => input.skillSd > 0 ? phi((limit - score) / input.skillSd) : Number(score < limit);
    result.pSS += (1 - below(ssThreshold)) / draws.length;
    bands.forEach((band, i) => {
      const upper = bands[i + 1]?.min;
      const weight = ((upper === undefined ? 1 : below(upper)) - (i === 0 ? 0 : below(band.min))) / draws.length;
      result.rank[i]! += weight;
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
      for (let n = 0; n < draws.length; n++) {
        const score = scores[n]! - statRatings[n]![i]! + statScore(sampleStat(distribution, draws[n]![i]!));
        let abovePrevious = 1;
        for (let j = 0; j < bands.length; j++) {
          const next = bands[j + 1]?.min;
          const above = next === undefined ? 0 : input.skillSd > 0 ? phi((score - next) / input.skillSd) : Number(score >= next);
          result.blueRank[j]! += blue * (abovePrevious - above) / draws.length;
          abovePrevious = above;
        }
      }
    });
  });
  return result;
}

export interface GoalWhiteEstimate { target: Target; available: number; probability: number }
export interface GoalEstimate {
  probability: number | null;
  upperProbability: number | null;
  issues: string[];
  notes: string[];
  blue: number;
  pink: PinkEstimate;
  required: GoalWhiteEstimate[];
  preferred: GoalWhiteEstimate[];
  allAvailable: number;
  pSS: number;
}
export function evaluateParentGoal(goal: ResolvedGoal, pinkLineage: (PinkSpark | null)[], apt: Record<AptKey, Grade>, deck: Pick<DeckResult, 'coverage' | 'conflicts'>, ctx: Ctx, stats: GoalStats, runIssues: string[], basis?: GoalRankBands, forms?: FormDistribution): GoalEstimate {
  const issues = [...runIssues];
  if (!ctx.trainee) issues.push('Choose the trainee to estimate the parent goal.');
  if (!goal.blueStats.length) issues.push('Choose at least one acceptable blue stat.');
  const required = goal.required.map((r) => resolveTarget(r.id, ctx.data)).filter((t): t is Target => !!t);
  if (required.length !== goal.required.length || new Set(required.map((t) => t.id)).size !== required.length) issues.push('Each required white spark must be a different valid skill family.');
  const preferred = goal.preferred.map((id) => resolveTarget(id, ctx.data)).filter((t): t is Target => !!t && !required.some((r) => r.id === t.id));
  const coverage = deck.coverage;
  const joint = forms ? projectForms(forms, required.map((_, i) => i)) : jointSkillForms(required, coverage, ctx.data, ctx.settings);
  const copies = (t: Target) => { const l = ctx.lineage.get(t.id); return l ? lineageCount(l) : 0; };
  const skills = whiteGenerationMoments(joint, required.map(copies), ctx.settings);
  const moments = statGoalMoments(stats, goal, thresholdFor('SS', ctx.data.ranks), ctx.settings, basis);
  const pink = pinkEstimate(apt, goal.pink, goal.pinkStars, pinkLineage, ctx.settings.affinity, ctx.settings.pinkInspirationRates);
  const notes = ['Known pink lineage determines starting aptitude grades. Grades outside the starting-inheritance range remain planning overrides. Inspiration estimates additional mid-run increases.', 'Available target skills and their best available upgrades are assumed purchased. Skill acquisition is modeled independently of the stat and rank outcomes.'];
  for (const target of [...required, ...preferred]) if (!hasWhiteSpark(target)) notes.push(`${target.name} has no released white form and cannot generate a white spark. Its saved target and lineage are retained for review.`);
  if (pinkLineage.length < 6 || pinkLineage.some((spark) => spark === null)) notes.push('Empty pink slots count as zero sparks for this estimate. Only entered or estimated sparks contribute additional aptitude increases.');
  if (goal.pink === 'any') notes.push('Any pink aptitude counts toward the goal. With an A/S aptitude already eligible, only the minimum stars affect its chance.');
  if (pinkLineage.some((spark) => spark?.inferred)) notes.push('Some pink sparks are minimum-star estimates inferred from starting aptitude increases. Other lineages can produce the same grades. Refine them in Legacy > Pink sparks.');
  if (skills.approximate) notes.push('A large group of linked skill sources uses a fixed sample approximation. Very rare joint outcomes may be missed.');
  if (deck.conflicts.length) notes.push('Some goal skills compete for event choices. This estimate follows the current prioritized-skill order.');
  if (moments.approximateRank > 0.001) notes.push(`${(100 * moments.approximateRank).toFixed(1)}% of predicted ranks use Crazyfellow's additional below-B or UE star-rate estimates.`);
  return {
    probability: issues.length ? null : skills.all * moments.blueAllWhiteStars * pink.probability,
    upperProbability: issues.length ? null : skills.all * moments.blueAllWhiteStars * pink.upperProbability,
    issues, notes, blue: moments.blue, pink, allAvailable: skills.allAvailable, pSS: moments.pSS,
    required: required.map((target, i) => ({ target, available: skills.available[i]!, probability: skills.each[i]! * moments.whiteStars[goal.required.findIndex((r) => r.id === target.id)]! })),
    preferred: preferred.map((target) => {
      const single = forms ? projectForms(forms, [required.length + goal.preferred.indexOf(target.id)]) : jointSkillForms([target], coverage, ctx.data, ctx.settings);
      const m = whiteGenerationMoments(single, [copies(target)], ctx.settings);
      return { target, available: m.available[0]!, probability: m.each[0]! * moments.preferredStars };
    }),
  };
}
