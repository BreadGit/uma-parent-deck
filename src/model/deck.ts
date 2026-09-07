import type { Card, Character, Data } from '../types.ts';
import type { Settings } from '../settings.ts';
import { cardContribution, raceScale, type Contribution } from './stats.ts';
import { BORROWED_SLOTS, DECK_SIZE, PRIORITIZED_SKILLS_MAX } from './rules.ts';
import type { RaceWins } from './races.ts';
import { cardSourcesForTarget, combineSources, eventSources, isChoiceSource, lineageSources, lineageCount, pruneConflicts, scenarioCompletionSources, scenarioOptions, scenarioSources, sparkChance, type Blocker, traineeEventSources, traineeSources, type Conflict, type Lineage, type Ownership, type SkillSource, type Target } from './sparks.ts';

/** Everything a run evaluation needs besides the cards: the data, the settings and the run's fixed choices. */
export interface Ctx {
  data: Data;
  settings: Settings;
  races: number;
  totalTurns: number;
  trainee: Character | null;
  raceWins: RaceWins;            // win chance per agenda race, for the trainee's secret events
  lineage: Map<number, Lineage>; // target.id -> existing lineage sparks
  priority: number[];            // skill ids in prioritized-skill order (every form of a family); decides which option an event's choice goes to
}
/** A Ctx with no agenda, lineage or priority unless given; for tests and scripts. */
export function makeCtx(base: Pick<Ctx, 'data' | 'settings' | 'races' | 'totalTurns' | 'trainee'> & Partial<Ctx>): Ctx {
  return { raceWins: new Map(), lineage: new Map(), priority: [], ...base };
}
/** Everything already in play for the run: non-scenario sources per target, and which characters are present. */
export interface Existing { sources: Map<number, SkillSource[]>; chars: Set<number>; cards: Card[] }
const lineageN = (ctx: Ctx, t: Target) => { const l = ctx.lineage.get(t.id); return l ? lineageCount(l) : 0; };
const cloneExisting = (e: Existing): Existing => ({ sources: new Map([...e.sources].map(([k, v]) => [k, v.slice()])), chars: new Set(e.chars), cards: e.cards.slice() });
function addTo(e: Existing, add: Map<number, SkillSource[]>, card: Card): Existing {
  const out = cloneExisting(e);
  for (const [t, ss] of add) out.sources.set(t, [...(out.sources.get(t) ?? []), ...ss]);
  out.chars.add(card.charId);
  out.cards.push(card);
  return out;
}
/** Non-target choice-gated options in the run (scenario options and card event options) that could outrank a target in the prioritized list. */
function blockersOf(e: Existing, targets: Target[], ctx: Ctx): Blocker[] {
  const families = new Set(targets.flatMap((t) => [...t.familyIds]));
  const out: Blocker[] = [];
  for (const o of scenarioOptions(ctx.data, ctx.settings, e.chars)) if (!families.has(o.skillId)) out.push({ skillId: o.skillId, event: o.event });
  for (const card of e.cards) for (const s of eventSources(card, ctx.settings, ctx.data)) if (isChoiceSource(s) && !families.has(s.skillId)) out.push({ skillId: s.skillId, event: s.event });
  if (ctx.trainee) for (const s of traineeEventSources(ctx.trainee, ctx.raceWins, ctx.settings, ctx.data)) if (isChoiceSource(s) && !families.has(s.skillId)) out.push({ skillId: s.skillId, event: s.event });
  return out;
}

/**
 * Evaluate a run state: add the scenario's options and completion reward, enforce one option per event (by
 * prioritized order), and give each target's spark chance.
 */
export function evaluate(e: Existing, targets: Target[], ctx: Ctx): { full: Map<number, SkillSource[]>; map: Map<number, SkillSource[]>; sparks: Map<number, number>; conflicts: Conflict[] } {
  const full = new Map<number, SkillSource[]>();
  for (const t of targets) full.set(t.id, [...(e.sources.get(t.id) ?? []), ...scenarioSources(t, ctx.data, ctx.settings, e.chars), ...scenarioCompletionSources(t, ctx.data, ctx.settings)]);
  const { map, conflicts } = pruneConflicts(full, ctx.priority, blockersOf(e, targets, ctx));
  const sparks = new Map(targets.map((t) => [t.id, sparkChance(combineSources(map.get(t.id) ?? []), ctx.settings, lineageN(ctx, t))]));
  return { full, map, sparks, conflicts };
}
const total = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);

