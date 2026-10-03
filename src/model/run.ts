import { STATS, type Card, type Character, type Data, type Inventory } from '../types.ts';
import type { Settings } from '../settings.ts';
import { goalFamily, goalWithTargets, type ParentGoal, type PinkSpark, type ResolvedGoal, type WhiteTarget } from './goal-input.ts';
import { startingAptitudes } from './pink-inherit.ts';
import { evaluateParentGoal, goalRankBands, pinkGoalsEstimate, type GoalEstimate } from './goal.ts';
import { buildDeck, deckStatPower, describeDeck, evaluate as evaluateSources, rankCards, traineeCoverage, wishlistCandidates, type CardScore, type Ctx, type DeckResult, type Existing, type WishlistEntry } from './deck.ts';
import { chooseGoal, goalSources, scoreGoal, type GoalScore } from './goal-objective.ts';
import { EXPLORATION_SAMPLES, SCREENED_DECKS, SEARCH_RANK_SAMPLES } from './goal-population.ts';
import { goalDeckConstraints, searchGoalDeck, type GoalDeckEntry, type GoalSearchResult } from './goal-deck.ts';
import { lineageCount, resolveTarget, type Lineage, type Target } from './sparks.ts';
import { predictDeck, totalTurns, type Prediction } from './stats.ts';
import { buildSchedule, goalRaces, racePopularity, raceWinChances, scheduleSummary, traineeAptitudes, type Aptitudes, type ScheduledRace } from './races.ts';
import { estimateFans, fansBeforeSlot, type FanEstimate } from './fans.ts';
import { rankEstimate, skillPointsOf, thresholdFor, uniqueSkillLevel, type RankEstimate } from './rank.ts';
import { displayedStat, statMasses, statMoments } from './stat-outcomes.ts';
import { estimatePurchases, estimateSkillRating, targetSpCost, type Purchases, type SkillRating, type SpCost } from './skill-purchases.ts';
import { projectForms } from './goal-skills.ts';
import { gainsOfParentSparks, inheritedFromParents, type Inheritance, type ParentSparks } from './inherit.ts';
import { clampStars, traineeAt } from './trainee.ts';
import { BORROWED_LB, BORROWED_SLOTS, DECK_SIZE, PRIORITIZED_SKILLS_MAX, SCENARIO_STAT_CAPS, SCENARIO_FINALE_FANS } from './rules.ts';
import { prepareRunSources } from './run-sources.ts';

/** Everything the user chose about the run. The app persists exactly this (plus UI-only fields). */
export interface RunInput {
  goal: ParentGoal;
  pinkLineage: (PinkSpark | null)[];
  targets: WhiteTarget[];                  // one entry per family, with its goal role and minimum stars
  targetLineage: Record<string, Lineage>;  // target id -> copies of the spark already in the lineage
  wishlistOrder: number[];                 // extra prioritized skills the user arranged, in order (targets keep the goal's order)
  wishlistExcluded: number[];              // extra prioritized skills the user hid from the list
  traineeCardId: number | null;
  traineeStars: number;                    // picks the base stat table
  aptOverrides: Partial<Aptitudes>;
  raceOverrides: Record<string, boolean>;  // calendar id -> forced in (true) or out (false)
  pinnedIds: number[];                     // pinned support cards: owned ones shortlist the owned slots, unowned ones ask for the friend's slot
  borrowFromAll: boolean;                  // with six or more owned pins, borrow the best card overall rather than the best leftover pin
  ignoredIds: number[];                    // cards excluded from this run: never suggested for an owned slot, nor for the friend's slot unless borrowIgnored
  borrowIgnored: boolean;                  // ignored cards may still be borrowed
  parentSparks: ParentSparks[];            // [parent 1, parent 2], the blue spark each of the side's three umas carries
}

/** The worst-case target cost lives with the purchase estimate; panels and tests still reach it from here. */
export { targetSpCost, type SpCost } from './skill-purchases.ts';
/** Scenario stat caps after the blue sparks' start-of-run uncaps, and whether the prediction hit them. */
export interface StatCaps { cap: number[]; uncap: number[]; capped: boolean[] }

