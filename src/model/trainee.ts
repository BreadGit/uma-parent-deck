import type { Character } from '../types.ts';

/**
 * Base stats at a star count. GameTora lists the card's base rarity, 4★ and 5★ tables; other star counts
 * interpolate linearly between the nearest known tables (rounded), and counts outside the known range clamp.
 */
export function statsAtStars(ch: Character, stars: number): number[] {
  const known: [number, number[]][] = [[ch.rarity, ch.baseStats]];
  if (ch.fourStarStats) known.push([4, ch.fourStarStats]);
  if (ch.fiveStarStats) known.push([5, ch.fiveStarStats]);
  known.sort((a, b) => a[0] - b[0]);
  const exact = known.find(([k]) => k === stars);
  if (exact) return exact[1];
  const lo = [...known].reverse().find(([k]) => k < stars) ?? known[0]!;
  const hi = known.find(([k]) => k > stars) ?? known[known.length - 1]!;
  if (lo[0] === hi[0]) return lo[1];
  const f = (stars - lo[0]) / (hi[0] - lo[0]);
  return lo[1].map((v, i) => Math.round(v + (hi[1][i]! - v) * f));
}

/** The trainee as run: the character card with its base stats at the chosen star count. Potential level is assumed maxed. */
export function traineeAt(ch: Character, stars: number): Character {
  return { ...ch, baseStats: statsAtStars(ch, stars) };
}
