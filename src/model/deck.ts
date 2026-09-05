import type { Card, Character, Data, Stat } from '../types.ts';
import { STATS } from '../types.ts';
import type { Settings } from '../settings.ts';
import { cardContribution, raceScale } from './stats.ts';
import { cardSourcesForTarget, combineSources, sparkChance, traineeSources, type SkillSource, type Target } from './sparks.ts';

export interface Ctx {
  data: Data;
  settings: Settings;
  races: number;
  totalTurns: number;
  trainee: Character | null;
}

export interface Coverage { target: Target; sources: SkillSource[]; own: { pGold: number; pWhite: number; pAny: number }; spark: number; marginal: number }
export interface CardScore {
  card: Card;
  lb: number;
  stats: number[];      // contribution at the chosen race count
  sp: number;
  statPower: number;    // sum of stat contribution
  source: string;
  runs?: number;
  coverage: Coverage[];
  sparkValue: number;   // Σ spark chance over targets (card alone)
  marginalValue: number; // Σ spark gain over what is already covered
  score: number;
}

export type Existing = Map<number, SkillSource[]>; // target.id -> sources already in play (trainee + deck)

export function traineeCoverage(targets: Target[], ctx: Ctx): Existing {
  const m: Existing = new Map();
  for (const t of targets) m.set(t.id, ctx.trainee ? traineeSources(ctx.trainee, t, ctx.data) : []);
  return m;
}

export function scoreCard(card: Card, lb: number, targets: Target[], existing: Existing, ctx: Ctx): CardScore {
  const contrib = cardContribution(card, lb, ctx.data.model);
  const scale = raceScale(ctx.races, ctx.data.model, ctx.settings);
  const stats = contrib.stats.map((v) => v * scale);
  const coverage: Coverage[] = [];
  let sparkValue = 0, marginalValue = 0;
  for (const t of targets) {
    const sources = cardSourcesForTarget(card, lb, t, ctx.races, ctx.totalTurns, ctx.data, ctx.settings);
    if (!sources.length) continue;
    const own = combineSources(sources);
    const spark = sparkChance(own, ctx.settings);
    const prior = existing.get(t.id) ?? [];
    const before = sparkChance(combineSources(prior), ctx.settings);
    const after = sparkChance(combineSources([...prior, ...sources]), ctx.settings);
    const marginal = Math.max(0, after - before);
    coverage.push({ target: t, sources, own, spark, marginal });
    sparkValue += spark;
    marginalValue += marginal;
  }
  const statPower = stats.reduce((a, b) => a + b, 0);
  return { card, lb, stats, sp: contrib.sp * scale, statPower, source: contrib.source, runs: contrib.runs, coverage, sparkValue, marginalValue, score: marginalValue };
}

const cmp = (a: CardScore, b: CardScore) => (b.marginalValue - a.marginalValue) || (b.statPower - a.statPower) || (b.sp - a.sp);

export function rankCards(pool: { card: Card; lb: number }[], targets: Target[], existing: Existing, ctx: Ctx): CardScore[] {
  return pool.map((p) => scoreCard(p.card, p.lb, targets, existing, ctx)).sort(cmp);
}

export interface DeckResult { deck: CardScore[]; steps: string[]; coverage: Existing }

/** Greedy deck: pinned cards first, then the best marginal card per slot, one card per character. */
export function buildDeck(pool: { card: Card; lb: number }[], targets: Target[], ctx: Ctx, pinnedIds: number[], size = 6): DeckResult {
  const existing = traineeCoverage(targets, ctx);
  const deck: CardScore[] = [];
  const steps: string[] = [];
  const usedChars = new Set<number>();
  if (ctx.trainee) usedChars.add(ctx.trainee.charId);
  const add = (cs: CardScore, why: string) => {
    deck.push(cs); usedChars.add(cs.card.charId);
    for (const c of cs.coverage) existing.set(c.target.id, [...(existing.get(c.target.id) ?? []), ...c.sources]);
    steps.push(`${cs.card.name} (LB${cs.lb}): ${why}`);
  };
  for (const id of pinnedIds) {
    const p = pool.find((x) => x.card.id === id);
    if (p && !usedChars.has(p.card.charId)) add(scoreCard(p.card, p.lb, targets, existing, ctx), 'pinned');
  }
  while (deck.length < size) {
    const candidates = pool.filter((p) => !usedChars.has(p.card.charId)).map((p) => scoreCard(p.card, p.lb, targets, existing, ctx)).sort(cmp);
    const best = candidates[0];
    if (!best) break;
    const why = best.marginalValue > 0
      ? `+${(best.marginalValue * 100).toFixed(1)}% expected sparks (${best.coverage.filter((c) => c.marginal > 0).map((c) => c.target.name).join(', ')})`
      : `no uncovered targets left; best stat stick (+${best.statPower.toFixed(0)} stats)`;
    add(best, why);
  }
  return { deck, steps, coverage: existing };
}

export interface WishlistEntry { skillId: number; name: string; gated: boolean; reason: string }

/** Up to 10 prioritized skills: targets gated behind an event choice first, then other covered targets. */
export function wishlist(deck: CardScore[], targets: Target[], ctx: Ctx, max = 10): WishlistEntry[] {
  const entries: (WishlistEntry & { weight: number })[] = [];
  for (const t of targets) {
    const all = deck.flatMap((d) => d.coverage.filter((c) => c.target.id === t.id).flatMap((c) => c.sources));
    if (!all.length) continue;
    const choice = all.filter((s) => s.isChoice);
    const spark = sparkChance(combineSources(all), ctx.settings);
    if (choice.length) {
      const goldFirst = choice.find((s) => s.gold) ?? choice[0]!;
      const sk = ctx.data.skillById.get(goldFirst.skillId);
      entries.push({ skillId: goldFirst.skillId, name: sk?.name ?? t.name, gated: true, weight: 1 + spark, reason: choice.map((s) => `${s.cardName ? s.cardName + ': ' : ''}${s.detail}`).join('; ') });
    } else {
      const src = all.find((s) => s.gold) ?? all[0]!;
      const sk = ctx.data.skillById.get(src.skillId);
      entries.push({ skillId: src.skillId, name: sk?.name ?? t.name, gated: false, weight: spark, reason: 'Not gated behind an event choice. Listing it costs nothing; whether the AI also chases its hints is unconfirmed.' });
    }
  }
  return entries.sort((a, b) => b.weight - a.weight).slice(0, max).map(({ weight, ...e }) => { void weight; return e; });
}

export const statLabel = (s: Stat) => s[0]!.toUpperCase() + s.slice(1);
export const STAT_KEYS = STATS;
