import type { Settings } from '../settings.ts';
import { STATS, type Stat } from '../types.ts';
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
/** The start gain a set of sparks shows. */
export const gainOfSparks = (sparks: number[]) => sparks.reduce((a, k) => a + (BLUE_SPARK_START_GAIN_BY_STARS[k] ?? 0), 0);

/** One uma's blue spark: the stat it raises and its stars. */
export interface BlueSpark { stat: Stat; stars: number }
/**
 * One parent side's umas, the parent and her two grandparents, each with her blue spark. Every trained uma carries
 * one, so a null slot only means "not entered": the start gain dropdown set that stat to +0.
 */
export type ParentSparks = (BlueSpark | null)[];
export const UMA_LABELS = ['Parent', 'Grandparent', 'Grandparent'];
/** A fresh side: 1★ Speed, Stamina and Power, so every uma has a spark to edit rather than a blank. */
export const defaultParentSparks = (): ParentSparks => [{ stat: 'speed', stars: 1 }, { stat: 'stamina', stars: 1 }, { stat: 'power', stars: 1 }];
export const isValidSpark = (v: unknown): v is BlueSpark => !!v && typeof v === 'object' && STATS.includes((v as BlueSpark).stat) && Number.isInteger((v as BlueSpark).stars) && (v as BlueSpark).stars >= 1 && (v as BlueSpark).stars <= STARS_PER_SPARK_MAX;
/** A saved side, or the default when it is not exactly three slots of a spark or null. */
export function sanitizeParentSparks(raw: unknown): ParentSparks {
  if (!Array.isArray(raw) || raw.length !== UMAS_PER_PARENT_SIDE || !raw.every((v) => v === null || isValidSpark(v))) return defaultParentSparks();
  return raw.map((v: BlueSpark | null) => (v ? { stat: v.stat, stars: v.stars } : null));
}
/** The "+XX" one side shows above each stat: the sum of its umas' sparks on that stat. */
export const gainsOfParentSparks = (sparks: ParentSparks): number[] => STATS.map((st) => gainOfSparks(sparks.filter((s) => s?.stat === st).map((s) => s!.stars)));
/** Sparks from the legacy screen's five gains, in stat order, strongest first; null when they need more than three umas. */
export function parentSparksFromGains(gains: number[]): ParentSparks | null {
  if (gains.length !== STATS.length || gains.some((g) => !START_GAINS.some((v) => v.gain === g))) return null;
  const out: ParentSparks = gains.flatMap((g, i) => [...sparksFromGain(g)].sort((a, b) => b - a).map((stars) => ({ stat: STATS[i]!, stars })));
  if (out.length > UMAS_PER_PARENT_SIDE) return null;
  while (out.length < UMAS_PER_PARENT_SIDE) out.push(null);
  return out;
}
/**
 * Set one stat's start gain as read off the legacy screen. The umas already on that stat are replaced first, then
 * empty slots are used, and if the gain still needs more umas they come from the other stats, fewest stars first
 * and grandparents before the parent. The decoded sparks take the freed slots in order, strongest first.
 */
export function withParentGain(sparks: ParentSparks, statIndex: number, gain: number): ParentSparks {
  const stat = STATS[statIndex]!;
  const wanted = [...sparksFromGain(gain)].sort((a, b) => b - a);
  const out: ParentSparks = sparks.map((s) => (s?.stat === stat ? null : s));
  let need = wanted.length - out.filter((s) => !s).length;
  const evict = out.map((s, i) => ({ s, i })).filter((x) => x.s).sort((a, b) => a.s!.stars - b.s!.stars || b.i - a.i);
  for (const x of evict) { if (need <= 0) break; out[x.i] = null; need--; }
  let i = 0;
  for (const stars of wanted) { while (out[i]) i++; out[i] = { stat, stars }; i++; }
  return out;
}

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
