import { STATS, APTITUDE_KEYS, type AptKey, type Grade } from '../types.ts';
import type { Ctx, DeckResult } from './deck.ts';
import { DEFAULT_SETTINGS, whiteGenerationBands, type Settings } from '../settings.ts';
import { affinityMultiplier } from './inherit.ts';
import { APTITUDE_LABELS, type ParentGoal, type PinkGoal, type ResolvedGoal, type PinkSpark } from './goal-input.ts';
import { BLUE_GENERATION_BANDS, PINK_GENERATION_RATES, INSPIRATION_EVENTS } from './rules.ts';
import { hasWhiteSpark, lineageCount, resolveTarget, type Target } from './sparks.ts';
import { jointSkillForms, projectForms, whiteGenerationMoments, type FormDistribution } from './goal-skills.ts';
import { phi } from './stats.ts';
import { statMasses, type StatMass, type StatDistribution } from './stat-outcomes.ts';
import { statScore, thresholdFor } from './rank.ts';

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

export interface PinkEstimate { probability: number; upperProbability: number; warnings: string[]; eligibility: { aptitude: AptKey; probability: number | null }[]; alternatives?: (PinkGoal & { probability: number; upperProbability: number })[] }
export function pinkEstimate(apt: Record<AptKey, Grade>, target: PinkGoal['aptitude'], stars: number, lineage: (PinkSpark | null)[], affinity: number, rates = DEFAULT_SETTINGS.pinkInspirationRates): PinkEstimate {
  return pinkGoalsEstimate(apt, [{ aptitude: target, stars }], lineage, affinity, rates);
}

/** Enumerate shared eligibility scenarios so alternatives with different thresholds have consistent bounds. */
export function pinkGoalsEstimate(apt: Record<AptKey, Grade>, goals: PinkGoal[], lineage: (PinkSpark | null)[], affinity: number, rates = DEFAULT_SETTINGS.pinkInspirationRates): PinkEstimate {
  const eligibility = APTITUDE_KEYS.map((key) => {
    if (apt[key] === 'A' || apt[key] === 'S') return { aptitude: key, probability: 1 };
    const matching = lineage.filter((p): p is PinkSpark => p?.aptitude === key);
    if (!matching.length) return { aptitude: key, probability: 0 };
    if (apt[key] !== 'B') return { aptitude: key, probability: null };
    const miss = matching.reduce((p, spark) => p * (1 - Math.min(1, rates[spark.stars - 1]! * affinityMultiplier({ affinity }))) ** INSPIRATION_EVENTS, 1);
    return { aptitude: key, probability: 1 - miss };
  });
  const unknown = eligibility.filter((e) => e.probability === null);
  const warnings = unknown.map((e) => `${APTITUDE_LABELS[e.aptitude]} starts below B with matching pink sparks. The range allows it to finish either below A or at A/S.`);
  const alternatives = goals.map((g) => ({ ...g, probability: Infinity, upperProbability: 0 }));
  let probability = Infinity, upperProbability = 0;
  for (let scenario = 0; scenario < 2 ** unknown.length; scenario++) {
    const chances = eligibility.map((e) => e.probability ?? Number(!!(scenario & (1 << unknown.indexOf(e)))));
    const contributions = goals.map(() => 0);
    const visit = (i: number, mass: number, selected: number[]) => {
      if (mass === 0) return;
      if (i < chances.length) {
        visit(i + 1, mass * (1 - chances[i]!), selected);
        visit(i + 1, mass * chances[i]!, [...selected, i]);
        return;
      }
      if (!selected.length) return;
      goals.forEach((g, j) => {
        const share = g.aptitude === 'any' ? 1 : Number(selected.some((k) => eligibility[k]!.aptitude === g.aptitude)) / selected.length;
        contributions[j]! += mass * share * starChance(PINK_GENERATION_RATES, g.stars);
      });
    };
    visit(0, 1, []);
    const total = contributions.reduce((sum, p) => sum + p, 0);
    probability = Math.min(probability, total);
    upperProbability = Math.max(upperProbability, total);
    alternatives.forEach((g, i) => { g.probability = Math.min(g.probability, contributions[i]!); g.upperProbability = Math.max(g.upperProbability, contributions[i]!); });
  }
  return { probability, upperProbability, warnings: probability === upperProbability ? [] : warnings, eligibility, alternatives };
}

