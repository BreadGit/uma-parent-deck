import { STATS, perStat, type Card, type Character, type Data, type Inventory, type PerStat, type StatValues } from '../types.ts';
import type { InventoryOverrides, Settings } from '../settings.ts';
import { goalFamily, goalWithTargets, type ParentGoal, type PinkSpark, type ResolvedGoal, type WhiteTarget } from './goal-input.ts';
import { startingAptitudes } from './pink-inherit.ts';
import { evaluateParentGoal, FINAL_GOAL_SAMPLES, goalRankBands, pinkGoalsEstimate, type GoalEstimate, type GoalStats } from './goal.ts';
import { buildDeck, deckStatPower, describeDeck, evaluate as evaluateSources, rankCards, traineeCoverage, wishlistCandidates, type CardScore, type Ctx, type DeckResult, type Existing, type WishlistEntry } from './deck.ts';
import { chooseGoal, goalSources, scoreGoal, type GoalScore } from './goal-objective.ts';
import { EXPLORE_SAMPLES, SCREENED_DECKS, SCREEN_SAMPLES } from './goal-population.ts';
import { goalDeckConstraints, searchGoalDeck, type GoalDeckEntry, type GoalSearchResult } from './goal-deck.ts';
import { chooseOption, defaultOption, lineageCount, resolveTarget, type Lineage, type Offer, type Target } from './sparks.ts';
import { BLUE_STAR_BANDS, predictDeck, totalTurns, type Prediction } from './stats.ts';
import { buildSchedule, goalRaces, racePopularity, raceWinChances, scheduleSummary, traineeAptitudes, type Aptitudes, type ScheduledRace } from './races.ts';
import { estimateFans, fansBeforeSlot, type FanEstimate } from './fans.ts';
import { rankMoments, skillPointsOf, ssThreshold, uniqueSkillLevel, type RankEstimate } from './rank.ts';
import { displayedStat, statMasses, statMoments } from './stat-outcomes.ts';
import { estimatePurchases, estimateSkillRating, type Purchases, type SkillRating, type SpCost } from './skill-purchases.ts';
import { projectForms } from './goal-skills.ts';
import { gainsOfParentSparks, inheritedFromParents, type Inheritance, type ParentSparks } from './inherit.ts';
import { clampStars, traineeAt } from './trainee.ts';
import { BORROWED_LB, BORROWED_SLOTS, DECK_SIZE, PRIORITIZED_SKILLS_MAX, SCENARIO_STAT_CAPS, SCENARIO_FINALE_FANS } from './rules.ts';
import { prepareRunSources } from './run-sources.ts';

/** Everything the user chose about the run. The app persists exactly this (plus UI-only fields). */
export interface RunInput {
  goal: ParentGoal;
  pinkLineage: (PinkSpark | null)[];
  targets: WhiteTarget[];                  // one entry per family
  targetLineage: Record<string, Lineage>;  // by target id
  addedExtras: number[];                   // extras the user added to the prioritized list, in the order added
  traineeCardId: number | null;
  traineeStars: number;
  aptOverrides: Partial<Aptitudes>;
  raceOverrides: Record<string, boolean>;  // calendar id -> forced in (true) or out (false)
  pinnedIds: number[];                     // pinned support cards: owned ones shortlist the owned slots, unowned ones ask for the friend's slot
  borrowFromAll: boolean;                  // with six or more owned pins, borrow the best card overall rather than the best leftover pin
  ignoredIds: number[];                    // never suggested for an owned slot, nor for the friend's slot unless borrowIgnored
  borrowIgnored: boolean;
  parentSparks: ParentSparks[];            // [parent 1, parent 2]
}

