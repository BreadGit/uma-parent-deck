import type { Card } from '../types.ts';
import type { Ctx } from './deck.ts';
import { cardSourcesForTarget, eventSources, lineageSources, resolveTarget, scenarioCompletionSources, traineeEventSources, traineeSources, type EventSource, type SkillSource, type Target } from './sparks.ts';

/** Reuse fixed sources within one synchronous plan. Recreate after any input or settings edit. */
export function prepareRunSources(ctx: Pick<Ctx, 'data' | 'settings' | 'races' | 'totalTurns' | 'trainee' | 'raceWins' | 'lineage'>) {
  const { data, settings, races, totalTurns, trainee, raceWins, lineage } = ctx;
  const targets = new Map<number, Target | null>();
  const cards = new WeakMap<Card, Map<number, WeakMap<Target, SkillSource[]>>>();
  const events = new WeakMap<Card, EventSource[]>();
  const traineeByTarget = new WeakMap<Target, SkillSource[]>();
  const completion = new WeakMap<Target, SkillSource[]>();
  const traineeEvents = trainee ? traineeEventSources(trainee, raceWins, settings, data) : [];
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
    cardEvents(card: Card): EventSource[] {
      if (!events.has(card)) events.set(card, eventSources(card, settings, data));
      return events.get(card)!;
    },
    traineeEvents,
  };
}
export type PreparedRunSources = ReturnType<typeof prepareRunSources>;
