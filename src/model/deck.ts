import { perStat, type Card, type Character, type Data, type StatValues } from '../types.ts';
import type { Settings } from '../settings.ts';
import { cardContribution, raceScale, uniqueExtras, type Contribution } from './stats.ts';
import { BORROWED_SLOTS, DECK_SIZE, PRIORITIZED_SKILLS_MAX } from './rules.ts';
import type { RaceWins } from './races.ts';
import type { PreparedRunSources } from './run-sources.ts';
import { hasWhiteSpark, isDebuff, isGold, cardSourcesForTarget, combineSources, purchasedOwnership, eventSources, type EventRef, type EventSource, isChoiceSource, lineageSources, lineageCount, pruneConflicts, scenarioCompletionSources, scenarioOptions, scenarioSources, sparkChance, type Blocker, traineeEventSources, traineeSources, type Conflict, type Lineage, type Ownership, type SkillSource, type Target } from './sparks.ts';

/** Everything a run evaluation needs besides the cards: the data, the settings and the run's fixed choices. */
export interface Ctx {
  data: Data;
  settings: Settings;
  races: number;                 // total completed races, including scenario finales
  totalTurns: number;
  trainee: Character | null;
  raceWins: RaceWins;            // win chance per agenda race, for the trainee's secret events
  lineage: Map<number, Lineage>; // target.id -> existing lineage sparks
  priority: number[] | null;     // listed skill ids in order, including every family form. Null: no list calculated yet; []: no listed skills.
  fansBefore?: (slot: number) => number; // the agenda's expected fans before a slot, for fan-scaled unique effects
  sources?: PreparedRunSources; // shared only by candidates of the same plan
}
/** A Ctx with no agenda, lineage or priority unless given; for tests and scripts. */
export function makeCtx(base: Pick<Ctx, 'data' | 'settings' | 'races' | 'totalTurns' | 'trainee'> & Partial<Ctx>): Ctx {
  return { raceWins: new Map(), lineage: new Map(), priority: null, ...base };
}
/** Everything already in play for the run: non-scenario sources per target, and which characters are present. */
export interface Existing { sources: Map<number, SkillSource[]>; chars: Set<number>; cards: Card[]; limitBreaks?: Map<number, number> }
const lineageN = (ctx: Ctx, t: Target) => { const l = ctx.lineage.get(t.id); return l ? lineageCount(l) : 0; };
const cloneExisting = (e: Existing): Existing => ({ sources: new Map([...e.sources].map(([k, v]) => [k, v.slice()])), chars: new Set(e.chars), cards: e.cards.slice(), limitBreaks: new Map(e.limitBreaks) });
/** Mutates `e`, which must own its source arrays. */
function addInPlace(e: Existing, add: Map<number, SkillSource[]>, card: Card, lb: number): Existing {
  for (const [t, ss] of add) e.sources.set(t, [...(e.sources.get(t) ?? []), ...ss]);
  e.chars.add(card.charId);
  e.cards.push(card);
  e.limitBreaks!.set(card.id, lb);
  return e;
}
const addTo = (e: Existing, add: Map<number, SkillSource[]>, card: Card, lb: number): Existing => addInPlace(cloneExisting(e), add, card, lb);
/** Non-target choice-gated options in the run (scenario options and card event options) that could outrank a target in the prioritized list. */
function blockersOf(e: Existing, targets: Target[], ctx: Ctx, options = scenarioOptions(ctx.data, ctx.settings, e.chars)): Blocker[] {
  const { families, traineeBlockers } = memoOf(ctx, targets);
  const out: Blocker[] = [];
  for (const o of options) if (!families.has(o.skillId)) out.push({ skillId: o.skillId, event: o.event });
  for (const card of e.cards) for (const s of eventSources(card, ctx.settings, ctx.data)) if (isChoiceSource(s) && !families.has(s.skillId)) out.push({ skillId: s.skillId, event: s.event });
  out.push(...traineeBlockers);
  return out;
}

/**
 * Evaluate a run state: add the scenario's options and completion reward, enforce one option per event (by
 * prioritized order), and give each target's spark chance.
 */
