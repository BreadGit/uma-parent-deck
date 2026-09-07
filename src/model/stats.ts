import { STATS, type Card, type Character, type Focus, type StatModel } from '../types.ts';
import type { Settings } from '../settings.ts';

export const EFFECT = {
  friendship: 1, mood: 2, statBonus: 3, trainingEff: 8, initialStat: 9, initialGauge: 14,
  raceBonus: 15, fanBonus: 16, hintLevels: 17, hintFreq: 18, specialty: 19, skillPointBonus: 30,
} as const;

/** Effect id -> value at the given limit break, unique effects folded in. */
export function passives(card: Card, lb: number): Record<number, number> {
  const e = card.effectsByLb[Math.max(0, Math.min(4, lb))] ?? {};
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(e)) {
    const id = Number(k.replace('u', ''));
    out[id] = (out[id] ?? 0) + v;
  }
  return out;
}

/** Total career turns for the race scaling: the override only when it sits above the reference race count (the settings spec enforces this; a bad saved value falls back to the fit). */
export function totalTurns(model: StatModel, settings: Settings): number {
  const T = settings.totalTurnsOverride;
  return T != null && Number.isFinite(T) && T > model.races.reference ? T : model.races.totalTurns;
}
export function raceScale(races: number, model: StatModel, settings: Settings): number {
  const T = totalTurns(model, settings);
  const scale = Math.max(0, T - races) / (T - model.races.reference);
  if (!Number.isFinite(scale)) throw new Error(`race scale is not finite (total turns ${T}, reference ${model.races.reference})`);
  return scale;
}

/** Model-only card contribution at the reference race count, balanced focus. */
export function modelContribution(card: Card, lb: number, model: StatModel): { stats: number[]; sp: number } {
  const p = passives(card, lb);
  const stats = STATS.map((s, i) => {
    let v = model.floor + (p[EFFECT.initialStat + i] ?? 0);
    const role = card.type === s ? 'primary' : (model.secondary[card.type] ?? []).includes(s) ? 'secondary' : null;
    if (role) {
      const k = model.roleConstants[`${card.type}.${role}`] ?? 0;
      const gain = k + model.slopes.fr * (p[EFFECT.friendship] ?? 0) + model.slopes.mo * (p[EFFECT.mood] ?? 0)
        + model.slopes.te * (p[EFFECT.trainingEff] ?? 0) + model.slopes.sb * (p[EFFECT.statBonus + i] ?? 0);
      v += Math.max(0, gain);
    }
    return v;
  });
  const sp = model.sp.base + (card.type === 'wit' ? model.sp.wit : 0) + (card.type === 'pal' || card.type === 'group' ? model.sp.friend : 0)
    + model.sp.skillPointBonus * (p[EFFECT.skillPointBonus] ?? 0);
  return { stats, sp };
}

export interface Contribution { stats: number[]; sp: number; source: 'observed' | 'observed+model' | 'model'; runs?: number }

/** Best estimate of a card's contribution at the reference race count: observed where available, model otherwise. */
export function cardContribution(card: Card, lb: number, model: StatModel): Contribution {
  const obs = model.observed.filter((o) => o.cardId === card.id && o.wellTested);
  const exact = obs.find((o) => o.lb === lb);
  if (exact) return { stats: exact.stats.slice(), sp: exact.sp, source: 'observed', runs: exact.runs };
  const m = modelContribution(card, lb, model);
  if (obs.length) {
    // shift the nearest observed LB by the model's delta between the two LBs
    const near = obs.reduce((a, b) => (Math.abs(b.lb - lb) < Math.abs(a.lb - lb) ? b : a));
    const mNear = modelContribution(card, near.lb, model);
    return {
      stats: near.stats.map((v, i) => Math.max(model.floor, v + (m.stats[i]! - mNear.stats[i]!))),
      sp: near.sp + (m.sp - mNear.sp),
      source: 'observed+model',
      runs: near.runs,
    };
  }
  return { ...m, source: 'model' };
}

export interface DeckInput { card: Card; lb: number }
export interface Prediction {
  mean: number[];        // expected final stat gain per stat (excludes the trainee's base stats and inheritance)
  sd: number[];
  cardStats: number[];
  eventStats: number[];
  sp: number;
  cardSp: number;
  finalMean: number[];   // + trainee base stats (no inheritance)
}

function interp(model: StatModel, key: 'eventBase' | 'eventSp', races: number): number[] | number {
  const a = (model as unknown as Record<string, Record<string, number[] | number>>)[key]!;
  const v28 = a['28']!, v23 = a['23'] ?? v28;
  const t = (model.races.reference - races) / 5; // 0 at 28 races, 1 at 23
  if (Array.isArray(v28)) return v28.map((x, i) => x + ((v23 as number[])[i]! - x) * t);
  return (v28 as number) + ((v23 as number) - (v28 as number)) * t;
}

export function predictDeck(deck: DeckInput[], trainee: Character | null, races: number, focus: Focus, expectedLosses: number, model: StatModel, settings: Settings): Prediction {
  const scale = raceScale(races, model, settings);
  const cardStats = [0, 0, 0, 0, 0];
  let cardSp = 0;
  for (const d of deck) {
    const c = cardContribution(d.card, d.lb, model);
    c.stats.forEach((v, i) => (cardStats[i]! += v * scale));
    cardSp += c.sp * scale;
  }
  const growth = trainee?.growth ?? [0, 0, 0, 0, 0];
  // Event stats (which include race rewards) are only measured at 28 and 23 races; extrapolate linearly but clamp the range.
  const r = Math.max(8, Math.min(40, races));
  const eventStats = (interp(model, 'eventBase', r) as number[]).map((v, i) => v * (1 + model.growthEffect * (growth[i] ?? 0) / 100));
  const focusMul = model.focus[focus] ?? [1, 1, 1, 1, 1];
  const penalty = settings.lossPenalty * expectedLosses;
  const mean = STATS.map((_, i) => Math.max(0, (cardStats[i]! + eventStats[i]!) * focusMul[i]! - penalty / 5));
  const sd = model.sigma.map((s) => s);
  const sp = cardSp + (interp(model, 'eventSp', r) as number);
  const base = trainee?.baseStats ?? [0, 0, 0, 0, 0];
  const out = { mean, sd, cardStats, eventStats, sp, cardSp, finalMean: mean.map((v, i) => v + (base[i] ?? 0)) };
  for (const v of [...out.mean, ...out.sd, ...out.finalMean, out.sp]) if (!Number.isFinite(v)) throw new Error('prediction produced a non-finite number');
  return out;
}

/** Standard normal CDF. */
export function phi(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}
export const pAbove = (mean: number, sd: number, threshold: number) => 1 - phi((threshold - mean) / Math.max(1, sd));

/** Blue spark star bands: a stat at or above these values at run end raises the odds of 2★ and 3★ blue sparks. */
export const BLUE_STAR_BANDS = { mid: 600, high: 1100 } as const;
