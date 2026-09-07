import type { Settings } from '../settings.ts';
import { BLUE_SPARK_INSPIRATION_PROC_BY_STARS, BLUE_SPARK_INSPIRATION_RANGE_BY_STARS, BLUE_SPARK_START_GAIN_BY_STARS, BLUE_SPARK_START_UNCAP_BY_STARS, INSPIRATION_EVENTS, MAX_BLUE_STARS, MAX_PARENT_STARS, STARS_PER_SPARK_MAX, UMAS_PER_PARENT_SIDE } from './rules.ts';
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
      const gain = kept.reduce((a, k) => a + BLUE_SPARK_START_GAIN_BY_STARS[k]!, 0);
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
/** Across all five stats, one parent side has only three umas, each carrying one blue spark. */
export const parentSparkCount = (gains: number[]): number => gains.reduce((n, gain) => n + sparksFromGain(gain).length, 0);
export function parentGainIssues(parents: number[][]): string[] {
  if (parents.length !== 2) return ['Enter gains for both parent sides.'];
  return parents.flatMap((gains, i) => {
    if (gains.length !== 5 || gains.some((g) => !START_GAINS.some((v) => v.gain === g))) return [`Parent ${i + 1} has an invalid start gain.`];
    const count = parentSparkCount(gains);
    return count > UMAS_PER_PARENT_SIDE ? [`Parent ${i + 1} uses ${count} blue sparks. At most ${UMAS_PER_PARENT_SIDE} can be split across the five stats. Reduce the gains or reset the legacy screen.`] : [];
  });
}
/** Allow valid changes and edits that reduce an invalid saved side toward its limit. */
export function canSetParentGain(gains: number[], statIndex: number, gain: number): boolean {
  if (!START_GAINS.some((g) => g.gain === gain)) return false;
  const count = parentSparkCount(gains.map((g, i) => i === statIndex ? gain : g));
  return count <= UMAS_PER_PARENT_SIDE || count < parentSparkCount(gains) || gain === gains[statIndex];
}
/** The start gain a set of sparks shows. */
export const gainOfSparks = (sparks: number[]) => sparks.reduce((a, k) => a + (BLUE_SPARK_START_GAIN_BY_STARS[k] ?? 0), 0);

/**
 * Proc multiplier of a spark at an inspiration event: (1 + individual affinity/100) of the uma carrying it. The tool
 * assumes one score for every uma in the lineage (settings.affinity); the game shows only the sum as ◎/○/△.
 */
export const affinityMultiplier = (settings: Settings) => 1 + Math.max(0, settings.affinity) / 100;

export interface Inheritance {
  start: number;         // fixed gain at career start
  inspiration: number;   // expected gain over the two inspiration events (proc odds times the assumed mean roll)
  inspirationMax: number; // the most the two events could give if every spark procs at the top of its range
  total: number;
  uncap: number;         // stat cap raised at career start by these sparks
}

/** Stat gained from a set of blue sparks in one stat: fixed at career start, a random roll each time one procs at an inspiration event. */
export function inheritedFromSparks(sparks: number[], settings: Settings): Inheritance {
  const mult = affinityMultiplier(settings);
  let start = 0, insp = 0, max = 0, uncap = 0;
  for (const s of sparks) {
    start += BLUE_SPARK_START_GAIN_BY_STARS[s] ?? 0;
    uncap += BLUE_SPARK_START_UNCAP_BY_STARS[s] ?? 0;
    const pProc = Math.min(1, (BLUE_SPARK_INSPIRATION_PROC_BY_STARS[s] ?? 0) * mult);
    insp += INSPIRATION_EVENTS * pProc * (settings.blueInspirationGainMean[s - 1] ?? 0);
    max += INSPIRATION_EVENTS * (BLUE_SPARK_INSPIRATION_RANGE_BY_STARS[s]?.[1] ?? 0);
  }
  return { start, inspiration: insp, inspirationMax: max, total: start + insp, uncap };
}
/** Inheritance from one parent side's start gain for a stat, as the legacy screen shows it. */
export const inheritedFromGain = (gain: number, settings: Settings) => inheritedFromSparks(sparksFromGain(gain), settings);

/** Sum of both parents' inheritance for one stat from their start gains. */
export function inheritedFromParents(parentGains: number[][], statIndex: number, settings: Settings): Inheritance {
  const parts = parentGains.map((p) => inheritedFromGain(p[statIndex] ?? 0, settings));
  const sum = (k: keyof Inheritance) => parts.reduce((a, x) => a + x[k], 0);
  return { start: sum('start'), inspiration: sum('inspiration'), inspirationMax: sum('inspirationMax'), total: sum('total'), uncap: sum('uncap') };
}