export function evaluate(e: Existing, targets: Target[], ctx: Ctx): { full: Map<number, SkillSource[]>; map: Map<number, SkillSource[]>; sparks: Map<number, number>; conflicts: Conflict[] } {
  const { full, map, conflicts } = resolveCoverage(e, targets, ctx);
  const sparks = new Map(targets.map((t) => [t.id, hasWhiteSpark(t) ? sparkChance(purchasedOwnership(t, combineSources(map.get(t.id) ?? [])), ctx.settings, lineageN(ctx, t)) : 0]));
  return { full, map, sparks, conflicts };
}
function resolveCoverage(e: Existing, targets: Target[], ctx: Ctx) {
  const full = new Map<number, SkillSource[]>();
  const options = scenarioOptions(ctx.data, ctx.settings, e.chars);
  for (const t of targets) full.set(t.id, [...(e.sources.get(t.id) ?? []), ...scenarioSources(t, ctx.data, ctx.settings, e.chars, options), ...(ctx.sources?.completion(t) ?? scenarioCompletionSources(t, ctx.data, ctx.settings))]);
  const { map, conflicts } = pruneConflicts(full, ctx.priority, blockersOf(e, targets, ctx, options), ctx.settings, targets);
  return { full, map, conflicts };
}
const total = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);

export interface Coverage { target: Target; sources: SkillSource[]; own: Ownership; spark: number; marginal: number }
export interface CardScore {
  card: Card;
  lb: number;
  stats: StatValues;    // contribution at the chosen race count
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
  for (const t of targets) sources.set(t.id, ctx.sources?.trainee(t).slice() ?? [
    ...(ctx.trainee ? traineeSources(ctx.trainee, t, ctx.data, ctx.settings, ctx.raceWins) : []),
    ...lineageSources(t, ctx.lineage.get(t.id), ctx.settings),
  ]);
  return { sources, chars: new Set(ctx.trainee ? [ctx.trainee.charId] : []), cards: [], limitBreaks: new Map() };
}

/** Per-context memo of what does not change within one plan: each card's sources per target, and the trainee's blockers. */
interface CtxMemo { targets: Target[]; mines: Map<string, Map<number, SkillSource[]>>; families: Set<number>; traineeBlockers: Blocker[] }
const ctxMemos = new WeakMap<Ctx, CtxMemo>();
function memoOf(ctx: Ctx, targets: Target[]): CtxMemo {
  let m = ctxMemos.get(ctx);
  if (!m || m.targets !== targets) {
    const families = new Set(targets.flatMap((t) => [...t.familyIds]));
    const traineeBlockers: Blocker[] = [];
    if (ctx.trainee) for (const s of traineeEventSources(ctx.trainee, ctx.raceWins, ctx.settings, ctx.data)) if (isChoiceSource(s) && !families.has(s.skillId)) traineeBlockers.push({ skillId: s.skillId, event: s.event });
    m = { targets, mines: new Map(), families, traineeBlockers };
    ctxMemos.set(ctx, m);
  }
  return m;
}
/**
 * The card's own sources per target (fixed for a card and limit break within one context). Prepared arrays are
 * stored by reference and reach the plan through each deck entry's `mine`, so readers spread them rather than mutate.
 */
