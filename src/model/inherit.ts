import type { Settings } from '../settings.ts';

import { BLUE_SPARK_GAIN_BY_STARS, BLUE_SPARK_INSPIRATION_PROC_BY_STARS, INSPIRATION_EVENTS, MAX_BLUE_STARS, MAX_PARENT_STARS, STARS_PER_SPARK_MAX } from './rules.ts';
export { MAX_BLUE_STARS, MAX_PARENT_STARS };

/** Stars packed into 3-star sparks with one remainder spark. */
export function sparksFromStars(stars: number): number[] {
  const out: number[] = [];
  let n = Math.max(0, Math.min(MAX_BLUE_STARS, Math.round(stars)));
  while (n >= STARS_PER_SPARK_MAX) { out.push(STARS_PER_SPARK_MAX); n -= STARS_PER_SPARK_MAX; }
  if (n > 0) out.push(n);
  return out;
}

export interface Inheritance { start: number; inspiration: number; total: number }

/** Stat gained from one parent side's blue sparks in one stat: at career start, plus each inspiration event it procs at. */
export function inheritedStat(stars: number, settings: Settings): Inheritance {
  const mult = 1 + settings.affinity / 100;
  let start = 0, insp = 0;
  for (const s of sparksFromStars(stars)) {
    const g = BLUE_SPARK_GAIN_BY_STARS[s]!;
    start += g;
    insp += INSPIRATION_EVENTS * g * Math.min(1, BLUE_SPARK_INSPIRATION_PROC_BY_STARS[s]! * mult);
  }
  return { start, inspiration: insp, total: start + insp };
}

/** Clamp a per-stat star array so the total never exceeds `max`, reducing the changed stat first. */
export function clampStars(stars: number[], changed: number, max = MAX_BLUE_STARS): number[] {
  const out = stars.map((v) => Math.max(0, Math.min(max, Math.round(v))));
  const total = out.reduce((a, b) => a + b, 0);
  if (total > max) out[changed] = Math.max(0, out[changed]! - (total - max));
  return out;
}

/** Sum of both parents' inheritance for one stat, each parent's stars packed into her own sparks. */
export function inheritedFromParents(parents: number[][], statIndex: number, settings: Settings): Inheritance {
  const parts = parents.map((p) => inheritedStat(p[statIndex] ?? 0, settings));
  return { start: parts.reduce((a, x) => a + x.start, 0), inspiration: parts.reduce((a, x) => a + x.inspiration, 0), total: parts.reduce((a, x) => a + x.total, 0) };
}
