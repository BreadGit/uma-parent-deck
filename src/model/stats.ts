import { STATS, perStat, type Card, type Character, type Focus, type StatModel, type StatValues } from '../types.ts';
import type { Settings } from '../settings.ts';
import { BLUE_GENERATION_BANDS } from './rules.ts';

import { EFFECT, passives, uniqueExtras, spModelFor } from './support-effects.ts';

/** Total career turns for the race scaling. SETTING_SPEC keeps an override above the reference race count. */
export function totalTurns(model: StatModel, settings: Settings): number {
  return settings.totalTurnsOverride ?? model.races.totalTurns;
}
export function raceScale(races: number, model: StatModel, settings: Settings): number {
  const T = totalTurns(model, settings);
  const scale = Math.max(0, T - races) / (T - model.races.reference);
  if (!Number.isFinite(scale)) throw new Error(`race scale is not finite (total turns ${T}, reference ${model.races.reference})`);
  return scale;
}

/** Model-only card contribution at the reference race count, balanced focus. `extra` adds deck-dependent passives. */
export function modelContribution(card: Card, lb: number, model: StatModel, extra: Record<number, number> = {}): { stats: StatValues; sp: number } {
  const p = passives(card, lb, extra);
  const fittedEffects = (slopes: Record<number, number> = {}) => Object.entries(slopes)
    .reduce((sum, [effect, coefficient]) => sum + coefficient * (p[Number(effect)] ?? 0), 0);
  const statEffects = fittedEffects(model.effectSlopes);
  const stats = perStat((s, i) => {
    let v = model.floor + (p[EFFECT.initialStat + i] ?? 0);
    const role = card.type === s ? 'primary' : (model.secondary[card.type] ?? []).includes(s) ? 'secondary' : null;
    if (role) {
      const k = model.roleConstants[`${card.type}.${role}`] ?? 0;
      const gain = k + model.slopes.fr * (p[EFFECT.friendship] ?? 0) + model.slopes.mo * (p[EFFECT.mood] ?? 0)
        + model.slopes.te * (p[EFFECT.trainingEff] ?? 0) + model.slopes.sb * (p[EFFECT.statBonus + i] ?? 0) + statEffects;
      v += Math.max(0, gain);
    }
    return v;
  });
  const spModel = spModelFor(card, model);
  const sp = spModel.base + (card.type === 'wit' ? spModel.wit : 0) + (card.type === 'pal' || card.type === 'group' ? spModel.friend : 0)
    + spModel.skillPointBonus * (p[EFFECT.skillPointBonus] ?? 0) + fittedEffects(spModel.effectSlopes);
  return { stats, sp: Math.max(0, sp) };
}

export interface Contribution { stats: StatValues; sp: number; source: 'observed' | 'observed+model' | 'model'; runs?: number }

/** The recorded reference used by both the prediction and its source explanation. */
export function referenceObservation(card: Card, lb: number, model: StatModel): StatModel['observed'][number] | undefined {
  const observations = model.observed.filter((o) => o.cardId === card.id && o.wellTested);
  return observations.find((o) => o.lb === lb) ?? observations.reduce<StatModel['observed'][number] | undefined>((nearest, o) =>
    !nearest || Math.abs(o.lb - lb) < Math.abs(nearest.lb - lb) ? o : nearest, undefined);
}

/**
 * Best estimate of a card's contribution at the reference race count: observed where available, model otherwise.
 * `extra` (compound unique passives from uniqueExtras) only reaches the model: an observed row already contains the
 * effect at the deck it was logged with. LB shifts use the ordinary inputs only, so changes
 * to a guessed deck bonus cannot move a recorded reference through a formula clamp.
 */
export function cardContribution(card: Card, lb: number, model: StatModel, extra: Record<number, number> = {}): Contribution {
  const near = referenceObservation(card, lb, model);
  if (near?.lb === lb) return { stats: [...near.stats], sp: near.sp, source: 'observed', runs: near.runs };
  const m = modelContribution(card, lb, model, near ? {} : extra);
  if (near) {
    const mNear = modelContribution(card, near.lb, model);
    return {
      stats: perStat((_, i) => Math.max(0, near.stats[i] + (m.stats[i] - mNear.stats[i]))),
      sp: Math.max(0, near.sp + (m.sp - mNear.sp)),
      source: 'observed+model',
      runs: near.runs,
    };
  }
  return { ...m, source: 'model' };
}

export interface DeckInput { card: Card; lb: number }
export interface Prediction {
  mean: StatValues;        // expected final stat gain per stat (excludes the trainee's base stats and inheritance)
  sd: StatValues;
  cardStats: StatValues;
  eventStats: StatValues;
  sp: number;
  cardSp: number;
  finalMean: StatValues;   // + trainee base stats (no inheritance)
}

/** The two measured race counts nearest `races` (the outermost pair beyond them) and how far `races` lies from the lower. */
function raceSegment(measured: Record<string, unknown>, races: number) {
  const counts = Object.keys(measured).map(Number).sort((a, b) => a - b);
  let i = 1;
  while (i < counts.length - 1 && counts[i]! < races) i++;
  const low = counts[Math.max(i - 1, 0)]!, high = counts[Math.min(i, counts.length - 1)]!;
  return { low, high, weight: high === low ? 0 : (races - low) / (high - low) };
}

export function predictDeck(deck: DeckInput[], trainee: Character | null, races: number, focus: Focus, expectedLosses: number, model: StatModel, settings: Settings, fansBefore?: (slot: number) => number): Prediction {
  const scale = raceScale(races, model, settings);
  let cardStats: StatValues = perStat(() => 0);
  let cardSp = 0;
  for (const d of deck) {
    const c = cardContribution(d.card, d.lb, model, uniqueExtras(d.card, d.lb, model, { deck, fansBefore }));
    cardStats = perStat((_, i) => cardStats[i] + c.stats[i] * scale);
    cardSp += c.sp * scale;
  }
  const growth: StatValues = trainee?.growth ?? [0, 0, 0, 0, 0];
  const { low, high, weight } = raceSegment(model.eventSp, Math.max(8, Math.min(40, races)));
  const mix = (atLow: number, atHigh: number) => atLow + (atHigh - atLow) * weight;
  const eventBase = perStat((_, i) => mix(model.eventBase[low]![i], model.eventBase[high]![i]));
  const eventStats = perStat((_, i) => eventBase[i] * (1 + model.growthEffect * growth[i] / 100));
  const focusMul = model.focus[focus];
  const penalty = settings.lossPenalty * expectedLosses;
  const mean = perStat((_, i) => Math.max(0, (cardStats[i] + eventStats[i]) * focusMul[i] - penalty / STATS.length));
  const sd: StatValues = [...model.sigma];
  const sp = cardSp + mix(model.eventSp[low]!, model.eventSp[high]!);
  const base: StatValues = trainee?.baseStats ?? [0, 0, 0, 0, 0];
  const out = { mean, sd, cardStats, eventStats, sp, cardSp, finalMean: perStat((_, i) => mean[i] + base[i]) };
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

/** Blue spark star bands: a stat at or above these values at run end raises the odds of 2★ and 3★ blue sparks. */
export const BLUE_STAR_BANDS = { mid: BLUE_GENERATION_BANDS[1].min, high: BLUE_GENERATION_BANDS[2].min } as const;