function minesOf(card: Card, lb: number, targets: Target[], ctx: Ctx): Map<number, SkillSource[]> {
  const memo = memoOf(ctx, targets);
  const key = `${card.id}:${lb}`;
  let mine = memo.mines.get(key);
  if (mine) return mine;
  mine = new Map<number, SkillSource[]>();
  for (const t of targets) {
    const sources = ctx.sources?.card(card, lb, t) ?? cardSourcesForTarget(card, lb, t, ctx.races, ctx.totalTurns, ctx.data, ctx.settings);
    if (sources.length) mine.set(t.id, sources);
  }
  memo.mines.set(key, mine);
  return mine;
}
/** Stat contribution at the run's race count (compound unique effects evaluated against the other cards in the run and the agenda), and its value under the chosen training focus. */
function statsOf(card: Card, lb: number, ctx: Ctx, others: { card: Card; lb: number }[]): { contrib: Contribution; stats: StatValues; statPower: number; sp: number } {
  const extra = uniqueExtras(card, lb, ctx.data.model, { deck: [...others, { card, lb }], fansBefore: ctx.fansBefore });
  const contrib = cardContribution(card, lb, ctx.data.model, extra);
  const scale = raceScale(ctx.races, ctx.data.model, ctx.settings);
  const stats = perStat((_, i) => contrib.stats[i] * scale);
  const focusMul: StatValues = ctx.data.model.focus[ctx.settings.focus] ?? [1, 1, 1, 1, 1];
  return { contrib, stats, statPower: perStat((_, i) => stats[i] * focusMul[i]).reduce((a, v) => a + v, 0), sp: contrib.sp * scale };
}