export interface GoalStats { rawMean: number[]; sd: number[]; caps?: number[]; skillPoints: number; skillSd: number; rawUnits?: boolean }
export interface StatGoalMoments { blue: number; whiteStars: number[]; blueAllWhiteStars: number; pSS: number; approximateRank: number }
export interface GoalRankBands { blue: number; rank: number[]; blueRank: number[]; pSS: number; approximateRank: number }
function halton(index: number, base: number): number {
  let value = 0, fraction = 1 / base;
  while (index > 0) { value += fraction * (index % base); index = Math.floor(index / base); fraction /= base; }
  return value;
}
const samples = new Map<number, number[][]>();
function statSamples(count: number): number[][] {
  if (!samples.has(count)) samples.set(count, Array.from({ length: count }, (_, i) => [2, 3, 5, 7, 11].map((base) => halton(i + 1, base))));
  return samples.get(count)!;
}

function statDistribution(outcomes: readonly StatMass[]): StatDistribution {
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

const sampledRatings = new WeakMap<readonly StatMass[], Map<string, { mass: number; ratings: number[] }>>();
/** Neighboring decks often share stat distributions. Reuse their deterministic draws across skill budgets. */
function ratingSamples(outcomes: readonly StatMass[], dimension: number, count: number, band = -1) {
  let cached = sampledRatings.get(outcomes);
  if (!cached) { cached = new Map(); sampledRatings.set(outcomes, cached); }
  const key = `${dimension}:${count}:${band}`;
  const hit = cached.get(key);
  if (hit) return hit;
  const distribution = statDistribution(band < 0 ? outcomes : outcomes.filter(({ value }) =>
    value >= BLUE_GENERATION_BANDS[band]!.min && value < (BLUE_GENERATION_BANDS[band + 1]?.min ?? Infinity)));
  const draws = count === 0 ? [[.5, .5, .5, .5, .5]] : statSamples(count);
  const result = { mass: distribution.mass, ratings: distribution.mass === 0 ? [] : draws.map((draw) => statScore(sampleStat(distribution, draw[dimension]!))) };
  cached.set(key, result);
  return result;
}

/** Integrate blue bands analytically; sample rank conditional on each selected stat and blue band. */
export function statGoalMoments(input: GoalStats, goal: ResolvedGoal, ssThreshold: number, settings: Settings = DEFAULT_SETTINGS, basis = goalRankBands(input, goal, ssThreshold, settings)): StatGoalMoments {
  const bands = whiteGenerationBands(settings);
  const quality = (stars: number[]) => bands.map((band) => stars.reduce((p, n) => p * starChance(band.rates, n), 1));
  const mean = (weights: number[], rates: number[]) => weights.reduce((p, w, i) => p + w * rates[i]!, 0);
  return { blue: basis.blue, whiteStars: goal.required.map((r) => mean(basis.rank, quality([r.stars]))),
    blueAllWhiteStars: goal.required.every((r) => r.stars === 1) ? basis.blue : mean(basis.blueRank, quality(goal.required.map((r) => r.stars))),
    pSS: basis.pSS, approximateRank: basis.approximateRank };
}

/** Shared rank weights let every required subset and preferred intersection reuse the same outcomes. */
export function goalRankBands(input: GoalStats, goal: ParentGoal, ssThreshold: number, settings: Settings = DEFAULT_SETTINGS, sampleCount = 2048): GoalRankBands {
  const bands = whiteGenerationBands(settings);
  const result: GoalRankBands = { blue: 0, rank: bands.map(() => 0), blueRank: bands.map(() => 0), pSS: 0, approximateRank: 0 };
  const masses = input.rawMean.map((mean, i) => statMasses(mean, input.sd[i] ?? 0, input.caps?.[i], input.rawUnits));
  const count = input.sd.every((sd) => sd === 0) ? 0 : sampleCount;
  const statRatings = masses.map((outcomes, i) => ratingSamples(outcomes, i, count).ratings);
  const draws = statRatings[0]!.length;
  const scores = Array.from({ length: draws }, (_, n) => statRatings.reduce((sum, ratings) => sum + ratings[n]!, input.skillPoints));
  for (const score of scores) {
    const below = (limit: number) => input.skillSd > 0 ? phi((limit - score) / input.skillSd) : Number(score < limit);
    result.pSS += (1 - below(ssThreshold)) / draws;
    bands.forEach((band, i) => {
      const upper = bands[i + 1]?.min;
      const weight = ((upper === undefined ? 1 : below(upper)) - (i === 0 ? 0 : below(band.min))) / draws;
      result.rank[i]! += weight;
      if (band.approximate) result.approximateRank += weight;
    });
  }
  STATS.forEach((stat, i) => {
    if (!goal.blueStats.includes(stat)) return;
    BLUE_GENERATION_BANDS.forEach((band, b) => {
      const samples = ratingSamples(masses[i]!, i, count, b);
      const blue = samples.mass * starChance(band.rates, goal.blueStars) / STATS.length;
      result.blue += blue;
      if (blue === 0) return;
      for (let n = 0; n < draws; n++) {
        const score = scores[n]! - statRatings[i]![n]! + samples.ratings[n]!;
        let abovePrevious = 1;
        for (let j = 0; j < bands.length; j++) {
          const next = bands[j + 1]?.min;
          const above = next === undefined ? 0 : input.skillSd > 0 ? phi((score - next) / input.skillSd) : Number(score >= next);
          result.blueRank[j]! += blue * (abovePrevious - above) / draws;
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
  const preferred = goal.preferred.map(({ id }) => resolveTarget(id, ctx.data)).filter((t): t is Target => !!t && !required.some((r) => r.id === t.id));
  const coverage = deck.coverage;
  const joint = forms ? projectForms(forms, required.map((_, i) => i)) : jointSkillForms(required, coverage, ctx.data);
  const copies = (t: Target) => { const l = ctx.lineage.get(t.id); return l ? lineageCount(l) : 0; };
  const skills = whiteGenerationMoments(joint, required.map(copies), ctx.settings);
  const moments = statGoalMoments(stats, goal, thresholdFor('SS', ctx.data.ranks), ctx.settings, basis);
  const pink = pinkGoalsEstimate(apt, goal.pink, pinkLineage, ctx.settings.affinity, ctx.settings.pinkInspirationRates);
  const notes = ['Known pink lineage determines starting aptitude grades. Grades outside the starting-inheritance range remain planning overrides. Inspiration estimates additional mid-run increases.', 'Target purchases share the predicted SP budget. Required base skills come first, then preferred bases and upgrades. Hint discounts and remaining purchases follow the assumptions in Predicted run. Skill purchases are still approximated independently of stat and rank outcomes.'];
  for (const target of [...required, ...preferred]) if (!hasWhiteSpark(target)) notes.push(`${target.name} has no released white form and cannot generate a white spark. Its saved target and lineage are retained for review.`);
  if (pinkLineage.length < 6 || pinkLineage.some((spark) => spark === null)) notes.push('Empty pink slots count as zero sparks for this estimate. Only entered or estimated sparks contribute additional aptitude increases.');
  if (goal.pink[0]?.aptitude === 'any') notes.push('Any pink aptitude counts toward the goal. With an A/S aptitude already eligible, only the minimum stars affect its chance.');
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
      const single = forms ? projectForms(forms, [required.length + goal.preferred.findIndex((p) => p.id === target.id)]) : jointSkillForms([target], coverage, ctx.data);
      const m = whiteGenerationMoments(single, [copies(target)], ctx.settings);
      return { target, available: m.available[0]!, probability: m.each[0]! };
    }),
  };
}