/** Scenario stat caps after the blue sparks' start-of-run uncaps, and whether the prediction hit them. */
export interface StatCaps { cap: StatValues; uncap: StatValues; capped: PerStat<boolean> }

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
  unowned: Set<number>;
  pinnedIds: number[];                     // pins that exist in the data
  ownedPinIds: number[];
  ignoredIds: number[];                    // ignored cards that exist in the data
  existing: Existing;                      // what the trainee and lineage already cover
  ranking: CardScore[];
  deckResult: DeckResult;
  pred: Prediction;
  parentGains: StatValues[];               // [parent 1, parent 2]: the "+XX" the legacy screen shows
  inherited: PerStat<Inheritance>;
  rawFinalMean: StatValues;                // full raw totals including inheritance, before above-1200 conversion and caps
  rawFinalSd: StatValues;
  finalSd: StatValues;
  statChances: PerStat<{ mid: number; high: number }>;
  purchases: Purchases;
  skillRating: SkillRating;
  finalMean: StatValues;                   // expected displayed stats after conversion and caps
  statCaps: StatCaps | null;
  rank: RankEstimate;
  spCost: SpCost;
  priorities: PriorityList;
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
  summary?: GoalSearchSummary;
  budget?: number;
}

const popularityCache = new WeakMap<Data, Map<number, number>>();
/** How many Global umas can comfortably run each race. */
export function racePopularityMap(data: Data): Map<number, number> {
  let m = popularityCache.get(data);
  if (!m) { m = new Map(data.races.map((r) => [r.raceId, racePopularity(r, data.characters)])); popularityCache.set(data, m); }
  return m;
}

/** Rarity overrides take precedence over stored ownership. Without an override, absent cards are not owned. */
export function effectiveLb(inv: Inventory, card: Pick<Card, 'id' | 'rarity'>, overrides: InventoryOverrides): number | null {
  return overrides[card.rarity] ?? inv[String(card.id)] ?? null;
}

function cardPool(data: Data, inventory: Inventory, settings: Settings) {
  const pool: { card: Card; lb: number }[] = [];
  const unowned = new Set<number>();
  for (const card of data.cards) {
    const lb = effectiveLb(inventory, card, settings.inventoryOverrides);
    if (lb != null) pool.push({ card, lb });
    else { unowned.add(card.id); pool.push({ card, lb: BORROWED_LB }); }
  }
  return { pool, unowned };
}

/** The deck search evaluates this order, not the user's arrangement. */
export function deriveOrder(cands: WishlistEntry[], goal: ResolvedGoal): WishlistEntry[] {
  const requiredAt = new Map(goal.required.map((r, i) => [r.id, i]));
  const preferredAt = new Map(goal.preferred.map((p, i) => [p.id, i]));
  const preferredPriority = new Map(goal.preferred.map((p) => [p.id, p.priority]));
  const key = (w: WishlistEntry): [number, number, number] => w.role === 'required' ? [0, requiredAt.get(w.targetId!) ?? 0, 0]
    : w.role === 'preferred' ? [1, preferredPriority.get(w.targetId!) ?? 0, preferredAt.get(w.targetId!) ?? 0] : [2, -w.weight, 0];
  return cands.map((w, i) => ({ w, i, k: key(w) })).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || (a.w.role === 'extra' ? a.w.key - b.w.key : a.i - b.i)).map((x) => x.w);
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
/** The named required targets swap among their own places; every other entry stays where the goal put it. */
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

/** Why a target is not in the list: no event choice, its events' default options, an option a higher target takes, or none left. */
export type UnlistedReason = 'hints' | 'first' | 'along' | 'lost';
/**
 * What listing an unlisted extra would do. `add` steers an event no listed skill takes, and also lists the targeted skills
 * in `lists` so they keep their events; `full` would too but the list has no room, `swap` competes with listed extra `with` on another option, `blocked` with target `by`, and `anyway`
 * is a skill the run gets without a listing, beside entry `with` or from an event's default option when `with` is null.
 */
export type ExtraStatus = { kind: 'add' | 'full'; lists: number[] } | { kind: 'swap'; with: number } | { kind: 'blocked'; by: number } | { kind: 'anyway'; with: number | null };
export interface PriorityList {
  entries: Map<number, WishlistEntry>;
  /** What to enter in the game, in order: targets in the goal's order, then the extras the user added. */
  listed: WishlistEntry[];
  /** Targets that need a listing past the game's limit. */
  overflow: WishlistEntry[];
  /** Targets the run does not need listed; `by` is the target holding their event for `along` and `lost`. */
  unlisted: { entry: WishlistEntry; reason: UnlistedReason; by: number | null }[];
  /** Every extra not listed, in candidate order. */
  extras: { entry: WishlistEntry; status: ExtraStatus }[];
  /** For each event a targeted skill or listed extra holds, the entry holding it. */
  holders: Map<string, number>;
}