export interface RunPlan {
  search: GoalSearchSummary | null;
  goalEstimate: GoalEstimate;
  issues: string[];                        // correct these before using run predictions
  trainee: Character | null;
  apt: Aptitudes;
  schedule: ScheduledRace[];
  sum: ReturnType<typeof scheduleSummary>;
  fans: FanEstimate;
  ctx: Ctx;
  targets: Target[];
  pool: { card: Card; lb: number }[];      // every card in the ranking, at its effective LB
  unowned: Set<number>;                    // card ids marked not owned
  pinnedIds: number[];                     // pins that exist in the data
  ownedPinIds: number[];                   // the pins that are in the inventory
  ignoredIds: number[];                    // ignored cards that exist in the data
  existing: Existing;                      // what the trainee and lineage already cover
  ranking: CardScore[];
  deckResult: DeckResult;
  pred: Prediction;
  parentGains: number[][];                 // [parent 1, parent 2], five stats each: the "+XX" the legacy screen shows, from the sparks
  inherited: Inheritance[];                // per stat, from both parents' blue sparks
  rawFinalMean: number[];                  // full raw totals including inheritance, before above-1200 conversion and caps
  rawFinalSd: number[];
  finalSd: number[];
  statChances: { mid: number; high: number }[];
  purchases: Purchases;
  skillRating: SkillRating;
  finalMean: number[];                     // expected displayed stats after conversion and caps
  statCaps: StatCaps | null;
  rank: RankEstimate;
  spCost: SpCost;
  wl: WishlistEntry[];                     // the prioritized list as shown: the goal's targets in its order, then the extras as the user arranged them
  wlRest: WishlistEntry[];                 // candidates past the list's length that would steer something if listed
  wlHidden: WishlistEntry[];               // extras the user hid
  wlLayout: WishlistLayout;                // which entry takes which shared event, and the candidates hidden behind them
}

export interface GoalSearchSummary {
  score: GoalScore;
  evaluated: number;
  screened: number;
  exhaustive: boolean;
  unavailableWhiteIds: number[];
}
export type DeckSelection = { id: number; lb: number; borrowed?: boolean }[];
export interface RunOptions {
  search?: boolean;
  selection?: DeckSelection;
  previous?: DeckSelection;              // retain a legal displayed deck only when search is disabled
  onProgress?: (selection: DeckSelection, summary: GoalSearchSummary) => void;
  summary?: GoalSearchSummary;
  budget?: number;
}

const popularityCache = new WeakMap<Data, Map<number, number>>();
/** How many Global umas can comfortably run each race, memoized per data set. */
export function racePopularityMap(data: Data): Map<number, number> {
  let m = popularityCache.get(data);
  if (!m) { m = new Map(data.races.map((r) => [r.raceId, racePopularity(r, data.characters)])); popularityCache.set(data, m); }
  return m;
}

/** Effective limit break for a card, or null when marked not owned. Absent from the inventory = owned at the rarity's default. */
export function effectiveLb(inv: Inventory, card: Pick<Card, 'id' | 'rarity'>, defaults: { R: number; SR: number; SSR: number }): number | null {
  const v = inv[String(card.id)];
  if (v === null) return null;
  if (typeof v === 'number') return v;
  return defaults[card.rarity];
}

/** The card pool from the inventory: owned cards at their LB, plus unowned ones at the default LB for display. */
function cardPool(data: Data, inventory: Inventory, settings: Settings) {
  const pool: { card: Card; lb: number }[] = [];
  const unowned = new Set<number>();
  for (const card of data.cards) {
    const lb = effectiveLb(inventory, card, settings.defaultLb);
    if (lb != null) pool.push({ card, lb });
    else { unowned.add(card.id); pool.push({ card, lb: settings.defaultLb[card.rarity] }); }
  }
  return { pool, unowned };
}

/**
 * The list the tool builds from the goal: required targets in the goal's order, preferred targets by their goal
 * priority (then the goal's order), then extras by weight. Within a target the candidates keep their order, the
 * gold form first. This order, not anything the user arranges, is what the deck search evaluates.
 */
