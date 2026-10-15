import { STATS, perStat, type Card, type Character, type Data, type Inventory, type PerStat, type StatValues } from '../types.ts';
import type { InventoryOverrides, Settings } from '../settings.ts';
import { goalFamily, goalWithTargets, type ParentGoal, type PinkSpark, type ResolvedGoal, type WhiteTarget } from './goal-input.ts';
import { startingAptitudes } from './pink-inherit.ts';
import { evaluateParentGoal, FINAL_GOAL_SAMPLES, goalRankBands, pinkGoalsEstimate, type GoalEstimate, type GoalStats } from './goal.ts';
import { buildDeck, deckStatPower, describeDeck, evaluate as evaluateSources, rankCards, traineeCoverage, wishlistCandidates, type CardScore, type Ctx, type DeckResult, type Existing, type WishlistEntry } from './deck.ts';
import { chooseGoal, goalSources, scoreGoal, type GoalScore } from './goal-objective.ts';
import { EXPLORE_SAMPLES, SCREENED_DECKS, SCREEN_SAMPLES } from './goal-population.ts';
import { goalDeckConstraints, searchGoalDeck, type GoalDeckEntry, type GoalSearchResult } from './goal-deck.ts';
import { lineageCount, resolveTarget, type Lineage, type Target } from './sparks.ts';
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
  wishlistOrder: number[];                 // extras only; targets keep the goal's order
  wishlistExcluded: number[];              // extras the user hid
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
  wl: WishlistEntry[];                     // the prioritized list as shown
  wlRest: WishlistEntry[];                 // candidates past the list's length that would steer something if listed
  wlHidden: WishlistEntry[];               // extras the user hid
  wlLayout: WishlistLayout;
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

/** The user's arrangement of the extras, used for display and for the estimate of the deck shown. */
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

/** An event that more than one candidate is offered by. The run takes one option, so the candidate ranked first takes it. */
export interface WishlistEvent { key: string; label: string; winner: number; keys: number[] }
export interface WishlistLayout {
  entries: Map<number, WishlistEntry>;
  /** Candidates that steer an event no higher entry took, or are targets; the first PRIORITIZED_SKILLS_MAX are the list. */
  live: WishlistEntry[];
  /** Non-target candidates whose every event a listed entry took: listing them steers nothing. `by` are the entries that took them. */
  shadowed: { entry: WishlistEntry; by: number[] }[];
  /** For each listed entry, the events it takes; a listed target with none is only a filler for its hints. */
  steers: Map<number, string[]>;
  events: WishlistEvent[];
}

/**
 * An entry takes every event no entry above it took. Only the first `max` live entries take events, since only they are
 * entered in the game. A non-target whose events are all taken is hidden; a target in that position stays as a filler.
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
 * Every form of a family ranks together at its first appearance, so a gold/normal flip keeps the same rank. Only the
 * entries the game takes are in it, so a target outside them steers no choice.
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
   * The search sees the derived order; the deck shown is evaluated with the user's extras (`display`), so the estimate
   * matches what they will type. Required targets that share events are tried in every order.
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
    const evaluated = listsFor(scoringEntries, candidateCtx, display).map(({ candidates, layout, priority }, i) => {
      const ctx: Ctx = { ...candidateCtx, priority };
      const prediction = predictCandidate(scoringEntries, input, ctx, apt, pred, preparedPrediction);
      const goalStats = goalStatsOf(prediction, settings);
      const basis = goalRankBands(goalStats, goal, ssThreshold(data.ranks), settings, sampleCount);
      const forms = projectForms(prediction.purchases.forms, [...goal.required, ...goal.preferred].map((t) => prediction.purchases.targets.findIndex((p) => p.id === t.id)));
      const sources = goalSources(goal, forms, ctx);
      const score = scoreGoal(goal, sources, basis, pink, settings);
      return { key: String(i), score, statPower, value: { entries, ctx, fans, prediction, goalStats, basis, sources, candidates, layout } };
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
  const { entries, ctx, fans, goalStats, basis, sources, candidates, layout } = chosen.value;
  const prediction = finishPrediction(chosen.value.prediction, input, ctx, basis.pSS);
  const deckResult = describeDeck(entries, targets, ctx);
  const existing = traineeCoverage(targets, ctx), ranking = rankCards(pool, targets, existing, ctx);
  const goalEstimate = evaluateParentGoal(goal, input.pinkLineage, apt, deckResult, ctx, goalStats, issues, basis, sources.forms);
  const hidden = candidates.filter((w) => w.role === 'extra' && input.wishlistExcluded.includes(w.key));
  if (search) {
    deckResult.steps = [`Best deck found after fully evaluating ${search.evaluated} legal decks${search.screened ? ` and screening ${search.screened} decks with a cheaper estimate` : ''}${search.exhaustive ? '; every legal deck in this small pool was checked' : '; bounded search does not guarantee the global best'}.`,
      `Required goals come first. Preferred sparks on successful parents can decide within ${(settings.goalTieTolerance * 100).toLocaleString()}% of the best required chance found.`,
      ...pinnedIds.filter((id) => !deckResult.deck.some((e) => e.card.id === id)).map((id) => `${data.cardById.get(id)!.name} was not selected. Pins compete when slots or character restrictions prevent including them together.`)];
  } else deckResult.steps = retained ? ['Kept the displayed cards and updated their estimates for your current inputs.'] : initial.steps;
  return {
    search, goalEstimate, issues, trainee, apt, schedule, sum: { ...sum, expectedFans: fans.total }, fans, ctx, targets, pool, unowned, pinnedIds, ownedPinIds, ignoredIds, existing, ranking, deckResult,
    ...prediction, spCost: prediction.purchases.goalCost,
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
