import type { CardScore, Ctx } from './deck.ts';
import type { WhiteTarget } from './goal-input.ts';
import { starChance } from './goal.ts';
import { thresholdFor } from './rank.ts';
import { whiteGenerationBands } from '../settings.ts';
import { combineSources, hasWhiteSpark, lineageCount, purchasedOwnership, resolveTarget, sparkChance, type SkillSource, type Target } from './sparks.ts';

export interface TargetSparkChance {
  target: Target;
  role: WhiteTarget['role'];
  stars: number;
  probability: number;
  sources: SkillSource[];
}
export interface CardTargetChances { targets: TargetSparkChance[]; required: number; preferred: number; statPower: number }

/** Card-only acquisition, with the same event choices as its coverage and a fixed SS star distribution.
 * Coverage for a card alone also contains scenario rewards. Those do not belong to this comparison.
 * Lineage still boosts generation, but trainee, lineage hints and other cards do not supply skills here.
 */
export function cardTargetChances(card: CardScore, goals: WhiteTarget[], ctx: Ctx): CardTargetChances {
  const ss = thresholdFor('SS', ctx.data.ranks);
  const rates = whiteGenerationBands(ctx.settings).filter((band) => band.min <= ss).at(-1)!.rates;
  const targets: TargetSparkChance[] = [];
  let required = 0, preferred = 0;
  for (const goal of goals) {
    const target = resolveTarget(goal.id, ctx.data);
    if (!target) continue;
    const sources = (card.coverage.find((c) => c.target.id === target.id)?.sources ?? []).filter((s) => s.kind !== 'scenario');
    const stars = goal.role === 'required' ? goal.stars : 2;
    const lineage = ctx.lineage.get(target.id);
    const probability = hasWhiteSpark(target)
      ? sparkChance(purchasedOwnership(target, combineSources(sources)), ctx.settings, lineage ? lineageCount(lineage) : 0) * starChance(rates, stars) : 0;
    targets.push({ target, role: goal.role, stars, probability, sources });
    if (goal.role === 'required') required += probability;
    else preferred += probability;
  }
  targets.sort((a, b) => Number(b.role === 'required') - Number(a.role === 'required'));
  return { targets, required, preferred, statPower: card.statPower };
}

/** Totals order the cards, but are not themselves probabilities of a complete goal. */
export const compareTargetChances = (a: CardTargetChances, b: CardTargetChances) =>
  b.required - a.required || b.preferred - a.preferred || b.statPower - a.statPower;