export function deriveOrder(cands: WishlistEntry[], goal: ResolvedGoal): WishlistEntry[] {
  const requiredAt = new Map(goal.required.map((r, i) => [r.id, i]));
  const preferredAt = new Map(goal.preferred.map((p, i) => [p.id, i]));
  const preferredPriority = new Map(goal.preferred.map((p) => [p.id, p.priority]));
  const key = (w: WishlistEntry): [number, number, number] => w.role === 'required' ? [0, requiredAt.get(w.targetId!) ?? 0, 0]
    : w.role === 'preferred' ? [1, preferredPriority.get(w.targetId!) ?? 0, preferredAt.get(w.targetId!) ?? 0] : [2, -w.weight, 0];
  return cands.map((w, i) => ({ w, i, k: key(w) })).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || (a.w.role === 'extra' ? a.w.key - b.w.key : a.i - b.i)).map((x) => x.w);
}

/**
 * The user's arrangement of the extras, for display and for the estimate of the deck shown: hidden extras leave,
 * placed ones come first in that order, the rest keep their weight order. Targets keep the goal's order.
 */
export function applyExtrasOrder(ordered: WishlistEntry[], order: number[], hidden: number[]): WishlistEntry[] {
  const at = (w: WishlistEntry) => { const i = order.indexOf(w.key); return i < 0 ? Infinity : i; };
  const extras = ordered.filter((w) => w.role === 'extra' && !hidden.includes(w.key)).map((w, i) => ({ w, i })).sort((a, b) => at(a.w) - at(b.w) || a.i - b.i).map((x) => x.w);
  return [...ordered.filter((w) => w.role !== 'extra'), ...extras];
}

/** Required targets that share a choice event with another required target, whose relative order the joint chance decides. */
export function contestedRequired(ordered: WishlistEntry[]): number[] {
  const byEvent = new Map<string, Set<number>>();
  for (const w of ordered) if (w.role === 'required') for (const e of w.events) byEvent.set(e.key, new Set([...(byEvent.get(e.key) ?? []), w.targetId!]));
  const out = new Set<number>();
  for (const ids of byEvent.values()) if (ids.size > 1) for (const id of ids) out.add(id);
  return [...out];
}
/** Up to this many contested required targets, every order of them is tried; beyond it the goal's order stands. */
export const CONTESTED_REQUIRED_MAX = 3;
export function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]));
}
/**
 * The order with the named required targets rearranged into that order. They take the places those targets held, so
 * every other entry, including an uncontested required target listed above them, stays where the goal put it.
 */
export function withRequiredOrder(ordered: WishlistEntry[], first: number[]): WishlistEntry[] {
  const named = (w: WishlistEntry) => w.role === 'required' && first.includes(w.targetId!);
  const groups = new Map<number, WishlistEntry[]>();
  for (const w of ordered) if (named(w)) groups.set(w.targetId!, [...(groups.get(w.targetId!) ?? []), w]);
  const queue = first.filter((id) => groups.has(id));
  const out: WishlistEntry[] = [];
  const placed = new Set<number>();
  for (const w of ordered) {
    if (!named(w)) { out.push(w); continue; }
    if (placed.has(w.targetId!)) continue;
    placed.add(w.targetId!);
    out.push(...groups.get(queue.shift()!)!);
  }
  return out;
}

/** The cards search may choose: owned cards at their LB, any card at the borrowed LB, and the pins among them. Ignored cards
 * are out of the owned pool, and out of the borrow pool unless the run allows borrowing them. */
function selectablePools(input: RunInput, settings: Settings, inventory: Inventory, data: Data) {
  const { pool, unowned } = cardPool(data, inventory, settings);
  const ignoredIds = input.ignoredIds.filter((id) => data.cardById.has(id));
  const ignored = new Set(ignoredIds);
  const deckPool = pool.filter((p) => !unowned.has(p.card.id) && !ignored.has(p.card.id));
  // Any Global card can be borrowed from a friend, assumed at the borrowed limit break.
  const borrowPool = data.cards.filter((card) => input.borrowIgnored || !ignored.has(card.id)).map((card) => ({ card, lb: BORROWED_LB }));
  const pinnedIds = input.pinnedIds.filter((id) => data.cardById.has(id) && !ignored.has(id));
  return { pool, unowned, ignoredIds, deckPool, borrowPool, pinnedIds };
}

