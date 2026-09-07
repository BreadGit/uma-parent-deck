import { STATS, type Card, type Character, type Focus, type StatModel, type UniqueEffect } from '../types.ts';
import type { Settings } from '../settings.ts';
import { FACILITY_LEVEL_MAX, SLOT_COUNT, UNIQUE_TOTAL_BOND_CAP } from './rules.ts';

export const EFFECT = {
  friendship: 1, mood: 2, statBonus: 3, trainingEff: 8, initialStat: 9, initialGauge: 14,
  raceBonus: 15, fanBonus: 16, hintLevels: 17, hintFreq: 18, specialty: 19, skillPointBonus: 30,
} as const;

/** Effect id -> value at the given limit break, unique effects folded in, plus any deck-dependent extras. */
export function passives(card: Card, lb: number, extra: Record<number, number> = {}): Record<number, number> {
  const e = card.effectsByLb[Math.max(0, Math.min(4, lb))] ?? {};
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(e)) {
    const id = Number(k.replace('u', ''));
    out[id] = (out[id] ?? 0) + v;
  }
  for (const [k, v] of Object.entries(extra)) out[Number(k)] = (out[Number(k)] ?? 0) + v;
  return out;
}

/** Compound unique-effect types (100 and up) the stat model evaluates; the rest depend on turn-by-turn state and are left out. */
export const MODELLED_UNIQUE_TYPES: ReadonlySet<number> = new Set([101, 103, 104, 105, 106, 109, 111]);
/** What a compound effect can be evaluated against: the deck it sits in, and the agenda's expected fans before each slot. */
export interface UniqueContext { deck?: { card: Card }[]; fansBefore?: (slot: number) => number }
/** True when the card's unique effect is unlocked at this limit break. */
export const uniqueUnlocked = (card: Card, lb: number) => !!card.unique && lb >= card.unique.fromLb;

/** Run-average share of a "+1 per `step` fans, up to `cap`" effect, from the agenda's expected fans before each slot. */
function fanRampShare(fansBefore: (slot: number) => number, step: number, cap: number): number {
  if (!(step > 0) || !(cap > 0)) return 0;
  let sum = 0;
  for (let s = 0; s < SLOT_COUNT; s++) sum += Math.min(cap, Math.floor(fansBefore(s) / step)) / cap;
  return sum / SLOT_COUNT;
}

/**
 * Passives a card's compound unique effect adds (docs/refs/gametora-unique-effects.md), evaluated at run time so the
 * fit script can do the same sums from the same payload. Ramping effects (bond, friendship count, total bond, facility
 * level) count for `model.uniqueRampShare` of the run, a fitted share; type 104 (per fans) follows the agenda's fan
 * curve when it is given and the same share otherwise; types 103 and 105 are exact given the deck.
 */
export function uniqueExtras(card: Card, lb: number, model: StatModel, ctx: UniqueContext = {}): Record<number, number> {
  const out: Record<number, number> = {};
  if (!card.unique || !uniqueUnlocked(card, lb)) return out;
  const share = model.uniqueRampShare;
  const deck = ctx.deck ?? [];
  const add = (id: number | undefined, v: number) => { if (id == null || !Number.isFinite(v) || v === 0) return; out[id] = (out[id] ?? 0) + v; };
  for (const u of card.unique.effects) {
    switch (u.type) {
      case 101: add(u.value_1, (u.value_2 ?? 0) * share); add(u.value_3, (u.value_4 ?? 0) * share); break;
      case 103: if (new Set(deck.map((d) => d.card.type)).size >= u.value) add(EFFECT.trainingEff, u.value_1 ?? 0); break;
      case 104: add(EFFECT.trainingEff, (u.value_1 ?? 0) * (ctx.fansBefore ? fanRampShare(ctx.fansBefore, u.value, u.value_1 ?? 0) : share)); break;
      case 105: STATS.forEach((st, i) => {
        const same = deck.filter((d) => d.card.type === st).length, friends = deck.filter((d) => d.card.type === 'pal' || d.card.type === 'group').length;
        add(EFFECT.initialStat + i, u.value * same + (u.value_1 ?? 0) * friends);
      }); break;
      case 106: add(EFFECT.friendship, u.value * (u.value_2 ?? 0) * share); break;
      case 109: add(EFFECT.trainingEff, (u.value_1 ? UNIQUE_TOTAL_BOND_CAP / u.value_1 : 0) * share); break;
      case 111: add(EFFECT.trainingEff, (u.value_1 ?? 0) * FACILITY_LEVEL_MAX * share); break;
    }
  }
  return out;
}

