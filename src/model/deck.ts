import type { Card, Character, Data, Stat } from '../types.ts';
import { STATS } from '../types.ts';
import type { Settings } from '../settings.ts';
import { cardContribution, raceScale } from './stats.ts';
import { cardSourcesForTarget, combineSources, eventSources, lineageSources, lineageCount, pruneConflicts, scenarioSources, sparkChance, traineeSources, type Conflict, type Lineage, type SkillSource, type Target } from './sparks.ts';

export interface Ctx {
  data: Data;
  settings: Settings;
  races: number;
  totalTurns: number;
  trainee: Character | null;
  lineage?: Map<number, Lineage>; // target.id -> existing lineage sparks
  priority?: number[];            // target ids in prioritized-skill order, decides which option an event's choice goes to
}
const withSources = (existing: Existing, add: Map<number, SkillSource[]>) => { const m = new Map(existing); for (const [t, ss] of add) m.set(t, [...(m.get(t) ?? []), ...ss]); return m; };
/** Spark chance per target after enforcing one option per event. */
function sparkMap(map: Map<number, SkillSource[]>, targets: Target[], ctx: Ctx): Map<number, number> {
  const pruned = pruneConflicts(map, ctx.priority ?? []).map;
  return new Map(targets.map((t) => [t.id, sparkChance(combineSources(pruned.get(t.id) ?? []), ctx.settings, lineageN(ctx, t))]));
}
const lineageN = (ctx: Ctx, t: Target) => { const l = ctx.lineage?.get(t.id); return l ? lineageCount(l) : 0; };

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
  for (const t of targets) m.set(t.id, [
    ...(ctx.trainee ? traineeSources(ctx.trainee, t, ctx.data, ctx.settings) : []),
    ...lineageSources(t, ctx.lineage?.get(t.id), ctx.settings),
    ...scenarioSources(t, ctx.data, ctx.settings, null), // options everyone gets: normal versions and the unaffiliated pick
  ]);
  return m;
}