export interface Coverage { target: Target; sources: SkillSource[]; own: Ownership; spark: number; marginal: number }
export interface CardScore {
  card: Card;
  lb: number;
  stats: number[];      // contribution at the chosen race count
  sp: number;
  statPower: number;    // stat contribution weighted by the training focus multipliers
  source: Contribution['source'];
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
    ...(ctx.trainee ? traineeSources(ctx.trainee, t, ctx.data, ctx.settings, ctx.raceWins) : []),
    ...lineageSources(t, ctx.lineage.get(t.id), ctx.settings),
  ]);
  return { sources, chars: new Set(ctx.trainee ? [ctx.trainee.charId] : []), cards: [] };
}

/** The card's own sources per target. */
function minesOf(card: Card, lb: number, targets: Target[], ctx: Ctx): Map<number, SkillSource[]> {
  const mine = new Map<number, SkillSource[]>();
  for (const t of targets) {
    const sources = cardSourcesForTarget(card, lb, t, ctx.races, ctx.totalTurns, ctx.data, ctx.settings);
    if (sources.length) mine.set(t.id, sources);
  }
  return mine;
}
/** Stat contribution at the run's race count, and its value under the chosen training focus. */
function statsOf(card: Card, lb: number, ctx: Ctx): { contrib: Contribution; stats: number[]; statPower: number; sp: number } {
  const contrib = cardContribution(card, lb, ctx.data.model);
  const scale = raceScale(ctx.races, ctx.data.model, ctx.settings);
  const stats = contrib.stats.map((v) => v * scale);
  const focusMul = ctx.data.model.focus[ctx.settings.focus] ?? [1, 1, 1, 1, 1];
  return { contrib, stats, statPower: stats.reduce((a, v, i) => a + v * (focusMul[i] ?? 1), 0), sp: contrib.sp * scale };
}

export function scoreCard(card: Card, lb: number, targets: Target[], existing: Existing, ctx: Ctx): CardScore {
  const { contrib, stats, statPower, sp } = statsOf(card, lb, ctx);
  const mine = minesOf(card, lb, targets, ctx);
  const alone = evaluate({ sources: mine, chars: new Set([card.charId]), cards: [card] }, targets, ctx);
  const before = evaluate(existing, targets, ctx);
  const after = evaluate(addTo(existing, mine, card), targets, ctx);
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
  return { card, lb, stats, sp, statPower, source: contrib.source, runs: contrib.runs, coverage, sparkValue, marginalValue, score: marginalValue, mine };
}

const cmp = (a: CardScore, b: CardScore) => (b.marginalValue - a.marginalValue) || (b.statPower - a.statPower) || (b.sp - a.sp);

export function rankCards(pool: { card: Card; lb: number }[], targets: Target[], existing: Existing, ctx: Ctx): CardScore[] {
  return pool.map((p) => scoreCard(p.card, p.lb, targets, existing, ctx)).sort(cmp);
}

/** The friend's card: `replaces` is set when it is the LB4 version of a card the deck had at a lower limit break. */
export interface BorrowOption { card: Card; replaces: Card | null; gain: number; statGain: number }
export interface DeckResult { deck: CardScore[]; steps: string[]; coverage: Map<number, SkillSource[]>; sparks: Map<number, number>; conflicts: Conflict[]; borrow: BorrowOption | null; borrowAlternatives: BorrowOption[] }

/** The cards of a deck entry that matter to a run state: its sources and character. */
type Entry = Pick<CardScore, 'card' | 'lb' | 'mine' | 'statPower' | 'borrowed'>;
/** Run state for a set of cards on top of the trainee. */
function stateOf(entries: Entry[], targets: Target[], ctx: Ctx): Existing {
  let e = traineeCoverage(targets, ctx);
  for (const x of entries) e = addTo(e, x.mine, x.card);
  return e;
}
/** Total expected sparks over the targets for a set of cards, plus their focus-weighted stat power. */
function deckValue(entries: Entry[], targets: Target[], ctx: Ctx): { sparks: number; stats: number } {
  return { sparks: total(evaluate(stateOf(entries, targets, ctx), targets, ctx).sparks), stats: entries.reduce((a, e) => a + e.statPower, 0) };
}
const betterValue = (a: { sparks: number; stats: number }, b: { sparks: number; stats: number }) => a.sparks > b.sparks + 1e-9 || (Math.abs(a.sparks - b.sparks) <= 1e-9 && a.stats > b.stats + 1e-6);
const why = (cs: CardScore) => (cs.marginalValue > 0
  ? `+${(cs.marginalValue * 100).toFixed(1)}% expected sparks (${cs.coverage.filter((c) => c.marginal > 0).map((c) => c.target.name).join(', ')})`
  : `no uncovered targets left; best stat stick (+${cs.statPower.toFixed(0)} focus-weighted stats)`);

