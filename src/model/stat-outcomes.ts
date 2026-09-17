import { phi } from './stats.ts';
import { MAX_STAT_VALUE } from './rules.ts';

/** Convert the full raw total once, after base stats and inheritance. */
export const displayedStat = (raw: number) => Math.floor(raw > 1200 ? 1200 + (Math.round(raw) - 1200) / 2 : Math.round(raw));
export const rawStat = (displayed: number) => displayed > 1200 ? 1200 + 2 * (displayed - 1200) : displayed;

export interface StatMass { readonly value: number; readonly probability: number }
export interface StatDistribution { outcomes: { value: number; cumulative: number }[]; mass: number }
/** Rounded normal outcomes, with the tails folded into zero and the cap. */
const massCache = new Map<string, readonly StatMass[]>();
let cachedOutcomes = 0;
const MAX_CACHED_DISTRIBUTIONS = 512;
const MAX_CACHED_OUTCOMES = 250_000;

export function statMasses(mean: number, sd: number, cap = Infinity, rawUnits = false): readonly StatMass[] {
  const key = `${mean}:${sd}:${cap}:${rawUnits}`;
  const hit = massCache.get(key);
  if (hit) {
    massCache.delete(key);
    massCache.set(key, hit);
    return hit;
  }
  const value = computeStatMasses(mean, sd, cap, rawUnits);
  massCache.set(key, value);
  cachedOutcomes += value.length;
  while (massCache.size > MAX_CACHED_DISTRIBUTIONS || cachedOutcomes > MAX_CACHED_OUTCOMES) {
    const oldest = massCache.keys().next().value!;
    cachedOutcomes -= massCache.get(oldest)!.length;
    massCache.delete(oldest);
  }
  return value;
}

function computeStatMasses(mean: number, sd: number, cap: number, rawUnits: boolean): readonly StatMass[] {
  // Higher values have the same rating and blue band, so they can share one outcome.
  const maximum = Math.max(0, Math.min(Math.round(cap), MAX_STAT_VALUE));
  if (sd === 0 || maximum === 0) return [{ value: Math.max(0, Math.min(maximum, rawUnits ? displayedStat(mean) : Math.round(mean))), probability: 1 }];
  return Array.from({ length: maximum + 1 }, (_, value) => {
    const lower = value === 0 ? -Infinity : ((rawUnits ? rawStat(value) : value) - .5 - mean) / sd;
    const upper = value === maximum ? Infinity : ((rawUnits ? rawStat(value + 1) : value + 1) - .5 - mean) / sd;
    // Use the survival function in the upper tail to avoid subtracting two CDFs rounded to one.
    const probability = lower > 0 ? phi(-lower) - phi(-upper) : phi(upper) - phi(lower);
    return { value, probability };
  }).filter((outcome) => outcome.probability > 0);
}

export function statMoments(outcomes: readonly StatMass[]) {
  const mean = outcomes.reduce((sum, x) => sum + x.value * x.probability, 0);
  const variance = outcomes.reduce((sum, x) => sum + (x.value - mean) ** 2 * x.probability, 0);
  return { mean, sd: Math.sqrt(variance), above: (threshold: number) => outcomes.reduce((sum, x) => sum + (x.value >= threshold ? x.probability : 0), 0) };
}
