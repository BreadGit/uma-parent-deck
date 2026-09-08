import { STATS, type AptKey, type Card, type Grade } from '../types.ts';
import { type Ctx, evaluate, traineeCoverage } from './deck.ts';
import { APTITUDE_KEYS, APTITUDE_LABELS, type ParentGoal, type PinkSpark } from './goal-input.ts';
import { BLUE_GENERATION_BANDS, WHITE_GENERATION_BANDS, PINK_GENERATION_RATES, PINK_INSPIRATION_RATES, INSPIRATION_EVENTS, OUR_GRAND_CONCERT } from './rules.ts';
import { cardSourcesForTarget, lineageCount, resolveTarget, type Target } from './sparks.ts';
import { jointSkillForms, whiteGenerationMoments } from './goal-skills.ts';
import { phi } from './stats.ts';
import { statScore } from './rank.ts';

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

export interface PinkEstimate { probability: number | null; issues: string[]; eligibility: { aptitude: AptKey; probability: number | null }[] }
export function pinkEstimate(apt: Record<AptKey, Grade>, target: AptKey, stars: number, lineage: (PinkSpark | null)[], affinity: number): PinkEstimate {
  const issues: string[] = [];
  const unknown = lineage.length !== 6 || lineage.some((p) => p === null);
  const eligibility = APTITUDE_KEYS.map((key) => {
    if (apt[key] === 'A' || apt[key] === 'S') return { aptitude: key, probability: 1 };
    const matching = lineage.filter((p): p is PinkSpark => p?.aptitude === key);
    if (unknown) return { aptitude: key, probability: null };
    if (!matching.length) return { aptitude: key, probability: 0 };
    if (apt[key] !== 'B') {
      issues.push(`${APTITUDE_LABELS[key]} starts below B and has matching pink sparks. Its chance of reaching A is outside this estimate.`);
      return { aptitude: key, probability: null };
    }
    const miss = matching.reduce((p, spark) => p * (1 - Math.min(1, PINK_INSPIRATION_RATES[spark.stars]! * (1 + affinity / 100))) ** INSPIRATION_EVENTS, 1);
    return { aptitude: key, probability: 1 - miss };
  });
  if (unknown && eligibility.some((e) => e.probability === null)) issues.unshift('Enter all six pink lineage sparks in Legacy to include aptitude increases and competing pink types.');
  if (issues.length) return { probability: null, issues, eligibility };
  const desired = eligibility.find((e) => e.aptitude === target)!.probability!;
  // The count of other eligible aptitudes is a Poisson-binomial distribution.
  let count = [1];
  for (const e of eligibility.filter((e) => e.aptitude !== target)) {
    const next = Array<number>(count.length + 1).fill(0), p = e.probability!;
    count.forEach((mass, k) => { next[k]! += mass * (1 - p); next[k + 1]! += mass * p; });
    count = next;
  }
  return { probability: desired * starChance(PINK_GENERATION_RATES, stars) * count.reduce((p, mass, k) => p + mass / (k + 1), 0), issues, eligibility };
}

export interface GoalStats { rawMean: number[]; sd: number[]; caps?: number[]; skillPoints: number; skillSd: number }
export interface StatGoalMoments { blue: number; whiteStars: number[]; blueBothWhiteStars: number; preferredStars: number; pSS: number; approximateRank: number }
function halton(index: number, base: number): number {
  let value = 0, fraction = 1 / base;
  while (index > 0) { value += fraction * (index % base); index = Math.floor(index / base); fraction /= base; }
  return value;
}
function normalQuantile(p: number): number {
  let low = -8, high = 8;
  for (let i = 0; i < 32; i++) { const mid = (low + high) / 2; if (phi(mid) < p) low = mid; else high = mid; }
  return (low + high) / 2;
}
let samples: number[][] | undefined;
function statSamples(): number[][] {
  return samples ??= Array.from({ length: 2048 }, (_, i) => [2, 3, 5, 7, 11].map((base) => normalQuantile(halton(i + 1, base))));
}

