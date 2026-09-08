import { STATS, type AptKey, type Data, type Stat } from '../types.ts';
import { resolveTarget } from './sparks.ts';

export const APTITUDE_KEYS: AptKey[] = ['turf', 'dirt', 'sprint', 'mile', 'medium', 'long', 'front', 'pace', 'late', 'end'];
export const APTITUDE_LABELS: Record<AptKey, string> = { turf: 'Turf', dirt: 'Dirt', sprint: 'Sprint', mile: 'Mile', medium: 'Medium', long: 'Long', front: 'Front Runner', pace: 'Pace Chaser', late: 'Late Surger', end: 'End Closer' };
export interface WhiteGoal { id: number | null; stars: number }
export interface ParentGoal {
  enabled: boolean;
  blueStats: Stat[];
  blueStars: number;
  pink: AptKey | null;
  pinkStars: number;
  required: [WhiteGoal, WhiteGoal];
  preferred: number[];
}
export interface PinkSpark { aptitude: AptKey; stars: number }
export const DEFAULT_GOAL: ParentGoal = { enabled: false, blueStats: [...STATS], blueStars: 2, pink: null, pinkStars: 2, required: [{ id: null, stars: 2 }, { id: null, stars: 2 }], preferred: [] };
export const emptyPinkLineage = (): (PinkSpark | null)[] => Array.from({ length: 6 }, () => null);
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const stars = (v: unknown) => typeof v === 'number' && [1, 2, 3].includes(v) ? v : 2;
export const goalFamily = (id: unknown, data: Data): number | null => {
  if (typeof id !== 'number') return null;
  const t = resolveTarget(id, data);
  return t?.white && !t.white.unreleasedEn && !t.white.name.includes('×') ? t.id : null;
};
export function sanitizeGoal(raw: unknown, data: Data, oldTargets: number[] = []): ParentGoal {
  const v = object(raw);
  const required = [0, 1].map((i) => {
    const entry = object(Array.isArray(v.required) ? v.required[i] : undefined);
    return { id: goalFamily(entry.id, data), stars: stars(entry.stars) };
  }) as ParentGoal['required'];
  if (required[1].id === required[0].id) required[1].id = null;
  const preferred = Array.isArray(v.preferred) ? v.preferred : oldTargets;
  return {
    enabled: v.enabled === true,
    blueStats: Array.isArray(v.blueStats) ? STATS.filter((s) => (v.blueStats as unknown[]).includes(s)) : [...STATS],
    blueStars: stars(v.blueStars), pink: APTITUDE_KEYS.includes(v.pink as AptKey) ? v.pink as AptKey : null, pinkStars: stars(v.pinkStars), required,
    preferred: [...new Set(preferred.map((id) => goalFamily(id, data)).filter((id): id is number => id !== null && !required.some((r) => r.id === id)))],
  };
}
export function sanitizePinkLineage(raw: unknown): (PinkSpark | null)[] {
  return emptyPinkLineage().map((_, i) => {
    const v = object(Array.isArray(raw) ? raw[i] : undefined);
    return APTITUDE_KEYS.includes(v.aptitude as AptKey) && typeof v.stars === 'number' && [1, 2, 3].includes(v.stars)
      ? { aptitude: v.aptitude as AptKey, stars: v.stars } : null;
  });
}
