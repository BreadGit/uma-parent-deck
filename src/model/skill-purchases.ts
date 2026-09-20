import type { Card, Skill } from '../types.ts';
import { purchaseCoverage, type Ctx } from './deck.ts';
import { jointSkillForms, type FormDistribution } from './goal-skills.ts';
import { resolveTarget, type Target } from './sparks.ts';
import { skillScore } from './rank.ts';
import type { Aptitudes } from './races.ts';

export interface Purchases {
  targets: Target[];        // every family the run buys: the goal's targets, then the listed extras it has a source for
  forms: FormDistribution;  // the forms the run ends up owning, from its sources
  score: number;            // expected rating of the owned forms
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
