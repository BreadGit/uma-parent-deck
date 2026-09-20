import type { Card, Skill } from '../types.ts';
import { purchaseCoverage, type Ctx } from './deck.ts';
import { jointSkillForms, type FormDistribution } from './goal-skills.ts';
import { combineSources, purchasedOwnership, resolveTarget, type SkillSource, type Target } from './sparks.ts';
import { skillScore } from './rank.ts';
import type { Aptitudes } from './races.ts';
import { SCENARIO_COMPLETION_SKILLS } from './rules.ts';

export interface SkillRating {
  score: number;
  pointsPerSp: number;
  referenceRate: number;
  referenceSp: number;     // SP valued at the deck-independent reference rate
  fallback: boolean;       // no obtainable priced forms
  unverified: number[];    // forms using the rarity-based rating fallback
}

export interface Purchases {
  targets: Target[];        // goal and listed families; unavailable goals retain zero forms for goal evaluation
  forms: FormDistribution;  // the forms the run ends up owning, from its sources
  score: number;            // rating of these target forms only; Rank uses SkillRating separately
  variance: number;
  spent: number;            // worst-case SP: the best obtainable form of every family with its prerequisites, at full price
  incomplete: boolean;      // a family's price is unknown, so `spent` is a lower bound
  unverified: number[];     // owned forms without a verified rating
}

/** A family's forms in purchase order; form n of a state string is the nth of these. An unreleased form cannot be bought. */
const formsOf = (t: Target) => [t.white, t.circle, t.gold] as const;
const usable = (s: Skill | null | undefined): s is Skill => !!s && !s.unreleasedEn;
/** Rating of a family owned at a form: only the highest form counts. */
const pointsAt = (t: Target, form: number, apt: Aptitudes) => { const s = form > 0 ? formsOf(t)[form - 1] : null; return usable(s) ? skillScore(s, apt) : 0; };
/** Full price of a form with its prerequisites, or null when a price is unknown. */
function costAt(t: Target, form: number): number | null {
  const needed = formsOf(t).slice(0, form).filter(usable);
  if (!needed.length || needed.some((s) => s.cost == null)) return null;
  return needed.reduce((a, s) => a + s.cost!, 0);
}

/**
 * Expected rating and its spread over the target form outcomes. Components are independent, so their variances add.
 * These spark distributions can omit gold-only families and rare outcomes; purchase costs use source coverage.
 */
export function purchasesFromForms(targets: Target[], forms: FormDistribution, apt: Aptitudes): Pick<Purchases, 'score' | 'variance' | 'unverified'> {
  let score = 0, variance = 0;
  const rated = new Set<number>();
  for (const { indices, distribution } of forms.components) {
    let mean = 0, second = 0;
    for (const [state, p] of distribution.states) {
      if (p <= 0) continue;
      let points = 0;
      indices.forEach((index, i) => {
        const form = Number(state[i]), t = targets[index]!;
        points += pointsAt(t, form, apt);
        const s = form > 0 ? formsOf(t)[form - 1] : null;
        if (usable(s)) rated.add(s.id);
      });
      mean += p * points; second += p * points * points;
    }
    score += mean; variance += Math.max(0, second - mean * mean);
  }
  const unverified = targets.flatMap((t) => formsOf(t).filter((s): s is Skill => usable(s) && rated.has(s.id) && s.rating === undefined).map((s) => s.id));
  return { score, variance, unverified };
}

/** Full price of each family's highest obtainable form, independent of spark eligibility and joint sampling. */
function costFromCoverage(targets: Target[], coverage: Map<number, SkillSource[]>): Pick<Purchases, 'spent' | 'incomplete'> {
  let spent = 0, incomplete = false;
  for (const t of targets) {
    let best = 0;
    for (const source of coverage.get(t.id) ?? []) {
      if (source.pObtain <= 0) continue;
      const form = source.gold ? 3 : source.circle || usable(t.circle) ? 2 : 1;
      if (usable(formsOf(t)[form - 1])) best = Math.max(best, form);
    }
    if (!best) continue;
    const cost = costAt(t, best);
    if (cost == null) incomplete = true;
    else spent += cost;
  }
  return { spent, incomplete };
}

/**
 * What the run buys: every required and preferred target, and every listed extra the run has a source for. A skill
 * can only be bought once the run has it (a hint or an event option), so the forms come from the sources under the
 * context's list; every form owned is then bought at full price. `spent` is that worst case, to check against the
 * estimated SP.
 */
export function estimatePurchases(deck: { card: Card; lb: number }[], goalTargets: Target[], ctx: Ctx, apt: Aptitudes): Purchases {
  const families = new Map(goalTargets.map((t) => [t.id, t]));
  for (const id of ctx.priority ?? []) {
    const t = ctx.sources ? ctx.sources.target(id) : resolveTarget(id, ctx.data);
    if (t && !families.has(t.id)) families.set(t.id, t);
  }
  const all = [...families.values()];
  const coverage = purchaseCoverage(deck, all, ctx);
  const goalIds = new Set(goalTargets.map((t) => t.id));
  const targets = all.filter((t) => goalIds.has(t.id) || (coverage.get(t.id)?.length ?? 0) > 0);
  const forms = jointSkillForms(targets, coverage, ctx.data);
  return { targets, forms, ...purchasesFromForms(targets, forms, apt), ...costFromCoverage(targets, coverage) };
}

