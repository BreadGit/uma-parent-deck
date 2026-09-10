import { STATS, APTITUDE_KEYS, type AptKey, type Data, type Stat } from '../types.ts';
import { resolveTarget } from './sparks.ts';

export const APTITUDE_LABELS: Record<AptKey, string> = { turf: 'Turf', dirt: 'Dirt', sprint: 'Sprint', mile: 'Mile', medium: 'Medium', long: 'Long', front: 'Front Runner', pace: 'Pace Chaser', late: 'Late Surger', end: 'End Closer' };
export interface WhiteGoal { id: number; stars: number }
export interface WhiteTarget extends WhiteGoal { role: 'required' | 'preferred' }
export interface ParentGoal {
  enabled: boolean;
  blueStats: Stat[];
  blueStars: number;
  pink: AptKey | 'any';
  pinkStars: number;
}
/** Derived for evaluation, never persisted alongside the target list. */
export interface ResolvedGoal extends ParentGoal { required: WhiteGoal[]; preferred: number[] }
export function goalWithTargets(goal: ParentGoal, targets: WhiteTarget[]): ResolvedGoal {
  return { ...goal, required: targets.filter((t) => t.role === 'required').map(({ id, stars }) => ({ id, stars })), preferred: targets.filter((t) => t.role === 'preferred').map((t) => t.id) };
}
export interface PinkSpark { aptitude: AptKey; stars: number; inferred?: true }
export const DEFAULT_GOAL: ParentGoal = { enabled: false, blueStats: [...STATS], blueStars: 2, pink: 'any', pinkStars: 2 };
/** Null slots represent zero entered sparks and contribute no aptitude increases to the estimate. */
export const emptyPinkLineage = (): (PinkSpark | null)[] => Array.from({ length: 6 }, () => null);
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const stars = (v: unknown) => typeof v === 'number' && [1, 2, 3].includes(v) ? v : 2;
export const goalFamily = (id: unknown, data: Data): number | null => {
  if (typeof id !== 'number') return null;
  const t = resolveTarget(id, data);
  const skill = t?.white && !t.white.unreleasedEn ? t.white : t?.gold;
  return skill && !skill.unreleasedEn && !skill.name.includes('×') ? t!.id : null;
};
export function sanitizeGoal(raw: unknown): ParentGoal {
  const v = object(raw);
  return {
    enabled: v.enabled === true,
    blueStats: Array.isArray(v.blueStats) ? STATS.filter((s) => (v.blueStats as unknown[]).includes(s)) : [...STATS],
    blueStars: stars(v.blueStars), pink: APTITUDE_KEYS.includes(v.pink as AptKey) ? v.pink as AptKey : 'any', pinkStars: stars(v.pinkStars),
  };
}

/** Keep target order and migrate the former goal lists into one authoritative list. */
export function sanitizeTargets(raw: unknown, data: Data, oldGoal?: unknown): WhiteTarget[] {
  const targets = new Map<number, WhiteTarget>();
  for (const value of Array.isArray(raw) ? raw : []) {
    const entry = typeof value === 'number' ? { id: value } : object(value);
    const id = goalFamily(entry.id, data);
    if (id !== null && !targets.has(id)) targets.set(id, { id, role: entry.role === 'required' ? 'required' : 'preferred', stars: stars(entry.stars) });
  }
  const goal = object(oldGoal), required = new Set<number>();
  for (const value of Array.isArray(goal.required) ? goal.required : []) {
    const entry = object(value), id = goalFamily(entry.id, data);
    if (id === null || required.has(id)) continue;
    required.add(id); targets.set(id, { id, role: 'required', stars: stars(entry.stars) });
  }
  for (const value of Array.isArray(goal.preferred) ? goal.preferred : []) {
    const id = goalFamily(value, data);
    if (id !== null && !targets.has(id)) targets.set(id, { id, role: 'preferred', stars: 2 });
  }
  return [...targets.values()];
}
export function sanitizePinkLineage(raw: unknown): (PinkSpark | null)[] {
  return emptyPinkLineage().map((_, i) => {
    const v = object(Array.isArray(raw) ? raw[i] : undefined);
    return APTITUDE_KEYS.includes(v.aptitude as AptKey) && typeof v.stars === 'number' && [1, 2, 3].includes(v.stars)
      ? { aptitude: v.aptitude as AptKey, stars: v.stars, ...(v.inferred === true ? { inferred: true as const } : {}) } : null;
  });
}
