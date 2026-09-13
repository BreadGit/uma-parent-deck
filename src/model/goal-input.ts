import { STATS, APTITUDE_KEYS, isPlainObject, type AptKey, type Data, type Stat } from '../types.ts';
import { resolveTarget } from './sparks.ts';

export const APTITUDE_LABELS: Record<AptKey, string> = { turf: 'Turf', dirt: 'Dirt', sprint: 'Sprint', mile: 'Mile', medium: 'Medium', long: 'Long', front: 'Front Runner', pace: 'Pace Chaser', late: 'Late Surger', end: 'End Closer' };
export interface WhiteGoal { id: number; stars: number }
export interface PreferredGoal { id: number; priority: number }
export interface WhiteTarget extends WhiteGoal, PreferredGoal { role: 'required' | 'preferred' }
export const sanitizePriority = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;
export const preferredWeight = (priority: number): number => 2 ** -sanitizePriority(priority);
export interface PinkGoal { aptitude: AptKey | 'any'; stars: number }
export interface ParentGoal {
  blueStats: Stat[];
  blueStars: number;
  pink: PinkGoal[];
}
/** Derived for evaluation, never persisted alongside the target list. */
export interface ResolvedGoal extends ParentGoal { required: WhiteGoal[]; preferred: PreferredGoal[] }
export function goalWithTargets(goal: ParentGoal, targets: WhiteTarget[]): ResolvedGoal {
  return { ...goal, required: targets.filter((t) => t.role === 'required').map(({ id, stars }) => ({ id, stars })), preferred: targets.filter((t) => t.role === 'preferred').map(({ id, priority }) => ({ id, priority })) };
}
export interface PinkSpark { aptitude: AptKey; stars: number; inferred?: true }
export const DEFAULT_GOAL: ParentGoal = { blueStats: [...STATS], blueStars: 2, pink: [{ aptitude: 'any', stars: 1 }] };
/** Null slots represent zero entered sparks and contribute no aptitude increases to the estimate. */
export const emptyPinkLineage = (): (PinkSpark | null)[] => Array.from({ length: 6 }, () => null);
const object = (v: unknown): Record<string, unknown> => isPlainObject(v) ? v : {};
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
    blueStats: Array.isArray(v.blueStats) ? STATS.filter((s) => (v.blueStats as unknown[]).includes(s)) : [...STATS],
    blueStars: stars(v.blueStars),
    pink: sanitizePinkGoals(Array.isArray(v.pink) ? v.pink : 'pink' in v || 'pinkStars' in v
      ? [{ aptitude: APTITUDE_KEYS.includes(v.pink as AptKey) ? v.pink : 'any', stars: stars(v.pinkStars) }] : []),
  };
}

export function sanitizePinkGoals(raw: unknown): PinkGoal[] {
  const entries = new Map<PinkGoal['aptitude'], PinkGoal>();
  for (const value of Array.isArray(raw) ? raw : []) {
    const v = object(value), aptitude = v.aptitude as PinkGoal['aptitude'];
    if ((aptitude === 'any' || APTITUDE_KEYS.includes(aptitude)) && !entries.has(aptitude)) entries.set(aptitude, { aptitude, stars: stars(v.stars) });
  }
  if (entries.size > 1) entries.delete('any');
  return entries.size ? [...entries.values()] : [{ aptitude: 'any', stars: 1 }];
}

/** Older saves used family aliases. Current saves retain stable IDs even if their family changes later. */
export function savedTargetId(id: unknown, data: Data, preserveIds = false): number | null {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
  return preserveIds ? id : goalFamily(id, data) ?? id;
}

/** Keep target order and migrate the former goal lists into one authoritative list. */
export function sanitizeTargets(raw: unknown, data: Data, oldGoal?: unknown, preserveIds = false): WhiteTarget[] {
  const targets = new Map<number, WhiteTarget>();
  for (const value of Array.isArray(raw) ? raw : []) {
    const entry = typeof value === 'number' ? { id: value } : object(value);
    const id = savedTargetId(entry.id, data, preserveIds);
    if (id !== null && !targets.has(id)) targets.set(id, { id, role: entry.role === 'required' ? 'required' : 'preferred', stars: stars(entry.stars), priority: sanitizePriority(entry.priority) });
  }
  const goal = object(oldGoal), required = new Set<number>();
  for (const value of Array.isArray(goal.required) ? goal.required : []) {
    const entry = object(value), id = savedTargetId(entry.id, data, preserveIds);
    if (id === null || required.has(id)) continue;
    required.add(id); targets.set(id, { id, role: 'required', stars: stars(entry.stars), priority: sanitizePriority(entry.priority) });
  }
  for (const value of Array.isArray(goal.preferred) ? goal.preferred : []) {
    const entry = typeof value === 'number' ? { id: value } : object(value);
    const id = savedTargetId(entry.id, data, preserveIds);
    if (id !== null && !targets.has(id)) targets.set(id, { id, role: 'preferred', stars: 2, priority: sanitizePriority(entry.priority) });
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