const optionAt = (w: WishlistEntry, key: string) => w.events.find((e) => e.key === key)!.optionIndex;

/**
 * Proposes the list and checks it with the game's own rule, `chooseOption`, so what the panel says each skill gets is
 * what the estimate credits. Each event is claimed by the first targeted skill in `ordered`'s order that offers it. The
 * list holds the targeted skills whose claim needs a listing: those claiming an option other than the default, then any
 * whose claim a listed skill would take away, until none is left. The extras the user `added` follow in that order while
 * they gain an event and fit in `max`, each listing the targeted skills it would otherwise take an event from. Every
 * status comes from what the run takes with the final list, of which the game reads the first `max` entries. Without
 * `withExtras`, the unlisted extras' statuses are left out, since only the panel shows them.
 */
export function arrangePriorities(ordered: WishlistEntry[], added: readonly number[], max = PRIORITIZED_SKILLS_MAX, withExtras = true): PriorityList {
  const entries = new Map(ordered.map((w) => [w.key, w]));
  const targets = ordered.filter((w) => w.isTarget);
  const events = new Map<string, { defaultIndex: number; offers: (Offer & { entry: WishlistEntry })[] }>();
  for (const w of ordered) for (const e of w.events) {
    const ev = events.get(e.key) ?? { defaultIndex: defaultOption(e), offers: [] };
    ev.offers.push({ skillId: w.skillId, optionIndex: e.optionIndex, entry: w });
    events.set(e.key, ev);
  }
  /** What the run takes at each event when `list` is entered and the game reads its first `limit` skills. */
  const run = (list: WishlistEntry[], limit = max) => {
    const rank = new Map(list.slice(0, limit).map((w, i) => [w.skillId, i] as const));
    const out = new Map<string, { option: number; by: WishlistEntry | null }>();
    for (const [key, ev] of events) {
      const { option, steeredBy } = chooseOption(ev.offers, (id) => rank.get(id) ?? Infinity, ev.defaultIndex);
      out.set(key, { option, by: steeredBy[0]?.entry ?? null });
    }
    return out;
  };
  type Outcome = ReturnType<typeof run>;
  const gets = (w: WishlistEntry, outcome: Outcome) => w.events.filter((e) => outcome.get(e.key)!.option === e.optionIndex);

  const claimer = new Map<string, WishlistEntry>();
  const claims = new Map<WishlistEntry, WishlistEntry['events']>();
  for (const t of targets) {
    const free = t.events.filter((e) => !claimer.has(e.key));
    for (const e of free) claimer.set(e.key, t);
    claims.set(t, free);
  }
  /** The skill whose option an event takes: the listed one that steered it, or the targeted skill claiming its default. */
  const holderAt = (outcome: Outcome, key: string) => {
    const { option, by } = outcome.get(key)!;
    if (by) return by;
    const c = claimer.get(key);
    return c && optionAt(c, key) === option ? c : null;
  };
  const inGoalOrder = (set: ReadonlySet<WishlistEntry>) => targets.filter((t) => set.has(t));
  /** `set` with every targeted skill whose claim the list would take away, until the list keeps every claim it can. */
  const close = (set: ReadonlySet<WishlistEntry>, extras: WishlistEntry[]) => {
    const out = new Set(set);
    for (;;) {
      const outcome = run([...inGoalOrder(out), ...extras]);
      const missing = targets.filter((t) => !out.has(t) && claims.get(t)!.some((e) => outcome.get(e.key)!.option !== e.optionIndex));
      if (!missing.length) return out;
      for (const t of missing) out.add(t);
    }
  };
  let listedTargets = close(new Set(targets.filter((t) => claims.get(t)!.some((e) => e.optionIndex !== defaultOption(e)))), []);
  const extras: WishlistEntry[] = [];
  /** What listing `x` after the current list would do. */
  const statusOf = (x: WishlistEntry): ExtraStatus => {
    const now = run([...inGoalOrder(listedTargets), ...extras]);
    const kept = close(listedTargets, [...extras, x]);
    const withX = run([...inGoalOrder(kept), ...extras, x], Infinity);
    if (gets(x, withX).some((e) => now.get(e.key)!.option !== e.optionIndex)) {
      const lists = inGoalOrder(kept).filter((t) => !listedTargets.has(t));
      return { kind: kept.size + extras.length + 1 <= max ? 'add' : 'full', lists: lists.map((t) => t.key) };
    }
    const held = gets(x, now)[0];
    if (held) return { kind: 'anyway', with: holderAt(now, held.key)?.key ?? null };
    const by = holderAt(withX, x.events[0]!.key)!;
    return by.isTarget ? { kind: 'blocked', by: by.key } : { kind: 'swap', with: by.key };
  };
  for (const key of added) {
    const x = entries.get(key);
    if (!x || x.isTarget || extras.includes(x) || statusOf(x).kind !== 'add') continue;
    listedTargets = close(listedTargets, [...extras, x]);
    extras.push(x);
  }

  const needed = inGoalOrder(listedTargets);
  const listed = [...needed.slice(0, max), ...extras];
  const final = run(listed);
  const unlisted: PriorityList['unlisted'] = [], firsts: PriorityList['unlisted'] = [];
  for (const t of targets) {
    if (listedTargets.has(t)) continue;
    if (!t.events.length) { unlisted.push({ entry: t, reason: 'hints', by: null }); continue; }
    const got = gets(t, final)[0];
    if (!got) { unlisted.push({ entry: t, reason: 'lost', by: holderAt(final, t.events[0]!.key)?.key ?? null }); continue; }
    const holder = holderAt(final, got.key);
    if (holder && holder !== t) unlisted.push({ entry: t, reason: 'along', by: holder.key });
    else firsts.push({ entry: t, reason: 'first', by: null });
  }
  const pool = withExtras ? ordered.filter((w) => !w.isTarget && !extras.includes(w)).map((entry) => ({ entry, status: statusOf(entry) })) : [];
  const holders = new Map<string, number>();
  for (const key of events.keys()) { const h = holderAt(final, key); if (h) holders.set(key, h.key); }
  return { entries, listed, overflow: needed.slice(max), unlisted: [...unlisted, ...firsts], extras: pool, holders };
}

