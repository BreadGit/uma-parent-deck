import type { Card } from '../types.ts';
import type { Ctx } from './deck.ts';
import { cardSourcesForTarget, lineageSources, resolveTarget, scenarioCompletionSources, traineeSources, type SkillSource, type Target } from './sparks.ts';

/**
 * Reuse fixed sources within one synchronous plan. Recreate after any input or settings edit.
 * Every candidate shares the returned arrays, so a reader copies before it mutates.
 * Event sources are not cached here: `sparks.ts` already memoizes them per card and trainee.
 */
export function prepareRunSources(ctx: Pick<Ctx, 'data' | 'settings' | 'races' | 'totalTurns' | 'trainee' | 'raceWins' | 'lineage'>) {
  const { data, settings, races, totalTurns, trainee, raceWins, lineage } = ctx;
  const targets = new Map<number, Target | null>();
  const cards = new WeakMap<Card, Map<number, WeakMap<Target, SkillSource[]>>>();
  const traineeByTarget = new WeakMap<Target, SkillSource[]>();
  const completion = new WeakMap<Target, SkillSource[]>();
  return {
    target(id: number): Target | null {
      if (!targets.has(id)) targets.set(id, resolveTarget(id, data));
      return targets.get(id)!;
    },
    card(card: Card, lb: number, target: Target): SkillSource[] {
      let levels = cards.get(card);
      if (!levels) { levels = new Map(); cards.set(card, levels); }
      let sources = levels.get(lb);
      if (!sources) { sources = new WeakMap(); levels.set(lb, sources); }
      if (!sources.has(target)) sources.set(target, cardSourcesForTarget(card, lb, target, races, totalTurns, data, settings));
      return sources.get(target)!;
    },
    trainee(target: Target): SkillSource[] {
      if (!traineeByTarget.has(target)) traineeByTarget.set(target, [
        ...(trainee ? traineeSources(trainee, target, data, settings, raceWins) : []),
        ...lineageSources(target, lineage.get(target.id), settings),
      ]);
      return traineeByTarget.get(target)!;
    },
    completion(target: Target): SkillSource[] {
      if (!completion.has(target)) completion.set(target, scenarioCompletionSources(target, data, settings));
      return completion.get(target)!;
    },
  };
}
export type PreparedRunSources = ReturnType<typeof prepareRunSources>;
