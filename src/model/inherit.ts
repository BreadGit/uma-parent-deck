import type { Settings } from '../settings.ts';

export const MAX_BLUE_STARS = 18; // two parents and four grandparents, 3 stars each
const GAIN_BY_STARS = [0, 5, 12, 21];      // stat gain of one blue spark at career start
const PROC_BY_STARS = [0, 0.7, 0.8, 0.9];  // inspiration-event proc chance at 0 affinity

/** Stars packed into 3-star sparks with one remainder spark. */
export function sparksFromStars(stars: number): number[] {
  const out: number[] = [];
  let n = Math.max(0, Math.min(MAX_BLUE_STARS, Math.round(stars)));
  while (n >= 3) { out.push(3); n -= 3; }
  if (n > 0) out.push(n);
  return out;
}

export interface Inheritance { start: number; inspiration: number; total: number }

/** Stat gained from the blue sparks of one stat: at career start, plus two inspiration events. */
export function inheritedStat(stars: number, settings: Settings): Inheritance {
  const mult = 1 + settings.affinity / 100;
  let start = 0, insp = 0;
  for (const s of sparksFromStars(stars)) {
    const g = GAIN_BY_STARS[s]!;
    start += g;
    insp += 2 * g * Math.min(1, PROC_BY_STARS[s]! * mult);
  }
  return { start, inspiration: insp, total: start + insp };
}

/** Clamp a per-stat star array so the total never exceeds 18, reducing the changed stat first. */
export function clampStars(stars: number[], changed: number): number[] {
  const out = stars.map((v) => Math.max(0, Math.min(MAX_BLUE_STARS, Math.round(v))));
  const total = out.reduce((a, b) => a + b, 0);
  if (total > MAX_BLUE_STARS) out[changed] = Math.max(0, out[changed]! - (total - MAX_BLUE_STARS));
  return out;
}