/** What the model does with each of a card's compound unique effects, for the ranking tooltip. */
export function uniqueNote(card: Card, model: StatModel, ctx: UniqueContext = {}): string {
  const pctShare = `${Math.round(model.uniqueRampShare * 100)}% of the run`;
  const note = (u: UniqueEffect): string => {
    switch (u.type) {
      case 101: return `bond ${u.value} assumed reached for ${pctShare}`;
      case 103: return ctx.deck ? `the deck has ${new Set(ctx.deck.map((d) => d.card.type)).size} card types (needs ${u.value})` : 'counted from the deck once it is built';
      case 104: return ctx.fansBefore ? `run average +${((u.value_1 ?? 0) * fanRampShare(ctx.fansBefore, u.value, u.value_1 ?? 0)).toFixed(1)} of ${u.value_1} from the agenda's fans` : `${pctShare} of the fan cap (the agenda's fans once it is built)`;
      case 105: return 'initial stats per card in the deck once it is built';
      case 106: return `the ${u.value} friendship trainings assumed done for ${pctShare}`;
      case 109: return `${UNIQUE_TOTAL_BOND_CAP} total bond assumed reached for ${pctShare}`;
      case 111: return `facility level ${FACILITY_LEVEL_MAX} assumed for ${pctShare}`;
      default: return u.type >= 100 ? 'depends on turn-by-turn state, left out' : '';
    }
  };
  return (card.unique?.effects ?? []).map(note).filter(Boolean).join('; ');
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

/** Model-only card contribution at the reference race count, balanced focus. `extra` adds deck-dependent passives. */
export function modelContribution(card: Card, lb: number, model: StatModel, extra: Record<number, number> = {}): { stats: number[]; sp: number } {
  const p = passives(card, lb, extra);
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

/**
 * Best estimate of a card's contribution at the reference race count: observed where available, model otherwise.
 * `extra` (compound unique passives from uniqueExtras) only reaches the model: an observed row already contains the
 * effect at the deck it was logged with, and it cancels out of an LB shift.
 */
export function cardContribution(card: Card, lb: number, model: StatModel, extra: Record<number, number> = {}): Contribution {
  const obs = model.observed.filter((o) => o.cardId === card.id && o.wellTested);
  const exact = obs.find((o) => o.lb === lb);
  if (exact) return { stats: exact.stats.slice(), sp: exact.sp, source: 'observed', runs: exact.runs };
  const m = modelContribution(card, lb, model, extra);
  if (obs.length) {
    // shift the nearest observed LB by the model's delta between the two LBs
    const near = obs.reduce((a, b) => (Math.abs(b.lb - lb) < Math.abs(a.lb - lb) ? b : a));
    const mNear = modelContribution(card, near.lb, model, extra);
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

export function predictDeck(deck: DeckInput[], trainee: Character | null, races: number, focus: Focus, expectedLosses: number, model: StatModel, settings: Settings, fansBefore?: (slot: number) => number): Prediction {
  const scale = raceScale(races, model, settings);
  const cardStats = [0, 0, 0, 0, 0];
  let cardSp = 0;
  for (const d of deck) {
    const c = cardContribution(d.card, d.lb, model, uniqueExtras(d.card, d.lb, model, { deck, fansBefore }));
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