/** Unlisted extras on another option of a listed extra's events, which a swap would list instead. */
export const alternativesTo = (list: PriorityList, key: number) =>
  list.extras.filter((x) => x.status.kind === 'swap' && x.status.with === key).map((x) => x.entry);

/** The listed skills the game takes, in order. A listed skill steers only the options that give it, so its family's other forms are not ranked. */
export function derivePriority(ordered: WishlistEntry[]): number[] {
  return [...new Set(ordered.slice(0, PRIORITIZED_SKILLS_MAX).map((w) => w.skillId))];
}

export type DeckPrediction = Pick<RunPlan, 'pred' | 'parentGains' | 'inherited' | 'rawFinalMean' | 'rawFinalSd' | 'finalMean' | 'finalSd' | 'statChances' | 'purchases' | 'skillRating' | 'statCaps' | 'rank'>;

function preparePrediction(input: RunInput, ctx: Ctx) {
  const parentGains = input.parentSparks.map(gainsOfParentSparks);
  const inherited = perStat((_, i) => inheritedFromParents(parentGains, i, ctx.settings));
  const goal = goalWithTargets(input.goal, input.targets.filter((t) => goalFamily(t.id, ctx.data) === t.id));
  return { parentGains, inherited, goalTargets: [...goal.required, ...goal.preferred].map((t) => resolveTarget(t.id, ctx.data)).filter((t): t is Target => !!t) };
}

const canonicalDeck = <T extends { card: Card; lb: number }>(deck: T[]): T[] => deck.slice().sort((a, b) => a.card.id - b.card.id || a.lb - b.lb);