/** Share each sampled statline between blue bands and rank; integrate rank's remaining skill uncertainty. */
export function statGoalMoments(input: GoalStats, goal: ParentGoal): StatGoalMoments {
  const result: StatGoalMoments = { blue: 0, whiteStars: [0, 0], blueBothWhiteStars: 0, preferredStars: 0, pSS: 0, approximateRank: 0 };
  const draws = input.sd.every((sd) => sd === 0) ? [[0, 0, 0, 0, 0]] : statSamples();
  for (const draw of draws) {
    const stats = input.rawMean.map((mean, i) => Math.max(0, Math.round(Math.min(input.caps?.[i] ?? Infinity, mean + draw[i]! * (input.sd[i] ?? 0)))));
    const blue = blueChance(stats, goal.blueStats, goal.blueStars);
    const score = stats.reduce((a, v) => a + statScore(v), input.skillPoints);
    const below = (limit: number) => input.skillSd > 0 ? phi((limit - score) / input.skillSd) : Number(score < limit);
    result.blue += blue / draws.length;
    result.pSS += (1 - below(17500)) / draws.length;
    WHITE_GENERATION_BANDS.forEach((band, i) => {
      const upper = WHITE_GENERATION_BANDS[i + 1]?.min;
      const weight = ((upper === undefined ? 1 : below(upper)) - (i === 0 ? 0 : below(band.min))) / draws.length;
      const stars = goal.required.map((r) => starChance(band.rates, r.stars));
      stars.forEach((p, j) => { result.whiteStars[j]! += p * weight; });
      result.blueBothWhiteStars += blue * stars[0]! * stars[1]! * weight;
      result.preferredStars += starChance(band.rates, 2) * weight;
      if (band.approximate) result.approximateRank += weight;
    });
  }
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
  bothAvailable: number;
  pSS: number;
}
export function evaluateParentGoal(goal: ParentGoal, pinkLineage: (PinkSpark | null)[], apt: Record<AptKey, Grade>, deck: { card: Card; lb: number }[], ctx: Ctx, stats: GoalStats, runIssues: string[]): GoalEstimate {
  const issues = [...runIssues];
  if (!ctx.trainee) issues.push('Choose the trainee to estimate the parent goal.');
  if (ctx.settings.scenarioId !== OUR_GRAND_CONCERT) issues.push('Parent goals currently estimate Our Grand Concert independent training.');
  if (!goal.blueStats.length) issues.push('Choose at least one acceptable blue stat.');
  if (!goal.pink) issues.push('Choose a pink spark target.');
  const required = goal.required.map((r) => r.id === null ? null : resolveTarget(r.id, ctx.data)).filter((t): t is Target => !!t);
  if (required.length !== 2 || required[0]?.id === required[1]?.id) issues.push('Choose two different required white skills.');
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
  const pink = goal.pink ? pinkEstimate(apt, goal.pink, goal.pinkStars, pinkLineage, ctx.settings.affinity) : null;
  issues.push(...(pink?.issues ?? []));
  const notes = ['Available target skills and their best available upgrades are assumed purchased. Skill acquisition is modeled independently of the stat and rank outcomes.'];
  if (coverage.conflicts.length) notes.push('Some goal skills compete for event choices. This estimate follows the current prioritized-skill order.');
  if (moments.approximateRank > 0.001) notes.push(`${(100 * moments.approximateRank).toFixed(1)}% of predicted ranks use Crazyfellow's additional below-B or UE star-rate estimates.`);
  return {
    probability: issues.length ? null : skills.both * moments.blueBothWhiteStars * pink!.probability!,
    issues, notes, blue: moments.blue, pink, bothAvailable: skills.bothAvailable, pSS: moments.pSS,
    required: required.map((target, i) => ({ target, available: skills.available[i]!, probability: skills.each[i]! * moments.whiteStars[goal.required.findIndex((r) => r.id === target.id)]! })),
    preferred: preferred.map((target) => {
      const m = whiteGenerationMoments(jointSkillForms([target], coverage.map, ctx.data, ctx.settings), [copies(target)], ctx.settings);
      return { target, available: m.available[0]!, probability: m.each[0]! * moments.preferredStars };
    }),
  };
}
