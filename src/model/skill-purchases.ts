import type { Card, Skill } from '../types.ts';
import { purchaseCoverage, type Ctx } from './deck.ts';
import { jointSkillForms, type FormDistribution } from './goal-skills.ts';
import { combineSources, isDebuff, purchasedOwnership, resolveTarget, type SkillSource, type Target } from './sparks.ts';
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

export interface SpCost { total: number; incomplete: boolean; items: { target: Target; skill: Skill | null; cost: number | null; purchases: Skill[] }[] }

export interface Purchases {
  targets: Target[];        // goal and listed families; unavailable goals retain zero forms for goal evaluation
  forms: FormDistribution;  // the forms the run ends up owning, from its sources. Rank spends SP separately (SkillRating).
  spent: number;            // worst-case SP: the best obtainable form of every family with its prerequisites, at full price
  extrasSpent: number;      // the listed extras' share of `spent`; the rest is the goal's targets
  incomplete: boolean;      // a family's price is unknown, so `spent` is a lower bound
}

/** A form the run can buy: released and not a debuff. */
const usable = (s: Skill | null | undefined): s is Skill => !!s && !s.unreleasedEn && !isDebuff(s);
/** A family's forms in purchase order; form n of a state string is the nth of these. */
const formsOf = (t: Target) => [t.white, t.circle, t.gold] as const;
/** Full price of a form with its prerequisites, or null when a price is unknown. */
function costAt(t: Target, form: number): number | null {
  const needed = formsOf(t).slice(0, form).filter(usable);
  if (!needed.length || needed.some((s) => s.cost == null)) return null;
  return needed.reduce((a, s) => a + s.cost!, 0);
}

/**
 * Worst-case SP for the best purchasable form of each target, including every prerequisite. Each family is bought
 * once, with no hint discounts or probability weighting. Gold needs a hint; a released ◎ upgrade does not.
 */
export function targetSpCost(targets: Target[], coverage: Map<number, SkillSource[]>): SpCost {
  const items: SpCost['items'] = [];
  let total = 0, incomplete = false;
  for (const t of new Map(targets.map((t) => [t.id, t])).values()) {
    const own = purchasedOwnership(t, combineSources(coverage.get(t.id) ?? []));
    const circle = usable(t.circle) ? t.circle : null;
    const skill = own.pGold > 1e-9 && usable(t.gold) ? t.gold : circle ?? t.white ?? t.gold;
    const purchases = [...new Map([t.white, circle, skill].filter(usable).map((s) => [s.id, s])).values()];
    if (!purchases.length) continue; // nothing of this family can be bought (a debuff, or only unreleased forms)
    const cost = purchases.some((s) => s.cost == null) ? null : purchases.reduce((a, s) => a + s.cost!, 0);
    if (cost == null) incomplete = true; else total += cost;
    items.push({ target: t, skill, cost, purchases });
  }
  return { total, incomplete, items };
}

/**
 * What the run buys: every required and preferred target, and every listed extra the run has a source for. A skill
 * can only be bought once the run has it (a hint or an event option), so the forms come from the sources under the
 * context's list. The cost is the worst case, every obtainable family at full price, to check against the estimated
 * SP; it reads the resolved sources directly, so rare outcomes the joint form sampling misses still count.
 */
export function estimatePurchases(deck: { card: Card; lb: number }[], goalTargets: Target[], ctx: Ctx): Purchases {
  const families = new Map(goalTargets.map((t) => [t.id, t]));
  for (const id of ctx.priority ?? []) {
    const t = ctx.sources ? ctx.sources.target(id) : resolveTarget(id, ctx.data);
    if (t && !families.has(t.id)) families.set(t.id, t);
  }
  const all = [...families.values()];
  const coverage = purchaseCoverage(deck, all, ctx);
  const goalIds = new Set(goalTargets.map((t) => t.id));
  const obtainable = (t: Target) => (coverage.get(t.id) ?? []).some((s) => s.pObtain > 0);
  const targets = all.filter((t) => goalIds.has(t.id) || obtainable(t));
  const forms = jointSkillForms(targets, coverage, ctx.data);
  const goalCost = targetSpCost(targets.filter((t) => goalIds.has(t.id) && obtainable(t)), coverage);
  const extrasCost = targetSpCost(targets.filter((t) => !goalIds.has(t.id)), coverage);
  return { targets, forms, spent: goalCost.total + extrasCost.total, extrasSpent: extrasCost.total, incomplete: goalCost.incomplete || extrasCost.incomplete };
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

interface Reference { rate: number; unverified: number[] }
const referenceCache = new WeakMap<Skill[], Map<string, Reference>>();
/**
 * Rating per SP over every released, priced, purchasable white skill (no ◎ form, no debuff), at the trainee's
 * aptitudes. Independent of the deck, so it is computed once per skill list and aptitude set: the deck search
 * evaluates thousands of candidates against it.
 */
function referenceRate(skills: Skill[], apt: Aptitudes): Reference {
  const key = JSON.stringify(apt);
  const byApt = referenceCache.get(skills) ?? new Map<string, Reference>();
  referenceCache.set(skills, byApt);
  const cached = byApt.get(key);
  if (cached) return cached;
  let points = 0, cost = 0;
  const unverified: number[] = [];
  for (const skill of skills) {
    if (!usable(skill) || skill.rarity !== 1 || skill.name.includes('◎') || skill.cost == null || skill.cost <= 0) continue;
    points += skillScore(skill, apt); cost += skill.cost;
    if (skill.rating === undefined) unverified.push(skill.id);
  }
  const reference = { rate: cost > 0 ? points / cost : 0, unverified };
  byApt.set(key, reference);
  return reference;
}

/**
 * Spend on optional forms above a deck-independent reference rate, then value the remaining SP at that rate.
 * Each availability outcome supplies a fractional, probability-weighted spending envelope. This is an expected
 * capacity approximation, not a literal shopping list: shared availability and realized budgets are not simulated.
 */
export function ratingFromCoverage(targets: Target[], coverage: Map<number, SkillSource[]>, sp: number, apt: Aptitudes, skills: Skill[]): SkillRating {
  const reference = referenceRate(skills, apt);
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
  let remaining = budget, score = budget * reference.rate;
  const unverified = new Set<number>();
  for (const segment of segments.sort((a, b) => b.rate - a.rate)) {
    if (remaining <= 0 || segment.rate <= reference.rate) break;
    const spent = Math.min(remaining, segment.cost);
    score += spent * (segment.rate - reference.rate);
    remaining -= spent;
    segment.unverified.forEach((id) => unverified.add(id));
  }
  if (remaining > 0) reference.unverified.forEach((id) => unverified.add(id));
  return { score, pointsPerSp: budget > 0 ? score / budget : reference.rate, referenceRate: reference.rate, referenceSp: remaining,
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