/** Validate restored results with the same ownership, borrow, pin and ignore rules used by search. */
export function isLegalRunSelection(selection: DeckSelection, input: RunInput, settings: Settings, inventory: Inventory, data: Data): boolean {
  if (!input.traineeCardId || !input.goal.blueStats.length) return false;
  const trainee = data.charByCardId.get(input.traineeCardId);
  if (!trainee || selection.some((e) => !data.cardById.has(e.id))) return false;
  const { deckPool, borrowPool, pinnedIds } = selectablePools(input, settings, inventory, data);
  const constraints = goalDeckConstraints({ owned: deckPool, borrows: borrowPool, pinnedIds, borrowFromAll: input.borrowFromAll, traineeId: trainee.charId });
  return !!constraints?.legal(selection.map((e) => ({ ...e, card: data.cardById.get(e.id)! })));
}

/** An event that more than one candidate is offered by. The run takes one option, so the candidate ranked first takes it. */
export interface WishlistEvent { key: string; label: string; winner: number; keys: number[] }
export interface WishlistLayout {
  /** Every candidate after the user's order and exclusions, by key. */
  entries: Map<number, WishlistEntry>;
  /** Candidates that steer an event no higher entry took, or are targets; the first PRIORITIZED_SKILLS_MAX are the list. */
  live: WishlistEntry[];
  /** Non-target candidates whose every event a listed entry took: listing them steers nothing. `by` are the entries that took them. */
  shadowed: { entry: WishlistEntry; by: number[] }[];
  /** For each listed entry, the events it takes; a listed target with none is only a filler for its hints. */
  steers: Map<number, string[]>;
  /** Events shared by several candidates, with the entry that takes each. */
  events: WishlistEvent[];
}

/**
 * Walk the ordered candidates: an entry takes every event no entry above it took. Only the first `max` live entries
 * take events, since only they are entered in the game. A non-target whose events are all taken is hidden behind the
 * entries that took them instead of holding a slot; a target in that position stays, tagged as a filler.
 */
export function layoutWishlist(ordered: WishlistEntry[], max = PRIORITIZED_SKILLS_MAX): WishlistLayout {
  const winner = new Map<string, WishlistEvent>();
  const live: WishlistEntry[] = [], shadowed: WishlistLayout['shadowed'] = [];
  const steers = new Map<number, string[]>();
  for (const w of ordered) {
    const free = w.events.filter((e) => !winner.has(e.key));
    if (w.events.length && !free.length && !w.isTarget) { shadowed.push({ entry: w, by: [...new Set(w.events.map((e) => winner.get(e.key)!.winner))] }); continue; }
    if (live.length < max) {
      for (const e of free) winner.set(e.key, { key: e.key, label: e.label, winner: w.key, keys: [] });
      steers.set(w.key, free.map((e) => e.key));
    }
    live.push(w);
  }
  for (const w of ordered) for (const e of w.events) winner.get(e.key)?.keys.push(w.key);
  return { entries: new Map(ordered.map((w) => [w.key, w])), live, shadowed, steers, events: [...winner.values()].filter((e) => e.keys.length > 1) };
}

/**
 * The priority list an event's single choice is resolved by: skill ids in prioritized-skill order, with every
 * form of a family ranked together at the family's first appearance, so a gold/normal flip keeps the same rank.
 * Only the entries the game can take (the first ten) are in it: a target absent from them steers no choice.
 */
export function derivePriority(ordered: WishlistEntry[], targets: Target[], data: Data): number[] {
  const priority: number[] = [];
  const pushFamily = (ids: Iterable<number>) => { for (const id of ids) if (!priority.includes(id)) priority.push(id); };
  for (const w of ordered.slice(0, PRIORITIZED_SKILLS_MAX)) {
    const target = targets.find((t) => t.familyIds.has(w.skillId));
    if (target) { pushFamily(target.familyIds); continue; }
    const fam = resolveTarget(w.skillId, data);
    pushFamily(fam ? fam.familyIds : [w.skillId]);
  }
  return priority;
}

export type DeckPrediction = Pick<RunPlan, 'pred' | 'parentGains' | 'inherited' | 'rawFinalMean' | 'rawFinalSd' | 'finalMean' | 'finalSd' | 'statChances' | 'purchases' | 'skillRating' | 'statCaps' | 'rank'>;

