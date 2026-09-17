import effectsJson from '../../data/effects.json' with { type: 'json' };
import { STATS, type Card, type StatModel, type UniqueEffect } from '../types.ts';
import { FACILITY_LEVEL_MAX, SLOT_COUNT, UNIQUE_TOTAL_BOND_CAP } from './rules.ts';

export const EFFECT = {
  friendship: 1, mood: 2, statBonus: 3, trainingEff: 8, initialStat: 9, initialGauge: 14,
  raceBonus: 15, fanBonus: 16, hintLevels: 17, hintFreq: 18, specialty: 19, skillPointBonus: 30,
} as const;

export interface UniqueContext { deck?: { card: Card; lb?: number }[]; fansBefore?: (slot: number) => number }
export type EffectCoverageReason = 'direct' | 'fitted' | 'bondShare' | 'deckTypes' | 'deckInitialStats' | 'fans'
  | 'friendshipCount' | 'totalBond' | 'facilityLevel' | 'initialBond' | 'raceBonus' | 'notFitted'
  | 'unsupported' | 'unknown' | 'unknownPayload' | 'hints' | 'hintLevels' | 'fanBonus' | 'teamBond' | 'notRetained' | 'insufficientData';
export interface EffectCoverage {
  key: string;
  name: string;
  status: 'calculated' | 'approximated' | 'omitted' | 'unrecognized';
  description: string;
  reason: EffectCoverageReason;
  outcomes: ('stats' | 'sp' | 'fans' | 'skills' | 'unknown')[];
  deckDependent: boolean;
}
type Treatment = Pick<EffectCoverage, 'status' | 'reason' | 'outcomes' | 'deckDependent'>;
type Metadata = { id: number; name: string; description?: string };
const metadata = new Map<number, Metadata>((effectsJson as Metadata[]).map((e) => [e.id, e]));

/** Sparse support types retain the previous SP formula. Coverage follows the same choice. */
export const spModelFor = (card: Card, model: StatModel): StatModel['sp'] =>
  model.sp.fittedTypes && !model.sp.fittedTypes.includes(card.type) ? model.sp.fallback ?? model.sp : model.sp;

/** Ordinary unique effects have already been folded into the values for each limit break. */
export function passives(card: Card, lb: number, extra: Record<number, number> = {}): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [key, value] of Object.entries(card.effectsByLb[Math.max(0, Math.min(4, lb))] ?? {})) {
    const id = Number(key.replace('u', ''));
    out[id] = (out[id] ?? 0) + value;
  }
  for (const [key, value] of Object.entries(extra)) out[Number(key)] = (out[Number(key)] ?? 0) + value;
  return out;
}

export const uniqueUnlocked = (card: Card, lb: number) => !!card.unique && lb >= card.unique.fromLb;

function hasUnknownPayload(effect: UniqueEffect, fields: readonly string[]): boolean {
  return Object.entries(effect).some(([key, value]) => !['type', 'value', ...fields].includes(key)
    && !(/^(?:name|desc|description|text|title)(?:_[a-z_]+)?$/.test(key) && typeof value === 'string'));
}

function teamBondEffect(effect: UniqueEffect): number | undefined {
  if (effect.type !== 115 || effect.value !== EFFECT.initialGauge || !Number.isFinite(effect.value_1)
    || hasUnknownPayload(effect, ['value_1'])) return undefined;
  return effect.value_1;
}

/** Unlocked team bonuses change each recipient's ordinary starting-bond input. */
export function teamInitialBond(deck: NonNullable<UniqueContext['deck']>): number {
  return deck.reduce((sum, entry) => {
    if (!uniqueUnlocked(entry.card, entry.lb ?? 0)) return sum;
    return sum + entry.card.unique!.effects.reduce((value, effect) => value + (teamBondEffect(effect) ?? 0), 0);
  }, 0);
}

function fanRampShare(fansBefore: (slot: number) => number, step: number, cap: number): number {
  if (!(step > 0) || !(cap > 0)) return 0;
  let sum = 0;
  for (let slot = 0; slot < SLOT_COUNT; slot++) sum += Math.min(cap, Math.floor(fansBefore(slot) / step)) / cap;
  return sum / SLOT_COUNT;
}

type Add = (id: number | undefined, value: number) => void;
interface UniqueRule {
  reason: EffectCoverageReason;
  status: 'calculated' | 'approximated';
  deckDependent: boolean;
  fields: string[];
  outputs: (effect: UniqueEffect) => number[];
  apply: (effect: UniqueEffect, share: number, context: UniqueContext, add: Add) => void;
  note: (effect: UniqueEffect, share: string, context: UniqueContext) => string;
}

