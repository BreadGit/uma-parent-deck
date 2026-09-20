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
  fallback: boolean;       // no obtainable priced forms; use released white skills as the reference pool
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
 * Every owned form is bought: the expected rating and its spread over the form outcomes, and the worst-case price of
 * the best form each family can reach, whatever the SP budget. Components are independent, so their variances add.
 */
export function purchasesFromForms(targets: Target[], forms: FormDistribution, apt: Aptitudes): Omit<Purchases, 'targets' | 'forms'> {
  let score = 0, variance = 0, spent = 0, incomplete = false;
  const best = Array<number>(targets.length).fill(0);
  const rated = new Set<number>();
  for (const { indices, distribution } of forms.components) {
    let mean = 0, second = 0;
    for (const [state, p] of distribution.states) {
      if (p <= 0) continue;
      let points = 0;
      indices.forEach((index, i) => {
        const form = Number(state[i]), t = targets[index]!;
        points += pointsAt(t, form, apt);
        if (form > best[index]!) best[index] = form;
        const s = form > 0 ? formsOf(t)[form - 1] : null;
        if (usable(s)) rated.add(s.id);
      });
      mean += p * points; second += p * points * points;
    }
    score += mean; variance += Math.max(0, second - mean * mean);
  }
  targets.forEach((t, i) => { if (!best[i]) return; const cost = costAt(t, best[i]!); if (cost == null) incomplete = true; else spent += cost; });
  const unverified = targets.flatMap((t) => formsOf(t).filter((s): s is Skill => usable(s) && rated.has(s.id) && s.rating === undefined).map((s) => s.id));
  return { score, variance, spent, incomplete, unverified };
}

/**
 * What the run buys: every required and preferred target, and every listed extra the run has a source for. A skill
 * can only be bought once the run has it (a hint or an event option), so the forms come from the sources under the
 * context's list; every form owned is then bought at full price. `spent` is that worst case, to check against the
 * estimated SP.
 */
export function estimatePurchases(deck: { card: Card; lb: number }[], goalTargets: Target[], ctx: Ctx, apt: Aptitudes): Purchases {
  const families = new Map(goalTargets.map((t) => [t.id, t]));
  for (const id of ctx.priority) {
    const t = ctx.sources ? ctx.sources.target(id) : resolveTarget(id, ctx.data);
    if (t && !families.has(t.id)) families.set(t.id, t);
  }
  const all = [...families.values()];
  const coverage = purchaseCoverage(deck, all, ctx);
  const goalIds = new Set(goalTargets.map((t) => t.id));
  const targets = all.filter((t) => goalIds.has(t.id) || (coverage.get(t.id)?.length ?? 0) > 0);
  const forms = jointSkillForms(targets, coverage, ctx.data);
  return { targets, forms, ...purchasesFromForms(targets, forms, apt) };
}

/**
 * Spend the entire SP estimate at the pool's expected rating / expected full-price cost. Each family contributes
 * only its highest obtainable form, weighted by source probability, with prerequisites included in cost.
 * This extrapolates spending efficiency, not a literal shopping list or a budget for the goal's sparks.
 */
export function ratingFromCoverage(targets: Target[], coverage: Map<number, SkillSource[]>, sp: number, apt: Aptitudes, skills: Skill[]): SkillRating {
  let points = 0, cost = 0;
  const unverified = new Set<number>();
  const add = (skill: Skill, probability: number, price: number) => {
    points += probability * skillScore(skill, apt);
    cost += probability * price;
    if (skill.rating === undefined) unverified.add(skill.id);
  };
  for (const t of targets) {
    const own = purchasedOwnership(t, combineSources(coverage.get(t.id) ?? []));
    [own.pWhite, own.pCircle, own.pGold].forEach((probability, i) => {
      const skill = formsOf(t)[i], price = costAt(t, i + 1);
      if (probability > 0 && usable(skill) && price !== null && price > 0) add(skill, probability, price);
    });
  }
  const fallback = cost === 0;
  if (fallback) for (const skill of skills) {
    if (usable(skill) && skill.rarity === 1 && !/[◎×]/.test(skill.name) && skill.cost != null && skill.cost > 0) add(skill, 1, skill.cost);
  }
  const pointsPerSp = cost > 0 ? points / cost : 0;
  return { score: Math.max(0, sp) * pointsPerSp, pointsPerSp, fallback, unverified: [...unverified] };
}

/** All modeled sources can inform rank spending, including unlisted hints, innate skills and automatic rewards. */
export function estimateSkillRating(deck: { card: Card; lb: number }[], ctx: Ctx, sp: number, apt: Aptitudes): SkillRating {
  const completion = SCENARIO_COMPLETION_SKILLS[ctx.settings.scenarioId];
  const ids = [...ctx.priority, ...ctx.lineage.keys(), ...deck.flatMap(({ card }) => [...card.hintSkills, ...card.eventSkills]),
    ...(ctx.trainee ? [...ctx.trainee.innateSkills, ...ctx.trainee.awakeningSkills, ...ctx.trainee.eventSkills] : []),
    ...ctx.data.scenarioEvents.filter((e) => e.scenarioId === ctx.settings.scenarioId).flatMap((e) => e.choices.flatMap((c) => [c.skill, c.whiteSkill, c.goldSkill])),
    ...(completion ? [completion.white, completion.gold] : [])];
  const targets = [...new Map(ids.flatMap((id) => {
    const t = id === undefined ? null : ctx.sources ? ctx.sources.target(id) : resolveTarget(id, ctx.data);
    return t ? [[t.id, t] as const] : [];
  })).values()];
  return ratingFromCoverage(targets, purchaseCoverage(deck, targets, ctx), sp, apt, ctx.data.skills);
}