/** Independent of the prioritized list, so one prediction serves every list order tried. */
function predictCandidateStats(deck: { card: Card; lb: number }[], ctx: Ctx, expectedLosses: number) {
  return predictDeck(deck, ctx.trainee, ctx.races, ctx.settings.focus, expectedLosses, ctx.data.model, ctx.settings, ctx.fansBefore ?? (() => 0));
}

function predictCandidate(deck: { card: Card; lb: number }[], input: RunInput, ctx: Ctx, apt: Aptitudes, pred: Prediction, prepared: ReturnType<typeof preparePrediction>) {
  const { settings, trainee } = ctx;
  const fansBefore = ctx.fansBefore ?? (() => 0);
  const stars = clampStars(trainee, input.traineeStars);
  const { parentGains, inherited, goalTargets } = prepared;
  const rawFinalMean = perStat((_, i) => pred.finalMean[i] + inherited[i].total);
  const caps = SCENARIO_STAT_CAPS[settings.scenarioId];
  const statCaps: StatCaps | null = caps ? { cap: perStat((_, i) => caps[i] + inherited[i].uncap), uncap: perStat((_, i) => inherited[i].uncap),
    capped: perStat((_, i) => displayedStat(rawFinalMean[i]) > caps[i] + inherited[i].uncap) } : null;
  const rawFinalSd = perStat((_, i) => Math.sqrt(pred.sd[i] ** 2 + inherited[i].variance));
  const purchases = estimatePurchases(deck, goalTargets, ctx);
  const skillRating = estimateSkillRating(deck, ctx, pred.sp, apt);
  // Fan thresholds follow the character's own aptitude table, not the aptitudes after inheritance.
  const uniqueLevel = trainee ? uniqueSkillLevel(stars, trainee.aptitudes, fansBefore, settings) : 0;
  const skillPoints = skillPointsOf(skillRating.score, trainee, stars, uniqueLevel);
  return { pred, parentGains, inherited, rawFinalMean, rawFinalSd, purchases, skillRating, statCaps, uniqueLevel, skillPoints };
}

function goalStatsOf(prediction: ReturnType<typeof predictCandidate>, settings: Settings): GoalStats {
  return { rawMean: prediction.rawFinalMean, sd: prediction.rawFinalSd, caps: prediction.statCaps?.cap, rawUnits: true,
    skillPoints: prediction.skillPoints, skillSd: settings.skillScoreSd };
}

/** Display summaries are only needed after selecting a deck. */
function finishPrediction(prediction: ReturnType<typeof predictCandidate>, input: RunInput, ctx: Ctx, pSS: number): DeckPrediction {
  const { uniqueLevel, skillPoints: _skillPoints, ...base } = prediction;
  const { rawFinalMean, rawFinalSd, statCaps, skillRating } = base;
  const { data, settings, trainee } = ctx;
  const masses = perStat((_, i) => statMasses(rawFinalMean[i], rawFinalSd[i], statCaps?.cap[i], true));
  const moments = perStat((_, i) => statMoments(masses[i]));
  const finalMean = perStat((_, i) => moments[i].mean), finalSd = perStat((_, i) => moments[i].sd);
  const statChances = perStat((_, i) => ({ mid: Math.min(1, moments[i].above(BLUE_STAR_BANDS.mid)), high: Math.min(1, moments[i].above(BLUE_STAR_BANDS.high)) }));
  const rank = { ...rankMoments(masses, skillRating.score, trainee, clampStars(trainee, input.traineeStars), uniqueLevel, data, settings), pSS };
  return { ...base, finalMean, finalSd, statChances, rank };
}