interface SpendingPoint { cost: number; points: number; unverified: number[] }
interface SpendingSegment { cost: number; rate: number; unverified: number[] }

/** Upper concave envelope of the optional forms, including buying nothing. Slopes decrease along the hull. */
function spendingSegments(options: SpendingPoint[], probability: number): SpendingSegment[] {
  const hull: SpendingPoint[] = [{ cost: 0, points: 0, unverified: [] }];
  for (const next of options.slice().sort((a, b) => a.cost - b.cost || b.points - a.points)) {
    const last = hull.at(-1)!;
    if (next.cost === last.cost || next.points <= last.points) continue;
    while (hull.length >= 2) {
      const a = hull.at(-2)!, b = hull.at(-1)!;
      if ((b.points - a.points) * (next.cost - b.cost) > (next.points - b.points) * (b.cost - a.cost)) break;
      hull.pop();
    }
    hull.push(next);
  }
  return hull.slice(1).map((end, i) => {
    const start = hull[i]!;
    return { cost: probability * (end.cost - start.cost), rate: (end.points - start.points) / (end.cost - start.cost),
      unverified: [...start.unverified, ...end.unverified] };
  });
}

/**
 * Spend on optional forms above a deck-independent reference rate, then value the remaining SP at that rate.
 * Each availability outcome supplies a fractional, probability-weighted spending envelope. This is an expected
 * capacity approximation, not a literal shopping list: shared availability and realized budgets are not simulated.
 */
export function ratingFromCoverage(targets: Target[], coverage: Map<number, SkillSource[]>, sp: number, apt: Aptitudes, skills: Skill[]): SkillRating {
  let referencePoints = 0, referenceCost = 0;
  const referenceUnverified: number[] = [];
  for (const skill of skills) {
    if (!usable(skill) || skill.rarity !== 1 || /[◎×]/.test(skill.name) || skill.cost == null || skill.cost <= 0) continue;
    referencePoints += skillScore(skill, apt); referenceCost += skill.cost;
    if (skill.rating === undefined) referenceUnverified.push(skill.id);
  }
  const referenceRate = referenceCost > 0 ? referencePoints / referenceCost : 0;
  const segments: SpendingSegment[] = [];
  for (const t of [...new Map(targets.map((t) => [t.id, t])).values()].sort((a, b) => a.id - b.id)) {
    const own = purchasedOwnership(t, combineSources(coverage.get(t.id) ?? []));
    const options: SpendingPoint[] = [];
    [own.pWhite, own.pCircle, own.pGold].forEach((probability, i) => {
      const skill = formsOf(t)[i], cost = costAt(t, i + 1);
      if (usable(skill) && cost !== null && cost > 0) {
        options.push({ cost, points: skillScore(skill, apt), unverified: skill.rating === undefined ? [skill.id] : [] });
      }
      if (probability > 0) segments.push(...spendingSegments(options, probability));
    });
  }
  const budget = Math.max(0, sp);
  let remaining = budget, score = budget * referenceRate;
  const unverified = new Set<number>();
  for (const segment of segments.sort((a, b) => b.rate - a.rate)) {
    if (remaining <= 0 || segment.rate <= referenceRate) break;
    const spent = Math.min(remaining, segment.cost);
    score += spent * (segment.rate - referenceRate);
    remaining -= spent;
    segment.unverified.forEach((id) => unverified.add(id));
  }
  if (remaining > 0) referenceUnverified.forEach((id) => unverified.add(id));
  return { score, pointsPerSp: budget > 0 ? score / budget : referenceRate, referenceRate, referenceSp: remaining,
    fallback: segments.length === 0, unverified: [...unverified].sort((a, b) => a - b) };
}

/** All modeled sources can inform rank spending, including unlisted hints, innate skills and automatic rewards. */
export function estimateSkillRating(deck: { card: Card; lb: number }[], ctx: Ctx, sp: number, apt: Aptitudes): SkillRating {
  const completion = SCENARIO_COMPLETION_SKILLS[ctx.settings.scenarioId];
  const ids = [...(ctx.priority ?? []), ...ctx.lineage.keys(), ...deck.flatMap(({ card }) => [...card.hintSkills, ...card.eventSkills]),
    ...(ctx.trainee ? [...ctx.trainee.innateSkills, ...ctx.trainee.awakeningSkills, ...ctx.trainee.eventSkills] : []),
    ...ctx.data.scenarioEvents.filter((e) => e.scenarioId === ctx.settings.scenarioId).flatMap((e) => e.choices.flatMap((c) => [c.skill, c.whiteSkill, c.goldSkill])),
    ...(completion ? [completion.white, completion.gold] : [])];
  const targets = [...new Map(ids.flatMap((id) => {
    const t = id === undefined ? null : ctx.sources ? ctx.sources.target(id) : resolveTarget(id, ctx.data);
    return t ? [[t.id, t] as const] : [];
  })).values()];
  return ratingFromCoverage(targets, purchaseCoverage(deck, targets, ctx), sp, apt, ctx.data.skills);
}
