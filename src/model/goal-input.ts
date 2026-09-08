import { STATS, type AptKey, type Data, type Stat } from '../types.ts';
import { resolveTarget } from './sparks.ts';

export const APTITUDE_KEYS: AptKey[] = ['turf', 'dirt', 'sprint', 'mile', 'medium', 'long', 'front', 'pace', 'late', 'end'];
export const APTITUDE_LABELS: Record<AptKey, string> = { turf: 'Turf', dirt: 'Dirt', sprint: 'Sprint', mile: 'Mile', medium: 'Medium', long: 'Long', front: 'Front Runner', pace: 'Pace Chaser', late: 'Late Surger', end: 'End Closer' };
export interface WhiteGoal { id: number; stars: number }
export interface ParentGoal {
  enabled: boolean;
  blueStats: Stat[];
  blueStars: number;
  pink: AptKey | null;
  pinkStars: number;
  required: WhiteGoal[];
  preferred: number[];
}
export const DEFAULT_GOAL: ParentGoal = { enabled: false, blueStats: [...STATS], blueStars: 2, pink: null, pinkStars: 2, required: [], preferred: [] };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const stars = (v: unknown) => typeof v === 'number' && [1, 2, 3].includes(v) ? v : 2;
export const goalFamily = (id: unknown, data: Data): number | null => {
  if (typeof id !== 'number') return null;
  const member = resolveTarget(id, data);
  const t = member?.gold ? resolveTarget(member.gold.id, data) : member;
  return t?.white && !t.white.unreleasedEn && !t.white.name.includes('×') ? t.id : null;
};
export function sanitizeGoal(raw: unknown, data: Data, oldTargets: number[] = []): ParentGoal {
  const v = object(raw);
  const required: WhiteGoal[] = [];
  for (const rawEntry of Array.isArray(v.required) ? v.required : []) {
    const entry = object(rawEntry), id = goalFamily(entry.id, data);
    if (id !== null && !required.some((r) => r.id === id)) required.push({ id, stars: stars(entry.stars) });
  }
  const preferred = [...(Array.isArray(v.preferred) ? v.preferred : []), ...oldTargets];
  return {
    enabled: v.enabled === true,
    blueStats: Array.isArray(v.blueStats) ? STATS.filter((s) => (v.blueStats as unknown[]).includes(s)) : [...STATS],
    blueStars: stars(v.blueStars), pink: APTITUDE_KEYS.includes(v.pink as AptKey) ? v.pink as AptKey : null, pinkStars: stars(v.pinkStars), required,
    preferred: [...new Set(preferred.map((id) => goalFamily(id, data)).filter((id): id is number => id !== null && !required.some((r) => r.id === id)))],
  };
}