function preparePrediction(input: RunInput, ctx: Ctx) {
  const parentGains = input.parentSparks.map(gainsOfParentSparks);
  const inherited = STATS.map((_, i) => inheritedFromParents(parentGains, i, ctx.settings));
  const goal = goalWithTargets(input.goal, input.targets.filter((t) => goalFamily(t.id, ctx.data) === t.id));
  return { parentGains, inherited, goalTargets: [...goal.required, ...goal.preferred].map((t) => resolveTarget(t.id, ctx.data)).filter((t): t is Target => !!t) };
}

const canonicalDeck = <T extends { card: Card; lb: number }>(deck: T[]): T[] => deck.slice().sort((a, b) => a.card.id - b.card.id || a.lb - b.lb);

/** The stat and SP prediction of a deck. It does not depend on the prioritized list, so one serves every list order tried. */
function predictCandidateStats(deck: { card: Card; lb: number }[], ctx: Ctx, expectedLosses: number) {
  return predictDeck(deck, ctx.trainee, ctx.races, ctx.settings.focus, expectedLosses, ctx.data.model, ctx.settings, ctx.fansBefore ?? (() => 0));
}

function predictCandidate(deck: { card: Card; lb: number }[], input: RunInput, ctx: Ctx, apt: Aptitudes, pred: Prediction, prepared: ReturnType<typeof preparePrediction>) {
  const { settings, trainee } = ctx;
  const fansBefore = ctx.fansBefore ?? (() => 0);
  const stars = clampStars(trainee, input.traineeStars);
  const { parentGains, inherited, goalTargets } = prepared;
  const rawFinalMean = pred.finalMean.map((v, i) => v + inherited[i]!.total);
  const caps = SCENARIO_STAT_CAPS[settings.scenarioId];
  const statCaps: StatCaps | null = caps ? { cap: caps.map((c, i) => c + inherited[i]!.uncap), uncap: inherited.map((x) => x.uncap), capped: rawFinalMean.map((v, i) => displayedStat(v) > caps[i]! + inherited[i]!.uncap) } : null;
  const rawFinalSd = pred.sd.map((sd, i) => Math.sqrt(sd ** 2 + inherited[i]!.variance));
  const purchases = estimatePurchases(deck, goalTargets, ctx);
  const skillRating = estimateSkillRating(deck, ctx, pred.sp, apt);
  // the fan thresholds are keyed to the character (her own aptitude table), not to the aptitudes after inheritance
  const uniqueLevel = trainee ? uniqueSkillLevel(stars, trainee.aptitudes, fansBefore, settings) : 0;
  const skillPoints = skillPointsOf(skillRating.score, trainee, stars, uniqueLevel);
  return { pred, parentGains, inherited, rawFinalMean, rawFinalSd, purchases, skillRating, statCaps, uniqueLevel, skillPoints };
}

/** Display summaries are only needed after selecting a deck. */
function finishPrediction(prediction: ReturnType<typeof predictCandidate>, input: RunInput, ctx: Ctx): DeckPrediction {
  const { uniqueLevel, skillPoints: _skillPoints, ...base } = prediction;
  const { rawFinalMean, rawFinalSd, statCaps, skillRating } = base;
  const { data, settings, trainee } = ctx;
  const masses = rawFinalMean.map((mean, i) => statMasses(mean, rawFinalSd[i]!, statCaps?.cap[i], true));
  const moments = masses.map(statMoments);
  const finalMean = moments.map((m) => m.mean), finalSd = moments.map((m) => m.sd);
  const statChances = moments.map((m) => ({ mid: Math.min(1, m.above(600)), high: Math.min(1, m.above(1100)) }));
  const rank = rankEstimate(finalMean, finalSd, skillRating.score, trainee, clampStars(trainee, input.traineeStars), uniqueLevel, data, settings, 0, masses);
  return { ...base, finalMean, finalSd, statChances, rank };
}

/** Predict a supplied deck without selecting cards. */
export function predictRunDeck(deck: { card: Card; lb: number }[], input: RunInput, ctx: Ctx, apt: Aptitudes, expectedLosses: number, prepared = preparePrediction(input, ctx)): DeckPrediction {
  const canonical = canonicalDeck(deck);
  return finishPrediction(predictCandidate(canonical, input, ctx, apt, predictCandidateStats(canonical, ctx, expectedLosses), prepared), input, ctx);
}