/** Calculation and coverage use the same definitions, including nested passive IDs. */
const UNIQUE_RULES: Readonly<Record<number, UniqueRule>> = {
  101: {
    reason: 'bondShare', status: 'approximated', deckDependent: false, fields: ['value_1', 'value_2', 'value_3', 'value_4'],
    outputs: (u) => [u.value_1, u.value_3].filter((id): id is number => id != null),
    apply: (u, share, _ctx, add) => { add(u.value_1, (u.value_2 ?? 0) * share); add(u.value_3, (u.value_4 ?? 0) * share); },
    note: (u, share) => `bond ${u.value} assumed reached for ${share}`,
  },
  103: {
    reason: 'deckTypes', status: 'calculated', deckDependent: true, fields: ['value_1'], outputs: () => [EFFECT.trainingEff],
    apply: (u, _share, ctx, add) => { if (new Set((ctx.deck ?? []).map((d) => d.card.type)).size >= u.value) add(EFFECT.trainingEff, u.value_1 ?? 0); },
    note: (u, _share, ctx) => ctx.deck ? `the deck has ${new Set(ctx.deck.map((d) => d.card.type)).size} card types (needs ${u.value})` : 'counted from the deck once it is built',
  },
  104: {
    reason: 'fans', status: 'approximated', deckDependent: true, fields: ['value_1'], outputs: () => [EFFECT.trainingEff],
    apply: (u, share, ctx, add) => add(EFFECT.trainingEff, (u.value_1 ?? 0) * (ctx.fansBefore ? fanRampShare(ctx.fansBefore, u.value, u.value_1 ?? 0) : share)),
    note: (u, share, ctx) => ctx.fansBefore ? `run average +${((u.value_1 ?? 0) * fanRampShare(ctx.fansBefore, u.value, u.value_1 ?? 0)).toFixed(1)} of ${u.value_1} from the agenda's fans` : `${share} of the fan cap (the agenda's fans once it is built)`,
  },
  105: {
    reason: 'deckInitialStats', status: 'calculated', deckDependent: true, fields: ['value_1'], outputs: () => STATS.map((_, i) => EFFECT.initialStat + i),
    apply: (u, _share, ctx, add) => STATS.forEach((stat, i) => {
      const deck = ctx.deck ?? [];
      add(EFFECT.initialStat + i, u.value * deck.filter((d) => d.card.type === stat).length + (u.value_1 ?? 0) * deck.filter((d) => d.card.type === 'pal' || d.card.type === 'group').length);
    }),
    note: () => 'initial stats per card in the deck once it is built',
  },
  106: {
    reason: 'friendshipCount', status: 'approximated', deckDependent: false, fields: ['value_1', 'value_2'], outputs: () => [EFFECT.friendship],
    apply: (u, share, _ctx, add) => add(EFFECT.friendship, u.value * (u.value_2 ?? 0) * share),
    note: (u, share) => `the ${u.value} friendship trainings assumed done for ${share}`,
  },
  109: {
    reason: 'totalBond', status: 'approximated', deckDependent: true, fields: ['value_1'], outputs: () => [EFFECT.trainingEff],
    apply: (u, share, _ctx, add) => add(EFFECT.trainingEff, (u.value_1 ? UNIQUE_TOTAL_BOND_CAP / u.value_1 : 0) * share),
    note: (_u, share) => `${UNIQUE_TOTAL_BOND_CAP} total bond assumed reached for ${share}`,
  },
  111: {
    reason: 'facilityLevel', status: 'approximated', deckDependent: false, fields: ['value_1'], outputs: () => [EFFECT.trainingEff],
    apply: (u, share, _ctx, add) => add(EFFECT.trainingEff, (u.value_1 ?? 0) * FACILITY_LEVEL_MAX * share),
    note: (_u, share) => `facility level ${FACILITY_LEVEL_MAX} assumed for ${share}`,
  },
};

export function uniqueExtras(card: Card, lb: number, model: StatModel, ctx: UniqueContext = {}): Record<number, number> {
  const out: Record<number, number> = {};
  const add: Add = (id, value) => { if (id != null && Number.isFinite(value) && value !== 0) out[id] = (out[id] ?? 0) + value; };
  if (ctx.deck && (model.effectSlopes?.[EFFECT.initialGauge] || model.sp.effectSlopes?.[EFFECT.initialGauge])) add(EFFECT.initialGauge, teamInitialBond(ctx.deck));
  if (!uniqueUnlocked(card, lb)) return out;
  for (const effect of card.unique!.effects) {
    const rule = UNIQUE_RULES[effect.type];
    if (rule && !hasUnknownPayload(effect, rule.fields)) rule.apply(effect, model.uniqueRampShare, ctx, add);
  }
  return out;
}