export function scoreCard(card: Card, lb: number, targets: Target[], existing: Existing, ctx: Ctx): CardScore {
  const { contrib, stats, statPower, sp } = statsOf(card, lb, ctx, existing.cards.map((c) => ({ card: c, lb: existing.limitBreaks?.get(c.id) ?? 0 })));
  const mine = minesOf(card, lb, targets, ctx);
  const alone = evaluate({ sources: mine, chars: new Set([card.charId]), cards: [card] }, targets, ctx);
  const before = evaluate(existing, targets, ctx);
  const after = evaluate(addTo(existing, mine, card, lb), targets, ctx);
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

export interface DeckResult { deck: CardScore[]; steps: string[]; coverage: Map<number, SkillSource[]>; sparks: Map<number, number>; conflicts: Conflict[] }

/** The cards of a deck entry that matter to a run state: its sources and character. */
type Entry = Pick<CardScore, 'card' | 'lb' | 'mine' | 'statPower' | 'borrowed'>;
/** Resolve purchase sources once, without computing a card ranking for every available skill. */
export function purchaseCoverage(entries: { card: Card; lb: number }[], targets: Target[], ctx: Ctx): Map<number, SkillSource[]> {
  const sources = entries.map((e) => ({ ...e, mine: minesOf(e.card, e.lb, targets, ctx), statPower: 0 }));
  return resolveCoverage(stateOf(sources, targets, ctx), targets, ctx).map;
}
/** Focus-weighted deck contribution without per-card coverage details. */
export function deckStatPower(entries: { card: Card; lb: number }[], ctx: Ctx): number {
  return entries.reduce((sum, e, i) => sum + statsOf(e.card, e.lb, ctx, entries.filter((_, j) => i !== j)).statPower, 0);
}
export function describeDeck(entries: { card: Card; lb: number; borrowed?: boolean }[], targets: Target[], ctx: Ctx): DeckResult {
  const sourceEntries = entries.map((e) => ({ ...e, mine: minesOf(e.card, e.lb, targets, ctx), statPower: 0 }));
  const deck = sourceEntries.map((e, i) => ({ ...scoreCard(e.card, e.lb, targets, stateOf(sourceEntries.filter((_, j) => i !== j), targets, ctx), ctx), borrowed: e.borrowed }));
  const { map: coverage, sparks, conflicts } = evaluate(stateOf(deck, targets, ctx), targets, ctx);
  return { deck, coverage, sparks, conflicts, steps: [] };
}
/** Run state for a set of cards on top of the trainee. */
function stateOf(entries: Entry[], targets: Target[], ctx: Ctx): Existing {
  const e = traineeCoverage(targets, ctx);
  for (const x of entries) addInPlace(e, x.mine, x.card, x.lb);
  return e;
}
/** Total expected sparks over the targets for a set of cards, plus their focus-weighted stat power. */
function deckValue(entries: Entry[], targets: Target[], ctx: Ctx): { sparks: number; stats: number } {
  const stats = deckStatPower(entries, ctx);
  return { sparks: total(evaluate(stateOf(entries, targets, ctx), targets, ctx).sparks), stats };
}
/** Refresh contributions after the deck changes, including effects on cards that stayed in it. */
function refreshStats(deck: CardScore[], ctx: Ctx): void {
  deck.forEach((d, i) => {
    const { contrib, ...stats } = statsOf(d.card, d.lb, ctx, deck.filter((_, j) => j !== i));
    Object.assign(d, stats, { source: contrib.source, runs: contrib.runs });
  });
}
const betterValue = (a: { sparks: number; stats: number }, b: { sparks: number; stats: number }) => a.sparks > b.sparks + 1e-9 || (Math.abs(a.sparks - b.sparks) <= 1e-9 && a.stats > b.stats + 1e-6);
const why = (cs: CardScore) => (cs.marginalValue > 0
  ? `+${(cs.marginalValue * 100).toFixed(1)}% expected sparks (${cs.coverage.filter((c) => c.marginal > 0).map((c) => c.target.name).join(', ')})`
  : `no uncovered targets left; best stat stick (+${cs.statPower.toFixed(0)} focus-weighted stats)`);

export interface BuildOptions {
  pinnedIds: number[];        // owned pins shortlist the owned slots; unowned pins ask for the friend's slot
  borrowPool?: { card: Card; lb: number }[]; // every card at the borrowed limit break; empty means no friend's slot
  borrowFromAll?: boolean;    // with owned pins left over, borrow the best card overall instead of the best leftover pin
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
 */
export function buildDeck(pool: { card: Card; lb: number }[], targets: Target[], ctx: Ctx, options: BuildOptions): DeckResult {
  const { pinnedIds, borrowPool = [], borrowFromAll = false } = options;
  const ownedSlots = borrowPool.length ? DECK_SIZE - BORROWED_SLOTS : DECK_SIZE;
  let existing = traineeCoverage(targets, ctx);
  const deck: CardScore[] = [];
  const steps: string[] = [];
  const usedChars = new Set<number>();
  if (ctx.trainee) usedChars.add(ctx.trainee.charId);
  const ownedOpen = () => deck.filter((d) => !d.borrowed).length < ownedSlots;
  const borrowOpen = () => borrowPool.length > 0 && !deck.some((d) => d.borrowed);
  const add = (cs: CardScore, note: string) => {
    deck.push(cs); usedChars.add(cs.card.charId);
    existing = addTo(existing, cs.mine, cs.card, cs.lb);
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
  if (borrowPool.length) {
    const current = deck.find((d) => d.borrowed);
    if (!current) {
      // A borrow sharing a character with the last owned cards able to fill the owned slots would leave one empty.
      const ownedChars = new Set(pool.filter((p) => free(p) && !chosen.has(p.card.id)).map((p) => p.card.charId));
      const open = ownedSlots - deck.filter((d) => !d.borrowed).length;
      const leavesOwned = (p: { card: Card }) => ownedChars.size - Number(ownedChars.has(p.card.charId)) >= open;
      const candidates = borrowPool.filter(free);
      const best = (candidates.some(leavesOwned) ? candidates.filter(leavesOwned) : candidates).map((p) => score(p, true)).sort(cmp)[0];
      if (best) add(best, why(best));
    }
  }

  // 3. fill the owned slots left from the rest of the pool
  while (ownedOpen()) {
    const pick = pool.filter((p) => free(p) && !chosen.has(p.card.id)).map((p) => score(p, false)).sort(cmp)[0];
    if (!pick) break;
    add(pick, why(pick));
  }
  refreshStats(deck, ctx);

  // 4. upgrade: a deck card's higher-LB version as the borrow instead (replacing the borrow, if any), its slot refilled
  if (borrowPool.length && !pinnedBorrow) {
    const base = deckValue(deck, targets, ctx);
    let bestSwap: { entries: CardScore[]; value: { sparks: number; stats: number }; from: CardScore; to: CardScore; refill: CardScore | undefined } | null = null;
    for (const d of deck) {
      if (d.borrowed) continue;
      const up = borrowPool.find((b) => b.card.id === d.card.id && b.lb > d.lb);
      if (!up) continue;
      const without = deck.filter((x) => x !== d && !x.borrowed);
      const used = new Set(without.map((x) => x.card.charId).concat(ctx.trainee ? [ctx.trainee.charId] : []));
      const stateNow = stateOf(without, targets, ctx);
      const upScore = { ...scoreCard(up.card, up.lb, targets, stateNow, ctx), borrowed: true };
      const after = addTo(stateNow, upScore.mine, up.card, up.lb);
      used.add(up.card.charId);
      const refill = pool.filter((p) => !used.has(p.card.charId)).map((p) => scoreCard(p.card, p.lb, targets, after, ctx)).sort(cmp)[0];
      const entries = [...without, upScore, ...(refill ? [refill] : [])];
      const value = deckValue(entries, targets, ctx);
      if (betterValue(value, base) && (!bestSwap || betterValue(value, bestSwap.value))) {
        bestSwap = { entries, value, from: d, to: upScore, refill };
      }
    }
    if (bestSwap) {
      steps.push(`Borrow ${bestSwap.to.card.name} (LB${bestSwap.to.lb}) instead of your own copy at LB${bestSwap.from.lb}, which frees a slot${bestSwap.refill ? ` for ${bestSwap.refill.card.name}` : ''}: +${((bestSwap.value.sparks - base.sparks) * 100).toFixed(1)}% expected sparks`);
      deck.splice(0, deck.length, ...bestSwap.entries);
      refreshStats(deck, ctx);
    }
  }

  const { map: coverage, sparks, conflicts } = evaluate(stateOf(deck, targets, ctx), targets, ctx);
  return { deck, steps, coverage, sparks, conflicts };
}

/** What an entry is for in the goal: a required target, a preferred target, or an extra skill the run's events offer. */
export type EntryRole = 'required' | 'preferred' | 'extra';
/**
 * `events` are the choice events that offer the skill (one per event, whichever options), empty for a skill given
 * without a choice. `targetId` is the family's target for a target entry.
 */
export interface WishlistEntry { key: number; skillId: number; name: string; form: string | null; gated: boolean; isTarget: boolean; role: EntryRole; targetId: number | null; reason: string; weight: number; events: EventRef[] }
const uniqueEvents = (events: EventRef[]) => [...new Map(events.map((e) => [e.key, e])).values()];
function sourceReasons(sources: SkillSource[], ctx: Ctx): string {
  return [...new Set(sources.map((s) => {
    const owner = s.cardName ?? (s.kind === 'scenario' ? s.event.label : ctx.trainee?.name);
    return `${owner ? owner + ': ' : ''}${s.detail}`;
  }))].join('; ');
}

/**
 * Candidates for the prioritized-skills list, by weight: targets gated behind an event choice, then other
 * choice-gated skills the deck's events offer, then targets given without a choice (fillers). `required` names the
 * targets with that goal role; the other targets are preferred.
 */
export function wishlistCandidates(deck: { card: Card; lb: number }[], targets: Target[], ctx: Ctx, required: ReadonlySet<number> = new Set()): WishlistEntry[] {
  const entries: WishlistEntry[] = [];
  const roleOf = (t: Target): EntryRole => required.has(t.id) ? 'required' : 'preferred';
  const seen = new Set<number>();
  const targetFamilies = new Set(targets.flatMap((t) => [...t.familyIds]));
  const sourceEntries = deck.map((e) => ({ ...e, mine: minesOf(e.card, e.lb, targets, ctx), statPower: 0 }));
  const state = stateOf(sourceEntries, targets, ctx);
  const ev = evaluate(state, targets, ctx);
  for (const t of targets) {
    // every option the run could pick, including ones currently losing a conflict, so the order can be changed
    const all = (ev.full.get(t.id) ?? []).filter((s) => s.kind !== 'lineage' && s.kind !== 'innate' && s.kind !== 'awakening');
    if (!all.length) continue;
    const choice = all.filter(isChoiceSource);
    const spark = ev.sparks.get(t.id) ?? 0;
    if (choice.length) {
      // one entry per distinct skill the run can choose: the gold form and the white form are different picks
      const bySkill = new Map<number, EventSource[]>();
      for (const s of choice) bySkill.set(s.skillId, [...(bySkill.get(s.skillId) ?? []), s]);
      for (const [skillId, srcs] of [...bySkill].sort((a, b) => Number(!!b[1][0]?.gold) - Number(!!a[1][0]?.gold))) {
        const sk = ctx.data.skillById.get(skillId);
        const gold = !!srcs[0]?.gold;
        entries.push({ key: skillId, skillId, name: sk?.name ?? t.name, form: sk && sk.id !== (t.white?.id ?? t.id) ? t.name : null, gated: true, isTarget: true, role: roleOf(t), targetId: t.id,
          weight: 2 + spark + (gold ? 0.5 : 0), reason: sourceReasons(srcs, ctx), events: uniqueEvents(srcs.map((s) => s.event)) });
        seen.add(skillId);
      }
    } else {
      const src = all.find((s) => s.gold) ?? all[0]!;
      const sk = ctx.data.skillById.get(src.skillId);
      entries.push({ key: src.skillId, skillId: src.skillId, name: sk?.name ?? t.name, form: sk && sk.id !== (t.white?.id ?? t.id) ? t.name : null, gated: false, isTarget: true, role: roleOf(t), targetId: t.id, weight: spark, reason: sourceReasons(all.filter((s) => s.skillId === src.skillId), ctx), events: [] });
      seen.add(src.skillId);
    }
  }
  // The scenario's own options happen every run whoever is in the deck: list the ones that are not targets too.
  for (const o of scenarioOptions(ctx.data, ctx.settings, state.chars)) {
    if (seen.has(o.skillId) || targetFamilies.has(o.skillId)) continue;
    const sk = ctx.data.skillById.get(o.skillId);
    if (!sk || sk.unreleasedEn || isDebuff(sk)) continue;
    seen.add(o.skillId);
    entries.push({ key: o.skillId, skillId: o.skillId, name: sk.name, form: null, gated: true, isTarget: false, role: 'extra', targetId: null, weight: 1 + 0.5 * ctx.settings.scenarioPickRate * (isGold(sk) ? 1.2 : 1), reason: o.detail, events: [o.event] });
  }
  // Other choice-gated skills from the deck's and the trainee's events (not targets): listing them steers the AI to that option.
  const offered = [...deck.map((d) => ({ owner: d.card.name, sources: eventSources(d.card, ctx.settings, ctx.data) })), ...(ctx.trainee ? [{ owner: ctx.trainee.name, sources: traineeEventSources(ctx.trainee, ctx.raceWins, ctx.settings, ctx.data) }] : [])];
  // A skill offered by several cards' events is one entry with every event, so the list can tell which of them it steers.
  const bySkill = new Map<number, { owner: string; src: EventSource }[]>();
  for (const { owner, sources } of offered) for (const src of sources) if (src.isChoice && !seen.has(src.skillId) && !targetFamilies.has(src.skillId)) bySkill.set(src.skillId, [...(bySkill.get(src.skillId) ?? []), { owner, src }]);
  for (const [skillId, offers] of bySkill) {
    const sk = ctx.data.skillById.get(skillId);
    if (!sk || sk.unreleasedEn || isDebuff(sk)) continue;
    const pObtain = Math.max(...offers.map((o) => o.src.pObtain));
    entries.push({ key: skillId, skillId, name: sk.name, form: null, gated: true, isTarget: false, role: 'extra', targetId: null, weight: 1 + 0.5 * pObtain * (isGold(sk) ? 1.2 : 1),
      reason: offers.map((o) => `${o.owner}: ${o.src.detail}`).join('; '), events: uniqueEvents(offers.map((o) => o.src.event)) });
  }
  return entries.sort((a, b) => b.weight - a.weight);
}

/** Up to 10 prioritized skills in the default order. */
export function wishlist(deck: CardScore[], targets: Target[], ctx: Ctx, max = PRIORITIZED_SKILLS_MAX): WishlistEntry[] {
  return wishlistCandidates(deck, targets, ctx).slice(0, max);
}
