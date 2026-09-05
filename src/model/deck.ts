import type { Card, Character, Data, Stat } from '../types.ts';
import { STATS } from '../types.ts';
import type { Settings } from '../settings.ts';
import { cardContribution, raceScale } from './stats.ts';
import { cardSourcesForTarget, combineSources, lineageSources, sparkChance, traineeSources, type Lineage, type SkillSource, type Target } from './sparks.ts';

export interface Ctx {
  data: Data;
  settings: Settings;
  races: number;
  totalTurns: number;
  trainee: Character | null;
  lineage?: Map<number, Lineage>; // target.id -> existing lineage sparks
}
const lineageN = (ctx: Ctx, t: Target) => ctx.lineage?.get(t.id)?.n ?? 0;

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
  borrowed?: boolean;    // this slot is the friend's card, assumed at LB4
}

export type Existing = Map<number, SkillSource[]>; // target.id -> sources already in play (trainee + deck)

export function traineeCoverage(targets: Target[], ctx: Ctx): Existing {
  const m: Existing = new Map();
  for (const t of targets) m.set(t.id, [...(ctx.trainee ? traineeSources(ctx.trainee, t, ctx.data) : []), ...lineageSources(t, ctx.lineage?.get(t.id), ctx.settings)]);
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
    const n = lineageN(ctx, t);
    const spark = sparkChance(own, ctx.settings, n);
    const prior = existing.get(t.id) ?? [];
    const before = sparkChance(combineSources(prior), ctx.settings, n);
    const after = sparkChance(combineSources([...prior, ...sources]), ctx.settings, n);
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

export interface BorrowOption { card: Card; replaces: Card | null; gain: number; statGain: number }
export interface DeckResult { deck: CardScore[]; steps: string[]; coverage: Existing; borrow: BorrowOption | null; borrowAlternatives: BorrowOption[] }

/** Total expected sparks over the targets for a set of cards, plus their stat power. */
function deckValue(entries: CardScore[], targets: Target[], ctx: Ctx): { sparks: number; stats: number } {
  const existing = traineeCoverage(targets, ctx);
  for (const e of entries) for (const c of e.coverage) existing.set(c.target.id, [...(existing.get(c.target.id) ?? []), ...c.sources]);
  let sparks = 0;
  for (const t of targets) sparks += sparkChance(combineSources(existing.get(t.id) ?? []), ctx.settings, lineageN(ctx, t));
  return { sparks, stats: entries.reduce((a, e) => a + e.statPower, 0) };
}

/**
 * Greedy deck: pinned cards first, then the best marginal card per slot, one card per character.
 * One of the six must be a friend's card: `borrowPool` (every card at its borrowed limit break) is tried against
 * each replaceable slot and the swap that adds the most expected sparks (then stats) becomes the borrow.
 */
export function buildDeck(pool: { card: Card; lb: number }[], targets: Target[], ctx: Ctx, pinnedIds: number[], size = 6, borrowPool: { card: Card; lb: number }[] = []): DeckResult {
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

  // Borrow slot.
  let borrow: BorrowOption | null = null;
  const alternatives: BorrowOption[] = [];
  if (borrowPool.length && deck.length) {
    const base = deckValue(deck, targets, ctx);
    const emptyExisting = traineeCoverage(targets, ctx);
    const options: { opt: BorrowOption; entries: CardScore[] }[] = [];
    for (const b of borrowPool) {
      if (ctx.trainee && b.card.charId === ctx.trainee.charId) continue;
      const bs = scoreCard(b.card, b.lb, targets, emptyExisting, ctx);
      const sameChar = deck.findIndex((d) => d.card.charId === b.card.charId);
      const slots = sameChar >= 0 ? [sameChar] : deck.map((_, i) => i).filter((i) => !pinnedIds.includes(deck[i]!.card.id));
      for (const i of slots) {
        const cur = deck[i]!;
        if (cur.card.id === b.card.id && cur.lb >= b.lb) {
          // already yours at this LB: borrowing it gains nothing but is allowed
          options.push({ opt: { card: b.card, replaces: cur.card, gain: 0, statGain: 0 }, entries: deck.map((d, j) => (j === i ? { ...bs, borrowed: true } : d)) });
          continue;
        }
        const entries = deck.map((d, j) => (j === i ? { ...bs, borrowed: true } : d));
        const v = deckValue(entries, targets, ctx);
        options.push({ opt: { card: b.card, replaces: cur.card, gain: v.sparks - base.sparks, statGain: v.stats - base.stats }, entries });
      }
    }
    options.sort((a, b) => (b.opt.gain - a.opt.gain) || (b.opt.statGain - a.opt.statGain));
    const best = options[0];
    if (best) {
      const finalDeck = best.entries;
      deck.splice(0, deck.length, ...finalDeck);
      borrow = best.opt;
      const seen = new Set<number>([best.opt.card.id]);
      for (const o of options) { if (alternatives.length >= 5) break; if (seen.has(o.opt.card.id)) continue; seen.add(o.opt.card.id); alternatives.push(o.opt); }
      steps.push(best.opt.gain > 1e-9
        ? `Borrow ${best.opt.card.name} (LB4) in place of ${best.opt.replaces?.name ?? '—'}: +${(best.opt.gain * 100).toFixed(1)}% expected sparks`
        : `Borrow ${best.opt.card.name} (LB4): your own six are already the best, so any of them can be the friend's card`);
    }
  }
  const coverage = traineeCoverage(targets, ctx);
  for (const e of deck) for (const c of e.coverage) coverage.set(c.target.id, [...(coverage.get(c.target.id) ?? []), ...c.sources]);
  return { deck, steps, coverage, borrow, borrowAlternatives: alternatives };
}

export interface WishlistEntry { skillId: number; name: string; gated: boolean; reason: string }

/** Up to 10 prioritized skills: targets gated behind an event choice first, then other covered targets. */
export function wishlist(deck: CardScore[], targets: Target[], ctx: Ctx, max = 10): WishlistEntry[] {
  const entries: (WishlistEntry & { weight: number })[] = [];
  for (const t of targets) {
    const all = deck.flatMap((d) => d.coverage.filter((c) => c.target.id === t.id).flatMap((c) => c.sources));
    if (!all.length) continue;
    const choice = all.filter((s) => s.isChoice);
    const spark = sparkChance(combineSources(all), ctx.settings, lineageN(ctx, t));
    if (choice.length) {
      const goldFirst = choice.find((s) => s.gold) ?? choice[0]!;
      const sk = ctx.data.skillById.get(goldFirst.skillId);
      entries.push({ skillId: goldFirst.skillId, name: sk?.name ?? t.name, gated: true, weight: 1 + spark, reason: choice.map((s) => `${s.cardName ? s.cardName + ': ' : ''}${s.detail}`).join('; ') });
    } else {
      const src = all.find((s) => s.gold) ?? all[0]!;
      const sk = ctx.data.skillById.get(src.skillId);
      entries.push({ skillId: src.skillId, name: sk?.name ?? t.name, gated: false, weight: spark, reason: 'Given without an event choice.' });
    }
  }
  return entries.sort((a, b) => b.weight - a.weight).slice(0, max).map(({ weight, ...e }) => { void weight; return e; });
}

export const statLabel = (s: Stat) => s[0]!.toUpperCase() + s.slice(1);
export const STAT_KEYS = STATS;
