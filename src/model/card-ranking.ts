import type { Card } from '../types.ts';
import type { CardScore, Ctx } from './deck.ts';
import { preferredWeight, type WhiteTarget } from './goal-input.ts';
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
    const stars = goal.role === 'required' ? goal.stars : 1;
    const lineage = ctx.lineage.get(target.id);
    const probability = hasWhiteSpark(target)
      ? sparkChance(purchasedOwnership(target, combineSources(sources)), ctx.settings, lineage ? lineageCount(lineage) : 0) * starChance(rates, stars) : 0;
    targets.push({ target, role: goal.role, stars, probability, sources });
    if (goal.role === 'required') required += probability;
    else preferred += probability * preferredWeight(goal.priority);
  }
  targets.sort((a, b) => Number(b.role === 'required') - Number(a.role === 'required'));
  return { targets, required, preferred, statPower: card.statPower };
}

/** Totals order the cards, but are not themselves probabilities of a complete goal. */
export const compareTargetChances = (a: CardTargetChances, b: CardTargetChances) =>
  b.required - a.required || b.preferred - a.preferred || b.statPower - a.statPower;

/** The order a deck's cards are shown in: pins first, as pinned, then the other owned cards best first, then the friend's card. */
export function deckDisplayOrder<T extends { card: Pick<Card, 'id'>; borrowed?: boolean }>(deck: T[], pinnedIds: number[], compare: (a: T, b: T) => number): T[] {
  const group = (e: T) => (e.borrowed ? 2 : pinnedIds.includes(e.card.id) ? 0 : 1);
  return deck.slice().sort((a, b) => group(a) - group(b)
    || (group(a) === 0 ? pinnedIds.indexOf(a.card.id) - pinnedIds.indexOf(b.card.id) : group(a) === 1 ? compare(a, b) || a.card.id - b.card.id : 0));
}

/**
 * Ranking rows: every pin first, as pinned, then the rest of the suggested deck in the order the deck shows it,
 * then the other cards under the selected sort. Pins and the deck stay on top whatever the sort, so a card edited
 * in the inventory does not move away from the rows being worked on.
 */
export function rankingRows<T extends { card: Pick<Card, 'id'> }>(ranking: T[], pinnedIds: number[], deckOrder: { card: Pick<Card, 'id'> }[], compare: (a: T, b: T) => number): T[] {
  const top = [...pinnedIds, ...deckOrder.map((e) => e.card.id).filter((id) => !pinnedIds.includes(id))];
  const position = (e: T) => { const i = top.indexOf(e.card.id); return i < 0 ? top.length : i; };
  return ranking.slice().sort((a, b) => position(a) - position(b) || compare(a, b));
}