/** Legacy text used by inspect tools; the UI formats coverage reasons through COPY. */
export function uniqueNote(card: Card, model: StatModel, ctx: UniqueContext = {}): string {
  const share = `${Math.round(model.uniqueRampShare * 100)}% of the run`;
  return (card.unique?.effects ?? []).map((u) => {
    const bond = teamBondEffect(u);
    if (bond !== undefined) return model.effectSlopes?.[EFFECT.initialGauge] || model.sp.effectSlopes?.[EFFECT.initialGauge]
      ? `+${bond} starting bond for each support, approximated from the fitted starting-bond relationship; the team effect has not been measured directly`
      : `+${bond} starting bond for each support, left out of the current formula`;
    const rule = UNIQUE_RULES[u.type];
    return rule && !hasUnknownPayload(u, rule.fields) ? rule.note(u, share, ctx) : u.type >= 100 ? 'not evaluated, left out' : '';
  }).filter(Boolean).join('; ');
}

function ordinaryTreatment(id: number, card: Card, model: StatModel): Treatment {
  const original = baseTreatment(id, card);
  const stats = model.effectSlopes?.[id] && STATS.some((stat) => stat === card.type);
  const sp = spModelFor(card, model).effectSlopes?.[id];
  if (!stats && !sp) return original;
  const wasIncluded = original.status === 'calculated' || original.status === 'approximated';
  return { ...original, status: 'approximated', reason: wasIncluded ? original.reason : 'fitted', outcomes: [...new Set([
    ...(wasIncluded ? original.outcomes : []), ...(stats ? ['stats' as const] : []), ...(sp ? ['sp' as const] : []),
  ])] };
}

function baseTreatment(id: number, card: Card): Treatment {
  const base = { deckDependent: false, outcomes: ['stats'] as EffectCoverage['outcomes'] };
  if (id >= EFFECT.initialStat && id < EFFECT.initialGauge) return { ...base, status: 'calculated', reason: 'direct' };
  if (id >= EFFECT.friendship && id <= EFFECT.trainingEff) return { ...base, status: STATS.some((s) => s === card.type) ? 'approximated' : 'omitted', reason: STATS.some((s) => s === card.type) ? 'fitted' : 'notFitted' };
  if (id === EFFECT.skillPointBonus) return { ...base, status: 'approximated', reason: 'fitted', outcomes: ['sp'] };
  if (id === EFFECT.fanBonus) return { ...base, status: 'calculated', reason: 'fanBonus', outcomes: ['fans'], deckDependent: true };
  if (id === EFFECT.hintFreq) return { ...base, status: 'approximated', reason: 'hints', outcomes: ['skills'] };
  if (id === EFFECT.hintLevels) return { ...base, status: 'omitted', reason: 'hintLevels', outcomes: ['skills'] };
  if (id === EFFECT.initialGauge) return { ...base, status: 'omitted', reason: 'initialBond', outcomes: ['stats', 'sp'] };
  if (id === EFFECT.raceBonus) return { ...base, status: 'omitted', reason: 'raceBonus', outcomes: ['stats', 'sp'], deckDependent: true };
  const known = [19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31].includes(id);
  return { ...base, status: known ? 'omitted' : 'unrecognized', reason: known ? 'notFitted' : 'unknown', outcomes: known ? ['stats', 'sp'] : ['unknown'] };
}

