import { preferredWeight, type ResolvedGoal } from './goal-input.ts';
import { starChance, type GoalRankBands, type PinkEstimate } from './goal.ts';
import { subsetGeneration, type FormDistribution } from './goal-skills.ts';
import { lineageCount, resolveTarget } from './sparks.ts';
import { whiteGenerationBands, type Settings } from '../settings.ts';
import type { Ctx } from './deck.ts';

export interface GoalScore {
  count: number;
  total: number;
  comparison: number; // common positive pink factor removed, so a zero pink lower bound can still rank decks
  probability: number;
  upperProbability: number;
  preferred: number; // weighted preferred appearances conditional on the selected required subset succeeding
  whiteIds: number[];
  blue: boolean;
  pink: boolean;
  approximate: boolean;
  subsetApproximate: boolean;
}

/** Anchor every tie to the best probability in the whole set, never to a preceding near-tie. */
export function chooseGoal<T extends { score: GoalScore; key: string; statPower: number }>(candidates: T[], tolerance: number): T {
  if (!candidates.length) throw new Error('No goal candidates');
  const count = Math.max(...candidates.map((c) => c.score.count));
  const sameCount = candidates.filter((c) => c.score.count === count);
  const best = Math.max(...sameCount.map((c) => c.score.comparison));
  const tied = sameCount.filter((c) => c.score.comparison >= best * (1 - tolerance) && (best === 0 || c.score.comparison > 0));
  const bestPreferred = Math.max(...tied.map((c) => c.score.preferred));
  // Ignore relative roundoff without treating rare positive scores as zero. Anchor to one maximum
  // so a chain of pairwise near-equalities cannot change the winner with candidate order.
  const preferred = tied.filter((c) => bestPreferred - c.score.preferred <= bestPreferred * 1e-12);
  return preferred.sort((a, b) => b.score.comparison - a.score.comparison || (count === 0 ? b.statPower - a.statPower : 0) || a.key.localeCompare(b.key))[0]!;
}

export interface GoalSources { forms: FormDistribution; copies: number[] }
export function goalSources(goal: ResolvedGoal, forms: FormDistribution, ctx: Ctx): GoalSources {
  const targets = [...goal.required.map((r) => r.id), ...goal.preferred.map((p) => p.id)].map((id) => resolveTarget(id, ctx.data)!);
  return { forms, copies: targets.map((t) => { const l = ctx.lineage.get(t.id); return l ? lineageCount(l) : 0; }) };
}

/** Score complete success first; bounded subset exploration supplies a useful fallback for zero goals. */
export function scoreGoal(goal: ResolvedGoal, sources: GoalSources, basis: GoalRankBands, pink: PinkEstimate, settings: Settings): GoalScore {
  const bands = whiteGenerationBands(settings), { forms, copies } = sources;
  const generated = new Map<string, number>();
  const generation = (indices: number[]) => {
    const key = indices.join(',');
    let p = generated.get(key);
    if (p === undefined) { p = subsetGeneration(forms, copies, indices, settings); generated.set(key, p); }
    return p;
  };
  const quality = (indices: number[], blue: boolean) => {
    if (indices.every((i) => goal.required[i]!.stars === 1)) return blue ? basis.blue : 1;
    return (blue ? basis.blueRank : basis.rank).reduce((p, weight, band) => p + weight * indices.reduce((v, i) => v * starChance(bands[band]!.rates, goal.required[i]!.stars), 1), 0);
  };
  const approximate = forms.components.some((c) => c.distribution.approximate);
  const make = (indices: number[], blue: boolean): GoalScore => {
    const chance = generation(indices) * quality(indices, blue);
    let preferred = 0;
    if (chance > 0) for (let i = 0; i < goal.preferred.length; i++) {
      preferred += generation([...indices, goal.required.length + i]) * quality(indices, blue) * preferredWeight(goal.preferred[i]!.priority) / chance;
    }
    const hasPink = pink.upperProbability > 0;
    return { count: indices.length + Number(blue) + Number(hasPink), total: goal.required.length + 2,
      comparison: chance, probability: chance * (hasPink ? pink.probability : 1), upperProbability: chance * (hasPink ? pink.upperProbability : 1), preferred,
      whiteIds: indices.map((i) => goal.required[i]!.id), blue, pink: hasPink, approximate, subsetApproximate: false };
  };
  const all = goal.required.map((_, i) => i);
  const full = make(all, true);
  if (full.comparison > 0) return full;
  // Remove individually zero requirements before exploring conflicts. Fifty independent families stay cheap.
  const possible = all.filter((i) => generation([i]) * quality([i], false) > 0);
  let frontier = [{ indices: possible, blue: basis.blue > 0 }];
  const seen = new Set<string>(), successes: { score: GoalScore; key: string; statPower: number }[] = [];
  let visited = 0, bounded = false;
  while (frontier.length) {
    const next: typeof frontier = [];
    for (const { indices, blue } of frontier) {
      const key = `${Number(blue)}:${indices.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (++visited > 192) { bounded = true; break; }
      const score = make(indices, blue);
      if (score.comparison > 0) successes.push({ score, key, statPower: 0 });
      else {
        for (const i of indices) next.push({ indices: indices.filter((j) => i !== j), blue });
        if (blue) next.push({ indices, blue: false });
      }
    }
    if (successes.length || visited > 192) break;
    if (next.length > 64) bounded = true;
    frontier = next.slice(0, 64);
  }
  // Reserve 64 checks to construct a useful subset if the breadth-first search ran out of room.
  if (!successes.length) {
    bounded = true;
    const blue = basis.blue > 0;
    let retained: number[] = [], score = make(retained, blue);
    for (const i of possible.slice(0, 64)) {
      const next = make([...retained, i], blue);
      if (next.comparison > 0) { retained = [...retained, i]; score = next; }
    }
    successes.push({ score, key: retained.join(','), statPower: 0 });
  }
  // Keep this deck's strongest subset. Applying the relative window here and again across decks
  // would allow two successive sacrifices of required-goal chance.
  return { ...chooseGoal(successes, 0).score, subsetApproximate: bounded };
}