export function predictRunDeck(deck: { card: Card; lb: number }[], input: RunInput, ctx: Ctx, apt: Aptitudes, expectedLosses: number, prepared = preparePrediction(input, ctx)): DeckPrediction {
  const canonical = canonicalDeck(deck);
  const prediction = predictCandidate(canonical, input, ctx, apt, predictCandidateStats(canonical, ctx, expectedLosses), prepared);
  const basis = goalRankBands(goalStatsOf(prediction, ctx.settings), input.goal, ssThreshold(ctx.data.ranks), ctx.settings);
  return finishPrediction(prediction, input, ctx, basis.pSS);
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
  const runFields = { data, settings, races: sum.count + (SCENARIO_FINALE_FANS[settings.scenarioId]?.length ?? 0), totalTurns: turns, trainee, raceWins: raceWinChances(schedule), lineage };
  const baseCtx: Ctx = { ...runFields, priority: null, fansBefore, sources: prepareRunSources(runFields) };
  const preparedPrediction = preparePrediction(input, baseCtx);
  const { pool, unowned, ignoredIds, deckPool, borrowPool, pinnedIds } = selectablePools(input, settings, inventory, data);
  const ownedPinIds = pinnedIds.filter((id) => deckPool.some((p) => p.card.id === id));
  const build = { pinnedIds, borrowPool, borrowFromAll: input.borrowFromAll };
  const goal = goalWithTargets(input.goal, activeTargets);
  const required = new Set(goal.required.map((r) => r.id));
  /**
   * The search lists targets only; the deck shown is evaluated with the user's extras too (`display`), so the estimate
   * matches what they will type. Required targets that share events are tried in every order.
   */
  const listsFor = (entries: GoalDeckEntry[], ctx: Ctx, display: boolean) => {
    const candidates = wishlistCandidates(entries, targets, ctx, required);
    const derived = deriveOrder(candidates, goal);
    const contested = contestedRequired(derived);
    const orders = contested.length >= 2 && contested.length <= CONTESTED_REQUIRED_MAX ? permutations(contested).map((p) => withRequiredOrder(derived, p)) : [derived];
    return orders.map((base) => {
      const list = arrangePriorities(base, display ? input.addedExtras : [], PRIORITIZED_SKILLS_MAX, display);
      return { candidates, list, priority: derivePriority(list.listed) };
    });
  };
  const pink = pinkGoalsEstimate(apt, goal.pink, input.pinkLineage, settings.affinity, settings.pinkInspirationRates);
  const previous = options.previous?.flatMap((e) => {
    const card = data.cardById.get(e.id);
    if (!card) return [];
    const lb = e.borrowed ? BORROWED_LB : effectiveLb(inventory, card, settings.inventoryOverrides);
    return lb === null ? [] : [{ card, lb, borrowed: e.borrowed }];
  });
  const deckRules = () => goalDeckConstraints({ owned: deckPool, borrows: borrowPool, pinnedIds, borrowFromAll: input.borrowFromAll,
    traineeId: trainee?.charId ?? null });
  const retained = options.search === false && trainee && goal.blueStats.length > 0 && previous && deckRules()?.legal(previous) ? previous : undefined;
  const complete = (deck: { borrowed?: boolean }[]) => deck.filter((d) => !d.borrowed).length === DECK_SIZE - BORROWED_SLOTS && deck.filter((d) => d.borrowed).length === BORROWED_SLOTS;
  let initial = options.selection ? describeDeck(options.selection.map((e) => ({ card: data.cardById.get(e.id)!, lb: e.lb, borrowed: e.borrowed })), targets, baseCtx)
    : retained ? describeDeck(retained, targets, baseCtx) : buildDeck(deckPool, targets, baseCtx, build);
  if (!options.selection && !retained && !complete(initial.deck)) {
    // The greedy build can miss a legal deck in a small inventory. The search's own rules find one whenever one exists.
    const rules = deckRules();
    const seed = rules?.legalSeeds.find(rules.legal);
    if (seed) initial = { ...describeDeck(seed, targets, baseCtx), steps: ['The greedy build left a slot empty, so this deck is the first legal combination of your cards.'] };
  }
  const issues: string[] = [];
  const ownedCount = initial.deck.filter((d) => !d.borrowed).length;
  const borrowedCount = initial.deck.filter((d) => d.borrowed).length;
  if (!complete(initial.deck)) {
    issues.push(`Incomplete deck. Choose ${DECK_SIZE - BORROWED_SLOTS} owned cards from different characters and ${BORROWED_SLOTS} borrowed card. The current deck has ${ownedCount} owned and ${borrowedCount} borrowed.`);
  }
  const evaluateCandidate = (entries: GoalDeckEntry[], sampleCount = FINAL_GOAL_SAMPLES, display = false) => {
    const scoringEntries = canonicalDeck(entries);
    const fans = estimateFans(schedule, scoringEntries, settings);
    const candidateCtx: Ctx = { ...baseCtx, fansBefore: (slot) => fansBeforeSlot(fans, slot) };
    const pred = predictCandidateStats(scoringEntries, candidateCtx, sum.expectedLosses);
    const statPower = deckStatPower(scoringEntries, candidateCtx);
    const evaluated = listsFor(scoringEntries, candidateCtx, display).map(({ candidates, list, priority }, i) => {
      const ctx: Ctx = { ...candidateCtx, priority };
      const prediction = predictCandidate(scoringEntries, input, ctx, apt, pred, preparedPrediction);
      const goalStats = goalStatsOf(prediction, settings);
      const basis = goalRankBands(goalStats, goal, ssThreshold(data.ranks), settings, sampleCount);
      const forms = projectForms(prediction.purchases.forms, [...goal.required, ...goal.preferred].map((t) => prediction.purchases.targets.findIndex((p) => p.id === t.id)));
      const sources = goalSources(goal, forms, ctx);
      const score = scoreGoal(goal, sources, basis, pink, settings);
      return { key: String(i), score, statPower, value: { entries, ctx, fans, prediction, goalStats, basis, sources, candidates, list } };
    });
    // Shared outcomes, required star thresholds and fallback subsets use the same scorer as the deck search.
    const { key: _order, ...chosen } = chooseGoal(evaluated, 0);
    return chosen;
  };
  let chosen = evaluateCandidate(initial.deck, FINAL_GOAL_SAMPLES, true);
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
      explore: (entries) => { const { score, statPower } = evaluateCandidate(entries, EXPLORE_SAMPLES); return { score, statPower }; },
      screen: (entries) => { const { score, statPower } = evaluateCandidate(entries, SCREEN_SAMPLES); return { score, statPower }; },
      screenBudget: options.budget === undefined ? SCREENED_DECKS : options.budget * 8,
    });
    // Re-evaluate with the user's extras (display).
    if (found) { chosen = evaluateCandidate(found.best.value.entries, FINAL_GOAL_SAMPLES, true); search = summarize(found); }
  }
  const { entries, ctx, fans, goalStats, basis, sources, list } = chosen.value;
  const prediction = finishPrediction(chosen.value.prediction, input, ctx, basis.pSS);
  const deckResult = describeDeck(entries, targets, ctx);
  const existing = traineeCoverage(targets, ctx), ranking = rankCards(pool, targets, existing, ctx);
  const goalEstimate = evaluateParentGoal(goal, input.pinkLineage, apt, deckResult, ctx, goalStats, issues, basis, sources.forms);
  if (search) {
    deckResult.steps = [`Best deck found after fully evaluating ${search.evaluated} legal decks${search.screened ? ` and screening ${search.screened} decks with a cheaper estimate` : ''}${search.exhaustive ? '; every legal deck in this small pool was checked' : '; bounded search does not guarantee the global best'}.`,
      `Required goals come first. Preferred sparks on successful parents can decide within ${(settings.goalTieTolerance * 100).toLocaleString()}% of the best required chance found.`,
      ...pinnedIds.filter((id) => !deckResult.deck.some((e) => e.card.id === id)).map((id) => `${data.cardById.get(id)!.name} was not selected. Pins compete when slots or character restrictions prevent including them together.`)];
  } else deckResult.steps = retained ? ['Kept the displayed cards and updated their estimates for your current inputs.'] : initial.steps;
  return {
    search, goalEstimate, issues, trainee, apt, schedule, sum: { ...sum, expectedFans: fans.total }, fans, ctx, targets, pool, unowned, pinnedIds, ownedPinIds, ignoredIds, existing, ranking, deckResult,
    ...prediction, spCost: prediction.purchases.goalCost,
    priorities: list,
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
      ...input.addedExtras.filter((id) => !data.skillById.has(id)),
    ])],
  };
}