export function scoreCard(card: Card, lb: number, targets: Target[], existing: Existing, ctx: Ctx): CardScore {
  const contrib = cardContribution(card, lb, ctx.data.model);
  const scale = raceScale(ctx.races, ctx.data.model, ctx.settings);
  const stats = contrib.stats.map((v) => v * scale);
  const coverage: Coverage[] = [];
  let sparkValue = 0, marginalValue = 0;
  const mine = new Map<number, SkillSource[]>();
  for (const t of targets) {
    const sources = cardSourcesForTarget(card, lb, t, ctx.races, ctx.totalTurns, ctx.data, ctx.settings);
    if (sources.length) mine.set(t.id, sources);
  }
  const alone = sparkMap(mine, targets, ctx);
  const before = sparkMap(existing, targets, ctx);
  const after = sparkMap(withSources(existing, mine), targets, ctx);
  for (const t of targets) {
    const sources = mine.get(t.id);
    if (!sources) continue;
    const own = combineSources(pruneConflicts(mine, ctx.priority ?? []).map.get(t.id) ?? []);
    const spark = alone.get(t.id) ?? 0;
    const marginal = Math.max(0, (after.get(t.id) ?? 0) - (before.get(t.id) ?? 0));
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
export interface DeckResult { deck: CardScore[]; steps: string[]; coverage: Existing; conflicts: Conflict[]; borrow: BorrowOption | null; borrowAlternatives: BorrowOption[] }

/** Total expected sparks over the targets for a set of cards, plus their stat power. */
function deckValue(entries: CardScore[], targets: Target[], ctx: Ctx): { sparks: number; stats: number } {
  const existing = traineeCoverage(targets, ctx);
  for (const e of entries) for (const c of e.coverage) existing.set(c.target.id, [...(existing.get(c.target.id) ?? []), ...c.sources]);
  const sparks = [...sparkMap(existing, targets, ctx).values()].reduce((a, b) => a + b, 0);
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
      // A pinned card stays: only the same card at a higher LB may replace it.
      if (sameChar >= 0 && pinnedIds.includes(deck[sameChar]!.card.id) && deck[sameChar]!.card.id !== b.card.id) continue;
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
  const raw = traineeCoverage(targets, ctx);
  for (const e of deck) for (const c of e.coverage) raw.set(c.target.id, [...(raw.get(c.target.id) ?? []), ...c.sources]);
  const { map: coverage, conflicts } = pruneConflicts(raw, ctx.priority ?? []);
  return { deck, steps, coverage, conflicts, borrow, borrowAlternatives: alternatives };
}

export interface WishlistEntry { key: number; skillId: number; name: string; form: string | null; gated: boolean; isTarget: boolean; reason: string; weight: number }

/**
 * Candidates for the prioritized-skills list, best first: targets gated behind an event choice, then other
 * choice-gated skills the deck's events offer, then targets given without a choice (fillers).
 */
export function wishlistCandidates(deck: CardScore[], targets: Target[], ctx: Ctx): WishlistEntry[] {
  const entries: WishlistEntry[] = [];
  const seen = new Set<number>();
  const targetFamilies = new Set(targets.flatMap((t) => [...t.familyIds]));
  const raw = traineeCoverage(targets, ctx);
  for (const d of deck) for (const c of d.coverage) raw.set(c.target.id, [...(raw.get(c.target.id) ?? []), ...c.sources]);
  const pruned = pruneConflicts(raw, ctx.priority ?? []).map;
  for (const t of targets) {
    const all = (pruned.get(t.id) ?? []).filter((s) => s.kind !== 'lineage' && s.kind !== 'innate' && s.kind !== 'awakening');
    if (!all.length) continue;
    const choice = all.filter((s) => s.isChoice);
    const spark = sparkChance(combineSources(all), ctx.settings, lineageN(ctx, t));
    if (choice.length) {
      // one entry per distinct skill the run can choose: the gold form and the white form are different picks
      const bySkill = new Map<number, SkillSource[]>();
      for (const s of choice) bySkill.set(s.skillId, [...(bySkill.get(s.skillId) ?? []), s]);
      for (const [skillId, srcs] of [...bySkill].sort((a, b) => Number(!!b[1][0]?.gold) - Number(!!a[1][0]?.gold))) {
        const sk = ctx.data.skillById.get(skillId);
        const gold = !!srcs[0]?.gold;
        entries.push({ key: skillId, skillId, name: sk?.name ?? t.name, form: sk && sk.id !== (t.white?.id ?? t.id) ? t.name : null, gated: true, isTarget: true,
          weight: 2 + spark + (gold ? 0.5 : 0), reason: srcs.map((s) => `${s.cardName ? s.cardName + ': ' : ''}${s.detail}`).join('; ') });
        seen.add(skillId);
      }
    } else {
      const src = all.find((s) => s.gold) ?? all[0]!;
      const sk = ctx.data.skillById.get(src.skillId);
      entries.push({ key: src.skillId, skillId: src.skillId, name: sk?.name ?? t.name, form: sk && sk.id !== (t.white?.id ?? t.id) ? t.name : null, gated: false, isTarget: true, weight: spark, reason: 'Given without an event choice.' });
      seen.add(src.skillId);
    }
  }
  // Other choice-gated skills from the deck's events (not targets): listing them steers the AI to that option.
  for (const d of deck) {
    for (const src of eventSources(d.card, ctx.settings)) {
      if (!src.isChoice || seen.has(src.skillId) || targetFamilies.has(src.skillId)) continue;
      const sk = ctx.data.skillById.get(src.skillId);
      if (!sk || sk.unreleasedEn) continue;
      seen.add(src.skillId);
      entries.push({ key: src.skillId, skillId: src.skillId, name: sk.name, form: null, gated: true, isTarget: false, weight: 1 + src.pObtain * (sk.rarity === 2 ? 2 : 1), reason: `${d.card.name}: ${src.detail}` });
    }
  }
  return entries.sort((a, b) => b.weight - a.weight);
}

/** Up to 10 prioritized skills in the default order. */
export function wishlist(deck: CardScore[], targets: Target[], ctx: Ctx, max = 10): WishlistEntry[] {
  return wishlistCandidates(deck, targets, ctx).slice(0, max);
}

export const statLabel = (s: Stat) => s[0]!.toUpperCase() + s.slice(1);
export const STAT_KEYS = STATS;
