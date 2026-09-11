import { isPlainObject, type Inventory } from './types.ts';
import type { Settings } from './settings.ts';
import type { DeckSelection, GoalSearchSummary, RunInput } from './model/run.ts';
import type { GoalScore } from './model/goal-objective.ts';

export interface SavedRecommendation {
  build: string;
  key: string;
  selection: DeckSelection;
  summary: GoalSearchSummary;
}

/** Object ordering can change during migration; array ordering remains part of the input. */
export function planningKey(run: RunInput, settings: Settings, inventory: Inventory): string {
  return JSON.stringify([run, settings, inventory], (_, value: unknown) => isPlainObject(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value);
}

const nonnegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const integer = (v: unknown): v is number => nonnegative(v) && Number.isInteger(v);
const ids = (v: unknown): v is number[] => Array.isArray(v) && v.every(integer);
const score = (v: unknown): v is GoalScore => isPlainObject(v)
  && integer(v.count) && integer(v.total) && v.count <= v.total
  && ['comparison', 'probability', 'upperProbability', 'preferred'].every((key) => nonnegative(v[key]))
  && ids(v.whiteIds) && ['blue', 'pink', 'approximate', 'subsetApproximate'].every((key) => typeof v[key] === 'boolean');

/** A cache is disposable. Malformed entries never enter the run-state migration path. */
export function parseRecommendation(raw: unknown): SavedRecommendation | undefined {
  if (!isPlainObject(raw) || typeof raw.build !== 'string' || typeof raw.key !== 'string') return;
  if (!Array.isArray(raw.selection) || !raw.selection.every((e) => isPlainObject(e) && integer(e.id)
    && integer(e.lb) && e.lb <= 4 && (e.borrowed === undefined || typeof e.borrowed === 'boolean'))) return;
  const summary = raw.summary;
  if (!isPlainObject(summary) || !score(summary.score) || !integer(summary.evaluated) || !integer(summary.screened)
    || typeof summary.exhaustive !== 'boolean' || !ids(summary.unavailableWhiteIds)
    || !Array.isArray(summary.alternatives) || !summary.alternatives.every((a) => isPlainObject(a) && integer(a.cardId) && score(a.score))) return;
  return { build: raw.build, key: raw.key, selection: raw.selection as DeckSelection, summary: summary as unknown as GoalSearchSummary };
}