/** Plan the whole run: schedule, deck, prediction, rank estimate and prioritized skills. Pure; the app memoizes it. */
export function planRun(input: RunInput, settings: Settings, inventory: Inventory, data: Data, options: RunOptions = {}): RunPlan {
  const traineeCard = input.traineeCardId != null ? data.charByCardId.get(input.traineeCardId) ?? null : null;
  const stars = clampStars(traineeCard, input.traineeStars);
  const trainee = traineeCard ? traineeAt(traineeCard, stars) : null;
  const apt = trainee ? startingAptitudes(trainee.aptitudes, input.aptOverrides, input.pinkLineage) : traineeAptitudes(trainee, input.aptOverrides);
  const schedule = buildSchedule(data.races, apt, settings.winThreshold, new Map(Object.entries(input.raceOverrides)), racePopularityMap(data), goalRaces(traineeCard));
  const sum = scheduleSummary(schedule);
  const turns = totalTurns(data.model, settings);
  const activeTargets = input.targets.filter((t) => goalFamily(t.id, data) === t.id);
  const targets = activeTargets.map(({ id }) => resolveTarget(id, data)).filter((t): t is Target => !!t);
  const lineage = new Map<number, Lineage>();
  for (const t of targets) { const l = input.targetLineage[String(t.id)]; if (l && lineageCount(l) > 0) lineage.set(t.id, l); }
  const baseFans = estimateFans(schedule, [], settings);
  const fansBefore = (slot: number) => fansBeforeSlot(baseFans, slot);
  const baseCtx: Ctx = { data, settings, races: sum.count + (SCENARIO_FINALE_FANS[settings.scenarioId]?.length ?? 0), totalTurns: turns, trainee, raceWins: raceWinChances(schedule), lineage, priority: null, fansBefore };
  baseCtx.sources = prepareRunSources(baseCtx);
  const preparedPrediction = preparePrediction(input, baseCtx);
  const { pool, unowned, ignoredIds, deckPool, borrowPool, pinnedIds } = selectablePools(input, settings, inventory, data);
  const ownedPinIds = pinnedIds.filter((id) => deckPool.some((p) => p.card.id === id));
  const build = { pinnedIds, borrowPool, borrowFromAll: input.borrowFromAll, size: DECK_SIZE };
  const goal = goalWithTargets(input.goal, activeTargets);
  const required = new Set(goal.required.map((r) => r.id));
  /**
   * The list for a deck and the families it resolves choices with. The search sees the derived order; the deck shown
   * is evaluated with the user's extras (`display`), so the estimate matches what they will type. When required
   * targets share events, every order of them is tried and the one with the best joint required chance stands.
   */
  const listsFor = (entries: GoalDeckEntry[], ctx: Ctx, display: boolean) => {
    const candidates = wishlistCandidates(entries, targets, ctx, required);
    const derived = deriveOrder(candidates, goal);
    const contested = contestedRequired(derived);
    const orders = contested.length >= 2 && contested.length <= CONTESTED_REQUIRED_MAX ? permutations(contested).map((p) => withRequiredOrder(derived, p)) : [derived];
    return orders.map((base) => {
      const ordered = display ? applyExtrasOrder(base, input.wishlistOrder, input.wishlistExcluded) : base;
      const layout = layoutWishlist(ordered);
      return { candidates, layout, priority: derivePriority(layout.live, targets, data) };
    });
  };
  const pink = pinkGoalsEstimate(apt, goal.pink, input.pinkLineage, settings.affinity, settings.pinkInspirationRates);
  const previous = options.previous?.flatMap((e) => {
    const card = data.cardById.get(e.id);
    if (!card) return [];
    const lb = e.borrowed ? BORROWED_LB : effectiveLb(inventory, card, settings.defaultLb);
    return lb === null ? [] : [{ card, lb, borrowed: e.borrowed }];
  });
  const retained = options.search === false && trainee && goal.blueStats.length > 0 && previous && goalDeckConstraints({ owned: deckPool, borrows: borrowPool,
    pinnedIds, borrowFromAll: input.borrowFromAll, traineeId: trainee?.charId ?? null })?.legal(previous) ? previous : undefined;
  const initial = options.selection ? describeDeck(options.selection.map((e) => ({ card: data.cardById.get(e.id)!, lb: e.lb, borrowed: e.borrowed })), targets, baseCtx)
    : retained ? describeDeck(retained, targets, baseCtx) : buildDeck(deckPool, targets, baseCtx, { ...build, swapPasses: 0 });
  const issues: string[] = [];
  const ownedCount = initial.deck.filter((d) => !d.borrowed).length;
  const borrowedCount = initial.deck.filter((d) => d.borrowed).length;
  if (ownedCount !== DECK_SIZE - BORROWED_SLOTS || borrowedCount !== BORROWED_SLOTS) {
    issues.push(`Incomplete deck. Choose ${DECK_SIZE - BORROWED_SLOTS} owned cards from different characters and ${BORROWED_SLOTS} borrowed card. The current deck has ${ownedCount} owned and ${borrowedCount} borrowed.`);
  }
  const evaluateCandidate = (entries: GoalDeckEntry[], sampleCount = 2048, display = false) => {
    const scoringEntries = canonicalDeck(entries);
    const fans = estimateFans(schedule, scoringEntries, settings);
    const candidateCtx: Ctx = { ...baseCtx, fansBefore: (slot) => fansBeforeSlot(fans, slot) };
    // Stats, SP and stat power do not depend on the list; only the skill sources do.
    const pred = predictCandidateStats(scoringEntries, candidateCtx, sum.expectedLosses);
    const statPower = deckStatPower(scoringEntries, candidateCtx);
    const evaluated = listsFor(scoringEntries, candidateCtx, display).map(({ candidates, layout, priority }, i) => {
      const ctx: Ctx = { ...candidateCtx, priority };
      const prediction = predictCandidate(scoringEntries, input, ctx, apt, pred, preparedPrediction);
      const goalStats = { rawMean: prediction.rawFinalMean, sd: prediction.rawFinalSd, caps: prediction.statCaps?.cap, rawUnits: true, skillPoints: prediction.skillPoints, skillSd: settings.skillScoreSd };
      const basis = goalRankBands(goalStats, goal, thresholdFor('SS', data.ranks), settings, sampleCount);
      const forms = projectForms(prediction.purchases.forms, [...goal.required, ...goal.preferred].map((t) => prediction.purchases.targets.findIndex((p) => p.id === t.id)));
      const sources = goalSources(goal, forms, ctx);
      const score = scoreGoal(goal, sources, basis, pink, settings);
      return { key: String(i), score, statPower, value: { entries, ctx, fans, prediction, goalStats, basis, sources, candidates, layout } };
    });
    // Shared outcomes, required star thresholds and fallback subsets use the same scorer as the deck search.
    const { key: _order, ...chosen } = chooseGoal(evaluated, 0);
    return chosen;
  };
  let chosen = evaluateCandidate(initial.deck, 2048, true);
  let search: GoalSearchSummary | null = options.summary ?? null;
  if (options.search !== false && !options.selection && trainee && goal.blueStats.length && !issues.length) {
    const baseRanking = rankCards(deckPool, targets, traineeCoverage(targets, baseCtx), baseCtx);
    const borrowRanking = rankCards(borrowPool, targets, traineeCoverage(targets, baseCtx), baseCtx);
    const orders = (ranking: CardScore[]) => [ranking,
      ranking.slice().sort((a, b) => b.statPower + b.sp - a.statPower - a.sp),
      ...goal.blueStats.map((stat) => ranking.slice().sort((a, b) => b.stats[STATS.indexOf(stat)]! - a.stats[STATS.indexOf(stat)]!)),
      ...goal.required.map((r) => ranking.slice().sort((a, b) => (b.coverage.find((c) => c.target.id === r.id)?.spark ?? 0) - (a.coverage.find((c) => c.target.id === r.id)?.spark ?? 0)))];
    // An optimistic union can prove that no source exists, without mistaking a failed bounded search for proof.
    const optimistic = traineeCoverage(targets, baseCtx);
    for (const card of [...baseRanking, ...borrowRanking]) {
      optimistic.chars.add(card.card.charId);
      for (const [id, sources] of card.mine) optimistic.sources.set(id, [...(optimistic.sources.get(id) ?? []), ...sources]);
    }
    const allSources = evaluateSources(optimistic, targets, baseCtx).full;
    const unavailableWhiteIds = goal.required.filter((r) => !(allSources.get(r.id) ?? []).some((s) => s.pObtain > 0)).map((r) => r.id);
    const summarize = (found: GoalSearchResult<typeof chosen.value>): GoalSearchSummary =>
      ({ score: found.best.score, evaluated: found.evaluated, screened: found.screened, exhaustive: found.exhaustive, unavailableWhiteIds });
    const found = searchGoalDeck({ owned: deckPool, borrows: borrowPool, ownedOrders: orders(baseRanking), borrowOrders: orders(borrowRanking),
      seeds: [initial.deck], pinnedIds, borrowFromAll: input.borrowFromAll, traineeId: trainee.charId,
      tolerance: settings.goalTieTolerance, budget: options.budget, evaluate: evaluateCandidate,
      explore: (entries) => { const { score, statPower } = evaluateCandidate(entries, EXPLORATION_SAMPLES); return { score, statPower }; },
      screen: (entries) => { const { score, statPower } = evaluateCandidate(entries, SEARCH_RANK_SAMPLES); return { score, statPower }; },
      screenBudget: options.budget === undefined ? SCREENED_DECKS : options.budget * 8,
      onProgress: options.onProgress ? (progress) => options.onProgress!(progress.best.entries.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: e.borrowed })), summarize(progress)) : undefined,
    });
    // The deck shown is evaluated once more with the user's extras, so the estimate matches the list they will type.
    if (found) { chosen = evaluateCandidate(found.best.value.entries, 2048, true); search = summarize(found); }
  }
  const { entries, ctx, fans, goalStats, basis, sources, candidates, layout } = chosen.value;
  const prediction = finishPrediction(chosen.value.prediction, input, ctx);
  prediction.rank.pSS = basis.pSS;
  const deckResult = describeDeck(entries, targets, ctx);
  sum.expectedFans = fans.total;
  const existing = traineeCoverage(targets, ctx), ranking = rankCards(pool, targets, existing, ctx);
  const goalEstimate = evaluateParentGoal(goal, input.pinkLineage, apt, deckResult, ctx, goalStats, issues, basis, sources.forms);
  const hidden = candidates.filter((w) => w.role === 'extra' && input.wishlistExcluded.includes(w.key));
  if (search) {
    deckResult.steps = [`Best deck found after fully evaluating ${search.evaluated} legal decks${search.screened ? ` and screening ${search.screened} decks with a cheaper estimate` : ''}${search.exhaustive ? '; every legal deck in this small pool was checked' : '; bounded search does not guarantee the global best'}.`,
      `Required goals come first. Preferred sparks on successful parents can decide within ${(settings.goalTieTolerance * 100).toLocaleString()}% of the best required chance found.`,
      ...pinnedIds.filter((id) => !deckResult.deck.some((e) => e.card.id === id)).map((id) => `${data.cardById.get(id)!.name} was not selected. Pins compete when slots or character restrictions prevent including them together.`)];
  } else deckResult.steps = retained ? ['Kept the displayed cards and updated their estimates for your current inputs.'] : initial.steps;
  const spCost = targetSpCost(targets, deckResult.coverage);
  return {
    search, goalEstimate, issues, trainee, apt, schedule, sum, fans, ctx, targets, pool, unowned, pinnedIds, ownedPinIds, ignoredIds, existing, ranking, deckResult, ...prediction, spCost,
    wl: layout.live.slice(0, PRIORITIZED_SKILLS_MAX), wlRest: layout.live.slice(PRIORITIZED_SKILLS_MAX), wlHidden: hidden, wlLayout: layout,
  };
}

/** Saved choices can outlive the data that describes them. Report them without removing their IDs. */
export function unavailableRunChoices(input: RunInput, data: Data) {
  return {
    trainee: input.traineeCardId !== null && !data.charByCardId.has(input.traineeCardId) ? input.traineeCardId : null,
    cards: input.pinnedIds.filter((id) => !data.cardById.has(id)),
    skills: [...new Set([
      ...input.targets.filter((t) => goalFamily(t.id, data) !== t.id).map((t) => t.id),
      ...Object.keys(input.targetLineage).map(Number).filter((id) => goalFamily(id, data) !== id),
      ...[...input.wishlistOrder, ...input.wishlistExcluded].filter((id) => !data.skillById.has(id)),
    ])],
  };
}
