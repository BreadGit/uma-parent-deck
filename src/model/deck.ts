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
/** Everything already in play for the run: non-scenario sources per target, and which characters are present. */
export interface Existing { sources: Map<number, SkillSource[]>; chars: Set<number> }
const lineageN = (ctx: Ctx, t: Target) => { const l = ctx.lineage?.get(t.id); return l ? lineageCount(l) : 0; };
const cloneExisting = (e: Existing): Existing => ({ sources: new Map([...e.sources].map(([k, v]) => [k, v.slice()])), chars: new Set(e.chars) });
function addTo(e: Existing, add: Map<number, SkillSource[]>, chars: Iterable<number>): Existing {
  const out = cloneExisting(e);
  for (const [t, ss] of add) out.sources.set(t, [...(out.sources.get(t) ?? []), ...ss]);
  for (const c of chars) out.chars.add(c);
  return out;
}

/**
 * Evaluate a run state: add the scenario options implied by the characters present, enforce one option per event
 * (by prioritized order), and give each target's spark chance.
 */
export function evaluate(e: Existing, targets: Target[], ctx: Ctx): { full: Map<number, SkillSource[]>; map: Map<number, SkillSource[]>; sparks: Map<number, number>; conflicts: Conflict[] } {
  const full = new Map<number, SkillSource[]>();
  for (const t of targets) full.set(t.id, [...(e.sources.get(t.id) ?? []), ...scenarioSources(t, ctx.data, ctx.settings, e.chars)]);
  const { map, conflicts } = pruneConflicts(full, ctx.priority ?? []);
  const sparks = new Map(targets.map((t) => [t.id, sparkChance(combineSources(map.get(t.id) ?? []), ctx.settings, lineageN(ctx, t))]));
  return { full, map, sparks, conflicts };
}
const total = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);

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
  mine: Map<number, SkillSource[]>; // the card's own non-scenario sources per target
}

export function traineeCoverage(targets: Target[], ctx: Ctx): Existing {
  const sources = new Map<number, SkillSource[]>();
  for (const t of targets) sources.set(t.id, [
    ...(ctx.trainee ? traineeSources(ctx.trainee, t, ctx.data, ctx.settings) : []),
    ...lineageSources(t, ctx.lineage?.get(t.id), ctx.settings),
  ]);
  return { sources, chars: new Set(ctx.trainee ? [ctx.trainee.charId] : []) };
}

export function scoreCard(card: Card, lb: number, targets: Target[], existing: Existing, ctx: Ctx): CardScore {
  const contrib = cardContribution(card, lb, ctx.data.model);
  const scale = raceScale(ctx.races, ctx.data.model, ctx.settings);
  const stats = contrib.stats.map((v) => v * scale);
  const mine = new Map<number, SkillSource[]>();
  for (const t of targets) {
    const sources = cardSourcesForTarget(card, lb, t, ctx.races, ctx.totalTurns, ctx.data, ctx.settings);
    if (sources.length) mine.set(t.id, sources);
  }
  const alone = evaluate({ sources: mine, chars: new Set([card.charId]) }, targets, ctx);
  const before = evaluate(existing, targets, ctx);
  const after = evaluate(addTo(existing, mine, [card.charId]), targets, ctx);
  const coverage: Coverage[] = [];
  let sparkValue = 0, marginalValue = 0;
  for (const t of targets) {
    const sources = alone.map.get(t.id) ?? [];
    if (!sources.length) continue;
    const spark = alone.sparks.get(t.id) ?? 0;
    const marginal = Math.max(0, (after.sparks.get(t.id) ?? 0) - (before.sparks.get(t.id) ?? 0));
    coverage.push({ target: t, sources, own: combineSources(sources), spark, marginal });
    sparkValue += spark;
    marginalValue += marginal;
  }
  const statPower = stats.reduce((a, b) => a + b, 0);
  return { card, lb, stats, sp: contrib.sp * scale, statPower, source: contrib.source, runs: contrib.runs, coverage, sparkValue, marginalValue, score: marginalValue, mine };
}

const cmp = (a: CardScore, b: CardScore) => (b.marginalValue - a.marginalValue) || (b.statPower - a.statPower) || (b.sp - a.sp);

export function rankCards(pool: { card: Card; lb: number }[], targets: Target[], existing: Existing, ctx: Ctx): CardScore[] {
  return pool.map((p) => scoreCard(p.card, p.lb, targets, existing, ctx)).sort(cmp);
}

export interface BorrowOption { card: Card; replaces: Card | null; gain: number; statGain: number }
export interface DeckResult { deck: CardScore[]; steps: string[]; coverage: Map<number, SkillSource[]>; conflicts: Conflict[]; borrow: BorrowOption | null; borrowAlternatives: BorrowOption[] }

/** Run state for a set of cards on top of the trainee. */
function stateOf(entries: CardScore[], targets: Target[], ctx: Ctx): Existing {
  let e = traineeCoverage(targets, ctx);
  for (const x of entries) e = addTo(e, x.mine, [x.card.charId]);
  return e;
}
/** Total expected sparks over the targets for a set of cards, plus their stat power. */
function deckValue(entries: CardScore[], targets: Target[], ctx: Ctx): { sparks: number; stats: number } {
  return { sparks: total(evaluate(stateOf(entries, targets, ctx), targets, ctx).sparks), stats: entries.reduce((a, e) => a + e.statPower, 0) };
}

/**
 * Greedy deck: pinned cards first, then the best marginal card per slot, one card per character.
 * One of the six must be a friend's card: `borrowPool` (every card at its borrowed limit break) is tried against
 * each replaceable slot and the swap that adds the most expected sparks (then stats) becomes the borrow.
 */
export function buildDeck(pool: { card: Card; lb: number }[], targets: Target[], ctx: Ctx, pinnedIds: number[], size = 6, borrowPool: { card: Card; lb: number }[] = []): DeckResult {
  let existing = traineeCoverage(targets, ctx);
  const deck: CardScore[] = [];
  const steps: string[] = [];
  const usedChars = new Set<number>();
  if (ctx.trainee) usedChars.add(ctx.trainee.charId);
  const add = (cs: CardScore, why: string) => {
    deck.push(cs); usedChars.add(cs.card.charId);
    existing = addTo(existing, cs.mine, [cs.card.charId]);
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
    const options: { opt: BorrowOption; entries: CardScore[] }[] = [];
    for (const b of borrowPool) {
      if (ctx.trainee && b.card.charId === ctx.trainee.charId) continue;
      const bs = scoreCard(b.card, b.lb, targets, traineeCoverage(targets, ctx), ctx);
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
  const { map: coverage, conflicts } = evaluate(stateOf(deck, targets, ctx), targets, ctx);
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
  const ev = evaluate(stateOf(deck, targets, ctx), targets, ctx);
  for (const t of targets) {
    // every option the run could pick, including ones currently losing a conflict, so the order can be changed
    const all = (ev.full.get(t.id) ?? []).filter((s) => s.kind !== 'lineage' && s.kind !== 'innate' && s.kind !== 'awakening');
    if (!all.length) continue;
    const choice = all.filter((s) => s.isChoice);
    const spark = ev.sparks.get(t.id) ?? 0;
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
