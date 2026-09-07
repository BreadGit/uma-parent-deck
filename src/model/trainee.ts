import type { Character } from '../types.ts';

/** The star tables GameTora lists for a trainee: base rarity, and the 2★ to 5★ tables where the feed has them. */
export function knownStarTables(ch: Character): [number, number[]][] {
  const known = new Map<number, number[]>([[ch.rarity, ch.baseStats]]);
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
export function statsAtStars(ch: Character, stars: number): number[] {
  const known = knownStarTables(ch);
  const exact = known.find(([k]) => k === stars);
  if (exact) return exact[1];
  const lo = [...known].reverse().find(([k]) => k < stars) ?? known[0]!;
  const hi = known.find(([k]) => k > stars) ?? known[known.length - 1]!;
  if (lo[0] === hi[0]) return lo[1];
  const f = (stars - lo[0]) / (hi[0] - lo[0]);
  return lo[1].map((v, i) => Math.round(v + (hi[1][i]! - v) * f));
}
/** True when the stats at this star count come from a listed table rather than interpolation. */
export const hasExactStarTable = (ch: Character, stars: number) => knownStarTables(ch).some(([k]) => k === stars);

/** The trainee as run: the character card with its base stats at the chosen star count. Potential level is assumed maxed. */
export function traineeAt(ch: Character, stars: number): Character {
  return { ...ch, baseStats: statsAtStars(ch, stars) };
}
