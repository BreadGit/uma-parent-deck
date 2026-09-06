import type { Settings } from '../settings.ts';

import { BLUE_SPARK_GAIN_BY_STARS, BLUE_SPARK_INSPIRATION_PROC_BY_STARS, INSPIRATION_EVENTS, MAX_BLUE_STARS, MAX_PARENT_STARS, STARS_PER_SPARK_MAX, UMAS_PER_PARENT_SIDE } from './rules.ts';
export { MAX_BLUE_STARS, MAX_PARENT_STARS };

/** Stars packed into 3-star sparks with one remainder spark (how the old slider state was read). */
export function sparksFromStars(stars: number): number[] {
  const out: number[] = [];
  let n = Math.max(0, Math.min(MAX_BLUE_STARS, Math.round(stars)));
  while (n >= STARS_PER_SPARK_MAX) { out.push(STARS_PER_SPARK_MAX); n -= STARS_PER_SPARK_MAX; }
  if (n > 0) out.push(n);
  return out;
}

/**
 * Every start gain one parent side can show for a stat on the legacy screen, with the sparks behind it: the parent
 * and her two grandparents each carry one blue spark of 0 (another stat) to 3 stars. The 20 sums never collide,
 * so the "+XX" the game shows pins down the star combination, and with it the inspiration-event odds.
 */
export const START_GAINS: { gain: number; stars: number[] }[] = (() => {
  const out = new Map<number, number[]>();
  const walk = (stars: number[], from: number) => {
    if (stars.length === UMAS_PER_PARENT_SIDE) {
      const kept = stars.filter((k) => k > 0);
      const gain = kept.reduce((a, k) => a + BLUE_SPARK_GAIN_BY_STARS[k]!, 0);
      if (!out.has(gain)) out.set(gain, kept);
      return;
    }
    for (let k = from; k <= STARS_PER_SPARK_MAX; k++) walk([...stars, k], k);
  };
  walk([], 0);
  return [...out].sort((a, b) => a[0] - b[0]).map(([gain, stars]) => ({ gain, stars }));
})();
export const MAX_START_GAIN = START_GAINS[START_GAINS.length - 1]!.gain;
/** The sparks behind a start gain, or none for a value the screen cannot show. */
export const sparksFromGain = (gain: number): number[] => START_GAINS.find((g) => g.gain === gain)?.stars ?? [];
/** The start gain a set of sparks shows. */
export const gainOfSparks = (sparks: number[]) => sparks.reduce((a, k) => a + (BLUE_SPARK_GAIN_BY_STARS[k] ?? 0), 0);

export interface Inheritance { start: number; inspiration: number; total: number }

/** Stat gained from a set of blue sparks in one stat: at career start, plus each inspiration event they proc at. */
export function inheritedFromSparks(sparks: number[], settings: Settings): Inheritance {
  const mult = 1 + settings.affinity / 100;
  let start = 0, insp = 0;
  for (const s of sparks) {
    const g = BLUE_SPARK_GAIN_BY_STARS[s] ?? 0;
    start += g;
    insp += INSPIRATION_EVENTS * g * Math.min(1, (BLUE_SPARK_INSPIRATION_PROC_BY_STARS[s] ?? 0) * mult);
  }
  return { start, inspiration: insp, total: start + insp };
}
/** Inheritance from one parent side's start gain for a stat, as the legacy screen shows it. */
export const inheritedFromGain = (gain: number, settings: Settings) => inheritedFromSparks(sparksFromGain(gain), settings);

/** Sum of both parents' inheritance for one stat from their start gains. */
export function inheritedFromParents(parentGains: number[][], statIndex: number, settings: Settings): Inheritance {
  const parts = parentGains.map((p) => inheritedFromGain(p[statIndex] ?? 0, settings));
  return { start: parts.reduce((a, x) => a + x.start, 0), inspiration: parts.reduce((a, x) => a + x.inspiration, 0), total: parts.reduce((a, x) => a + x.total, 0) };
}