export interface BuildOptions {
  pinnedIds: number[];        // owned pins shortlist the owned slots; unowned pins ask for the friend's slot
  borrowPool?: { card: Card; lb: number }[]; // every card at the borrowed limit break; empty means no friend's slot
  borrowFromAll?: boolean;    // with owned pins left over, borrow the best card overall instead of the best leftover pin
  size?: number;
  swapPasses?: number;        // local improvement passes after the greedy build (0 disables)
}
type Slot = 'owned' | 'borrow';
type PinReason = 'same character' | 'outscored' | 'trainee';

/**
 * Deck builder: five owned slots and the friend's slot.
 * 1. Pins first, best marginal spark gain first, one per character. An owned pin goes to an owned slot at its own
 *    limit break; an unowned pin can only be the friend's card, so it competes for that slot at the borrowed LB.
 *    Once the owned slots are full, leftover owned pins compete for the friend's slot too unless `borrowFromAll`.
 *    When one character has both an owned and an unowned pin, whichever scores higher takes its slot.
 * 2. A friend's slot still open takes the best card overall from `borrowPool`.
 * 3. Owned slots still open fill greedily from the rest of the pool.
 * 4. If a deck card's higher-LB version would serve better as the borrow (freeing its slot for the next best owned
 *    card), swap; a pinned borrow is never evicted.
 * 5. One-swap improvement: while replacing any unpinned card with any other card raises the deck's expected
 *    sparks (or its focus-weighted stats at equal sparks), apply the best such swap. The greedy order is not
 *    optimal under the spark model; this catches the cases a single swap fixes.
 */