/** Coverage of active effects, independent of whether a card uses recorded or formula-based contributions. */
export function cardEffectCoverage(card: Card, lb: number, model: StatModel, _ctx: UniqueContext = {}): EffectCoverage[] {
  const entries: EffectCoverage[] = [];
  const ordinary = (id: number, key: string, description?: string): EffectCoverage => ({
    key, name: metadata.get(id)?.name ?? `Support effect ${id}`, description: description ?? metadata.get(id)?.description ?? '', ...ordinaryTreatment(id, card, model),
  });
  const ordinaryEntries = (id: number, key: string, description?: string): EffectCoverage[] => {
    const entry = ordinary(id, key, description);
    const original = baseTreatment(id, card);
    const omitted = original.status === 'omitted' ? original.outcomes.filter((outcome) => !entry.outcomes.includes(outcome)) : [];
    const result: EffectCoverage[] = omitted.length ? [entry, { ...entry, ...original, key: `${key}:omitted`, outcomes: omitted }] : [entry];
    return result.map((effect) => {
      if (effect.status !== 'omitted' || !['notFitted', 'initialBond'].includes(effect.reason)) return effect;
      const statuses = effect.outcomes.map((outcome) => outcome === 'stats' || outcome === 'sp'
        ? model.evaluation?.[outcome]?.inputs?.find((input) => input.effectId === id)?.status : undefined);
      if (statuses.length && statuses.every((status) => status === 'tested-not-retained')) return { ...effect, reason: 'notRetained' };
      if (statuses.length && statuses.every((status) => status === 'insufficient-data')) return { ...effect, reason: 'insufficientData' };
      return effect;
    });
  };
  for (const [key, value] of Object.entries(card.effectsByLb[lb] ?? {})) if (!key.startsWith('u') && value !== 0) entries.push(...ordinaryEntries(Number(key), `effect:${key}`));
  if (card.hintOthers.length || card.hintOthersSource?.length) entries.push({ key: 'hints:source', name: 'Hint event stat rewards', description: '', status: 'omitted', reason: 'unsupported', outcomes: ['stats', 'sp'], deckDependent: false });
  if (!uniqueUnlocked(card, lb)) return entries;
  const unique = card.unique!;
  if (!unique.effects.length && unique.text) entries.push({ key: 'unique:text', name: 'Unique effect', description: unique.text, status: 'unrecognized', reason: 'unknown', outcomes: ['unknown'], deckDependent: false });
  unique.effects.forEach((effect, index) => {
    const key = `unique:${index}`;
    if (effect.type < 100) {
      if (effect.value !== 0) {
        if (hasUnknownPayload(effect, [])) entries.push({ ...ordinary(effect.type, key, unique.text), status: 'unrecognized', reason: 'unknownPayload' });
        else entries.push(...ordinaryEntries(effect.type, key, unique.text));
      }
      return;
    }
    const rule = UNIQUE_RULES[effect.type];
    const base = { key, name: 'Unique effect', description: unique.text ?? `Support effect ${effect.type}`, deckDependent: rule?.deckDependent ?? effect.type === 115 };
    if (teamBondEffect(effect) !== undefined) {
      const included = !!(model.effectSlopes?.[EFFECT.initialGauge] || model.sp.effectSlopes?.[EFFECT.initialGauge]);
      entries.push({ ...base, status: included ? 'approximated' : 'omitted', reason: included ? 'teamBond' : 'initialBond', outcomes: ['stats', 'sp'] });
      return;
    }
    if (effect.type === 115) {
      entries.push({ ...base, status: 'unrecognized', reason: 'unknownPayload', outcomes: ['unknown'] });
      return;
    }
    if (!rule || hasUnknownPayload(effect, rule.fields)) {
      const known = [102, 107, 108, 110, 112, 113, 114, 115, 9991].includes(effect.type);
      entries.push({ ...base, status: rule || !known ? 'unrecognized' : 'omitted', reason: rule ? 'unknownPayload' : effect.type === 115 ? 'initialBond' : known ? 'unsupported' : 'unknown', outcomes: known || rule ? ['stats', 'sp'] : ['unknown'] });
      return;
    }
    const outputs = [...new Set(rule.outputs(effect))];
    // Compound extras are consumed by the stat/SP formula, not the ordinary hint or fan calculations.
    const outcomes = (id: number) => ordinaryTreatment(id, card, model).outcomes.filter((outcome) => outcome === 'stats' || outcome === 'sp');
    const included = outputs.filter((id) => ['calculated', 'approximated'].includes(ordinaryTreatment(id, card, model).status) && outcomes(id).length);
    if (included.length) entries.push({ ...base, status: rule.status, reason: rule.reason, outcomes: [...new Set(included.flatMap(outcomes))] });
    for (const id of outputs) {
      for (const entry of ordinaryEntries(id, `${key}:${id}`, unique.text)) {
        if (entry.status === 'calculated' || entry.status === 'approximated') {
          const omitted = entry.outcomes.filter((outcome) => outcome !== 'stats' && outcome !== 'sp');
          if (omitted.length) entries.push({ ...entry, status: 'omitted', reason: 'unsupported', outcomes: omitted, deckDependent: base.deckDependent });
        } else entries.push({ ...entry, deckDependent: base.deckDependent });
      }
    }
    if (!outputs.length) entries.push({ ...base, status: 'unrecognized', reason: 'unknownPayload', outcomes: ['unknown'] });
  });
  return entries;
}
