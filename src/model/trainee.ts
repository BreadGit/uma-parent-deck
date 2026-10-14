import { perStat, type Character, type StatValues } from '../types.ts';

/** The star tables GameTora lists for a trainee: base rarity, and the 2★ to 5★ tables where the feed has them. */
export function knownStarTables(ch: Character): [number, StatValues][] {
  const known = new Map<number, StatValues>([[ch.rarity, ch.baseStats]]);
  if (ch.twoStarStats) known.set(2, ch.twoStarStats);
  if (ch.threeStarStats) known.set(3, ch.threeStarStats);
  if (ch.fourStarStats) known.set(4, ch.fourStarStats);
  if (ch.fiveStarStats) known.set(5, ch.fiveStarStats);
  return [...known].sort((a, b) => a[0] - b[0]);
}

/**
 * Base stats at a star count: the exact table when GameTora lists one. Only a star count the feed truly lacks
 * interpolates linearly between the nearest known tables (rounded), and counts outside the known range clamp.
 */
export function statsAtStars(ch: Character, stars: number): StatValues {
  const known = knownStarTables(ch);
  const exact = known.find(([k]) => k === stars);
  if (exact) return exact[1];
  const lo = [...known].reverse().find(([k]) => k < stars) ?? known[0]!;
  const hi = known.find(([k]) => k > stars) ?? known[known.length - 1]!;
  if (lo[0] === hi[0]) return lo[1];
  const f = (stars - lo[0]) / (hi[0] - lo[0]);
  return perStat((_, i) => Math.round(lo[1][i] + (hi[1][i] - lo[1][i]) * f));
}
export const hasExactStarTable = (ch: Character, stars: number) => knownStarTables(ch).some(([k]) => k === stars);

export const STARS_MAX = 5;
/** A count left over from another trainee must not reach the rank estimate, since stars set the unique skill's level. */
export function clampStars(ch: Character | null, stars: number): number {
  const lo = ch?.rarity ?? 1;
  return Number.isFinite(stars) ? Math.max(lo, Math.min(STARS_MAX, Math.round(stars))) : Math.max(lo, 3);
}

/** Potential level is assumed maxed. */
export function traineeAt(ch: Character, stars: number): Character {
  return { ...ch, baseStats: statsAtStars(ch, stars) };
}