export function buildDeck(pool: { card: Card; lb: number }[], targets: Target[], ctx: Ctx, options: BuildOptions | number[], size = DECK_SIZE, legacyBorrowPool: { card: Card; lb: number }[] = []): DeckResult {
  const opts: BuildOptions = Array.isArray(options) ? { pinnedIds: options, borrowPool: legacyBorrowPool, size } : options;
  const pinnedIds = opts.pinnedIds, borrowPool = opts.borrowPool ?? [], borrowFromAll = !!opts.borrowFromAll;
  size = opts.size ?? size;
  const ownedSlots = borrowPool.length ? size - BORROWED_SLOTS : size;
  let existing = traineeCoverage(targets, ctx);
  const deck: CardScore[] = [];
  const steps: string[] = [];
  const usedChars = new Set<number>();
  if (ctx.trainee) usedChars.add(ctx.trainee.charId);
  const ownedOpen = () => deck.filter((d) => !d.borrowed).length < ownedSlots;
  const borrowOpen = () => borrowPool.length > 0 && !deck.some((d) => d.borrowed);
  const add = (cs: CardScore, note: string) => {
    deck.push(cs); usedChars.add(cs.card.charId);
    existing = addTo(existing, cs.mine, cs.card);
    steps.push(`${cs.card.name} (LB${cs.lb})${cs.borrowed ? ', borrowed' : ''}: ${note}`);
  };
  const free = (p: { card: Card }) => !usedChars.has(p.card.charId);
  const score = (p: { card: Card; lb: number }, borrowed: boolean): CardScore => ({ ...scoreCard(p.card, p.lb, targets, existing, ctx), borrowed });

  // 1. pins
  const owned = new Map(pool.map((p) => [p.card.id, p]));
  const borrowable = new Map(borrowPool.map((p) => [p.card.id, p]));
  const pins = pinnedIds.map((id) => owned.get(id) ?? borrowable.get(id)).filter((x): x is { card: Card; lb: number } => !!x);
  const isOwnedPin = (p: { card: Card }) => owned.has(p.card.id);
  const chosen = new Set<number>();
  let pinnedBorrow = false;
  for (;;) {
    const cands: CardScore[] = [];
    for (const p of pins) {
      if (chosen.has(p.card.id) || !free(p)) continue;
      const slot: Slot | null = isOwnedPin(p) ? (ownedOpen() ? 'owned' : borrowOpen() && !borrowFromAll ? 'borrow' : null) : borrowOpen() ? 'borrow' : null;
      if (!slot) continue;
      cands.push(slot === 'owned' ? score(p, false) : score(borrowable.get(p.card.id) ?? p, true));
    }
    const pick = cands.sort(cmp)[0];
    if (!pick) break;
    chosen.add(pick.card.id);
    if (pick.borrowed) pinnedBorrow = true;
    add(pick, `pinned, ${why(pick)}`);
  }
  for (const p of pins) {
    if (chosen.has(p.card.id)) continue;
    const reason: PinReason = ctx.trainee && p.card.charId === ctx.trainee.charId ? 'trainee' : deck.some((d) => d.card.charId === p.card.charId) ? 'same character' : 'outscored';
    const detail = reason === 'trainee' ? "the trainee's own card" : reason === 'same character' ? `same character as ${deck.find((d) => d.card.charId === p.card.charId)!.card.name}`
      : isOwnedPin(p) ? `lower added spark chance than the ${ownedSlots} chosen` : `the friend's slot went to ${deck.find((d) => d.borrowed)?.card.name ?? 'another card'}`;
    steps.push(`${p.card.name} (LB${p.lb})${isOwnedPin(p) ? '' : ', not owned'}: pinned but not chosen, ${detail}`);
  }

  // 2. the friend's card, if no pin took the slot
  let borrow: BorrowOption | null = null;
  const alternatives: BorrowOption[] = [];
  if (borrowPool.length) {
    const ranked = borrowPool.filter(free).map((p) => score(p, true)).sort(cmp);
    const current = deck.find((d) => d.borrowed);
    if (current) {
      borrow = { card: current.card, replaces: null, gain: current.marginalValue, statGain: current.statPower };
      for (const r of ranked.slice(0, 5)) alternatives.push({ card: r.card, replaces: null, gain: r.marginalValue, statGain: r.statPower });
    } else if (ranked[0]) {
      add(ranked[0], why(ranked[0]));
      borrow = { card: ranked[0].card, replaces: null, gain: ranked[0].marginalValue, statGain: ranked[0].statPower };
      for (const r of ranked.slice(1, 6)) alternatives.push({ card: r.card, replaces: null, gain: r.marginalValue, statGain: r.statPower });
    }
  }

  // 3. fill the owned slots left from the rest of the pool
  while (ownedOpen()) {
    const pick = pool.filter((p) => free(p) && !chosen.has(p.card.id)).map((p) => score(p, false)).sort(cmp)[0];
    if (!pick) break;
    add(pick, why(pick));
  }

  // 4. upgrade: a deck card's higher-LB version as the borrow instead (replacing the borrow, if any), its slot refilled
  if (borrowPool.length && !pinnedBorrow) {
    const base = deckValue(deck, targets, ctx);
    let bestSwap: { entries: CardScore[]; opt: BorrowOption; value: { sparks: number; stats: number }; from: CardScore; to: CardScore; refill: CardScore | undefined } | null = null;
    for (const d of deck) {
      if (d.borrowed) continue;
      const up = borrowPool.find((b) => b.card.id === d.card.id && b.lb > d.lb);
      if (!up) continue;
      const without = deck.filter((x) => x !== d && !x.borrowed);
      const used = new Set(without.map((x) => x.card.charId).concat(ctx.trainee ? [ctx.trainee.charId] : []));
      const stateNow = stateOf(without, targets, ctx);
      const upScore = { ...scoreCard(up.card, up.lb, targets, stateNow, ctx), borrowed: true };
      const after = addTo(stateNow, upScore.mine, up.card);
      used.add(up.card.charId);
      const refill = pool.filter((p) => !used.has(p.card.charId)).map((p) => scoreCard(p.card, p.lb, targets, after, ctx)).sort(cmp)[0];
      const entries = [...without, upScore, ...(refill ? [refill] : [])];
      const value = deckValue(entries, targets, ctx);
      if (betterValue(value, base) && (!bestSwap || betterValue(value, bestSwap.value))) {
        bestSwap = { entries, value, from: d, to: upScore, refill, opt: { card: up.card, replaces: d.card, gain: value.sparks - base.sparks, statGain: value.stats - base.stats } };
      }
    }
    if (bestSwap) {
      steps.push(`Borrow ${bestSwap.to.card.name} (LB${bestSwap.to.lb}) instead of your own copy at LB${bestSwap.from.lb}, which frees a slot${bestSwap.refill ? ` for ${bestSwap.refill.card.name}` : ''}: +${(bestSwap.opt.gain * 100).toFixed(1)}% expected sparks`);
      deck.splice(0, deck.length, ...bestSwap.entries);
      borrow = bestSwap.opt;
    }
  }

  // 5. one-swap improvement
  const pinnedSet = new Set(pinnedIds);
  for (let pass = 0; pass < (opts.swapPasses ?? 3); pass++) {
    const base = deckValue(deck, targets, ctx);
    let best: { index: number; pick: { card: Card; lb: number }; value: { sparks: number; stats: number } } | null = null;
    deck.forEach((d, index) => {
      if (pinnedSet.has(d.card.id)) return;
      const others = deck.filter((_, j) => j !== index);
      const used = new Set(others.map((x) => x.card.charId).concat(ctx.trainee ? [ctx.trainee.charId] : []));
      const cands = (d.borrowed ? borrowPool : pool).filter((p) => !used.has(p.card.charId) && !(p.card.id === d.card.id && p.lb === d.lb) && !others.some((o) => o.card.id === p.card.id));
      for (const p of cands) {
        const entry: Entry = { card: p.card, lb: p.lb, mine: minesOf(p.card, p.lb, targets, ctx), statPower: statsOf(p.card, p.lb, ctx).statPower, borrowed: d.borrowed };
        // a card with no source for any target cannot raise the sparks, so it only matters as a better stat stick
        if (!entry.mine.size && entry.statPower <= d.statPower) continue;
        const value = deckValue([...others, entry], targets, ctx);
        if (betterValue(value, best?.value ?? base)) best = { index, pick: p, value };
      }
    });
    if (!best) break;
    const b: { index: number; pick: { card: Card; lb: number }; value: { sparks: number; stats: number } } = best;
    const out = deck[b.index]!;
    const others = deck.filter((_, j) => j !== b.index);
    const cs = { ...scoreCard(b.pick.card, b.pick.lb, targets, stateOf(others, targets, ctx), ctx), borrowed: out.borrowed };
    deck.splice(b.index, 1, cs);
    if (out.borrowed) borrow = { card: cs.card, replaces: null, gain: cs.marginalValue, statGain: cs.statPower };
    const gain = b.value.sparks - base.sparks;
    steps.push(`Swap ${out.card.name} (LB${out.lb}) for ${cs.card.name} (LB${cs.lb})${out.borrowed ? ' as the borrow' : ''}: ${gain > 1e-9 ? `+${(gain * 100).toFixed(1)}% expected sparks` : `same sparks, +${(b.value.stats - base.stats).toFixed(0)} focus-weighted stats`}`);
  }

  const { map: coverage, sparks, conflicts } = evaluate(stateOf(deck, targets, ctx), targets, ctx);
  return { deck, steps, coverage, sparks, conflicts, borrow, borrowAlternatives: alternatives };
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
  // The scenario's own options happen every run whoever is in the deck: list the ones that are not targets too.
  const state = stateOf(deck, targets, ctx);
  for (const o of scenarioOptions(ctx.data, ctx.settings, state.chars)) {
    if (seen.has(o.skillId) || targetFamilies.has(o.skillId)) continue;
    const sk = ctx.data.skillById.get(o.skillId);
    if (!sk || sk.unreleasedEn) continue;
    seen.add(o.skillId);
    entries.push({ key: o.skillId, skillId: o.skillId, name: sk.name, form: null, gated: true, isTarget: false, weight: 1 + 0.5 * ctx.settings.scenarioPickRate * (sk.rarity === 2 ? 1.2 : 1), reason: o.detail });
  }
  // Other choice-gated skills from the deck's and the trainee's events (not targets): listing them steers the AI to that option.
  const offered = [...deck.map((d) => ({ owner: d.card.name, sources: eventSources(d.card, ctx.settings, ctx.data) })), ...(ctx.trainee ? [{ owner: ctx.trainee.name, sources: traineeEventSources(ctx.trainee, ctx.raceWins, ctx.settings, ctx.data) }] : [])];
  for (const { owner, sources } of offered) {
    for (const src of sources) {
      if (!src.isChoice || seen.has(src.skillId) || targetFamilies.has(src.skillId)) continue;
      const sk = ctx.data.skillById.get(src.skillId);
      if (!sk || sk.unreleasedEn) continue;
      seen.add(src.skillId);
      entries.push({ key: src.skillId, skillId: src.skillId, name: sk.name, form: null, gated: true, isTarget: false, weight: 1 + 0.5 * src.pObtain * (sk.rarity === 2 ? 1.2 : 1), reason: `${owner}: ${src.detail}` });
    }
  }
  return entries.sort((a, b) => b.weight - a.weight);
}

/** Up to 10 prioritized skills in the default order. */
export function wishlist(deck: CardScore[], targets: Target[], ctx: Ctx, max = PRIORITIZED_SKILLS_MAX): WishlistEntry[] {
  return wishlistCandidates(deck, targets, ctx).slice(0, max);
}
