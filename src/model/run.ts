import { STATS, type Card, type Character, type Data, type Inventory, type Skill } from '../types.ts';
import type { Settings } from '../settings.ts';
import { goalWithTargets, type ParentGoal, type PinkSpark, type WhiteTarget } from './goal-input.ts';
import { startingAptitudes } from './pink-inherit.ts';
import { evaluateParentGoal, type GoalEstimate } from './goal.ts';
import { buildDeck, rankCards, traineeCoverage, wishlistCandidates, type CardScore, type Ctx, type DeckResult, type Existing, type WishlistEntry } from './deck.ts';
import { combineSources, lineageCount, purchasedOwnership, resolveTarget, type Lineage, type SkillSource, type Target } from './sparks.ts';
import { predictDeck, totalTurns, type Prediction } from './stats.ts';
import { buildSchedule, expectedFansBefore, goalRaces, racePopularity, raceWinChances, scheduleSummary, traineeAptitudes, type Aptitudes, type ScheduledRace } from './races.ts';
import { rankEstimate, uniqueSkillLevel, type RankEstimate } from './rank.ts';
import { gainsOfParentSparks, inheritedFromParents, type Inheritance, type ParentSparks } from './inherit.ts';
import { clampStars, traineeAt } from './trainee.ts';
import { BORROWED_LB, BORROWED_SLOTS, DECK_SIZE, PRIORITIZED_SKILLS_MAX, SCENARIO_STAT_CAPS, SLOT_COUNT } from './rules.ts';

/** Everything the user chose about the run. The app persists exactly this (plus UI-only fields). */
export interface RunInput {
  goal: ParentGoal;
  pinkLineage: (PinkSpark | null)[];
  targets: WhiteTarget[];                  // one entry per family, with its goal role and minimum stars
  targetLineage: Record<string, Lineage>;  // target id -> copies of the spark already in the lineage
  wishlistOrder: number[];                 // prioritized-skill keys the user arranged, in order
  wishlistExcluded: number[];              // prioritized-skill keys the user removed
  traineeCardId: number | null;
  traineeStars: number;                    // picks the base stat table
  aptOverrides: Partial<Aptitudes>;
  raceOverrides: Record<string, boolean>;  // calendar id -> forced in (true) or out (false)
  pinnedIds: number[];                     // pinned support cards: owned ones shortlist the owned slots, unowned ones ask for the friend's slot
  borrowFromAll: boolean;                  // with six or more owned pins, borrow the best card overall rather than the best leftover pin
  parentSparks: ParentSparks[];            // [parent 1, parent 2], the blue spark each of the side's three umas carries
}

/** The full base cost of every selected target family, including prerequisites for its best purchasable form. */
export interface SpCost { total: number; incomplete: boolean; items: { target: Target; skill: Skill | null; cost: number | null; purchases: Skill[] }[] }
/** Scenario stat caps after the blue sparks' start-of-run uncaps, and whether the prediction hit them. */
export interface StatCaps { cap: number[]; uncap: number[]; capped: boolean[] }

export interface RunPlan {
  goalEstimate: GoalEstimate;
  issues: string[];                        // correct these before using run predictions
  trainee: Character | null;
  apt: Aptitudes;
  schedule: ScheduledRace[];
  sum: ReturnType<typeof scheduleSummary>;
  ctx: Ctx;
  targets: Target[];
  pool: { card: Card; lb: number }[];      // every card in the ranking, at its effective LB
  unowned: Set<number>;                    // card ids marked not owned
  pinnedIds: number[];                     // pins that exist in the data
  ownedPinIds: number[];                   // the pins that are in the inventory
  existing: Existing;                      // what the trainee and lineage already cover
  ranking: CardScore[];
  deckResult: DeckResult;
  pred: Prediction;
  parentGains: number[][];                 // [parent 1, parent 2], five stats each: the "+XX" the legacy screen shows, from the sparks
  inherited: Inheritance[];                // per stat, from both parents' blue sparks
  rawFinalMean: number[];                  // predicted final stats including inheritance, before the scenario caps
  finalMean: number[];                     // the same, clamped to the caps
  statCaps: StatCaps | null;
  rank: RankEstimate;
  spCost: SpCost;
  wl: WishlistEntry[];                     // the prioritized list as shown
  wlRest: WishlistEntry[];                 // candidates past the list's length
  wlExcluded: WishlistEntry[];             // candidates the user removed
}

const popularityCache = new WeakMap<Data, Map<number, number>>();
/** How many Global umas can comfortably run each race, memoized per data set. */
export function racePopularityMap(data: Data): Map<number, number> {
  let m = popularityCache.get(data);
  if (!m) { m = new Map(data.races.map((r) => [r.raceId, racePopularity(r, data.characters)])); popularityCache.set(data, m); }
  return m;
}

/** Effective limit break for a card, or null when marked not owned. Absent from the inventory = owned at the rarity's default. */
export function effectiveLb(inv: Inventory, card: Card, defaults: { R: number; SR: number; SSR: number }): number | null {
  const v = inv[String(card.id)];
  if (v === null) return null;
  if (typeof v === 'number') return v;
  return defaults[card.rarity];
}

/** The card pool from the inventory: owned cards at their LB, plus unowned ones at the default LB when they are shown. */
function cardPool(data: Data, inventory: Inventory, settings: Settings) {
  const pool: { card: Card; lb: number }[] = [];
  const unowned = new Set<number>();
  for (const card of data.cards) {
    const lb = effectiveLb(inventory, card, settings.defaultLb);
    if (lb != null) pool.push({ card, lb });
    else { unowned.add(card.id); if (settings.showUnowned) pool.push({ card, lb: settings.defaultLb[card.rarity] }); }
  }
  return { pool, unowned };
}

/**
 * Sort prioritized-skill candidates by the user's order, then by weight. A remembered position applies to the
 * whole skill family (gold, ○ and normal forms), so an entry that flips form when the deck changes keeps its
 * place instead of dropping to the bottom. Excluded keys are removed.
 */
export function applyUserOrder(cands: WishlistEntry[], order: number[], excluded: number[], data: Data): WishlistEntry[] {
  const familyOf = (key: number) => resolveTarget(key, data)?.id ?? key;
  const orderFamilies = order.map(familyOf);
  const index = (w: WishlistEntry) => {
    const exact = order.indexOf(w.key);
    if (exact >= 0) return exact;
    const fam = orderFamilies.indexOf(familyOf(w.key));
    return fam < 0 ? Infinity : fam;
  };
  return cands.filter((w) => !excluded.includes(w.key)).slice().sort((a, b) => index(a) - index(b) || (b.weight - a.weight));
}

/**
 * The priority list an event's single choice is resolved by: skill ids in prioritized-skill order, with every
 * form of a family ranked together at the family's first appearance, so a gold/normal flip keeps the same rank.
 * Only the entries the game can take (the first ten) steer choices; targets absent from them go last, ranked only
 * against each other.
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
  for (const t of targets) pushFamily(t.familyIds);
  return priority;
}

/**
 * Worst-case SP for the best purchasable form of each target, including every prerequisite. Each family is bought
 * once, with no hint discounts or probability weighting. Gold needs a hint; a released ◎ upgrade does not.
 */
export function targetSpCost(targets: Target[], coverage: Map<number, SkillSource[]>): SpCost {
  const items: SpCost['items'] = [];
  let total = 0, incomplete = false;
  for (const t of new Map(targets.map((t) => [t.id, t])).values()) {
    const own = purchasedOwnership(t, combineSources(coverage.get(t.id) ?? []));
    const circle = t.circle && !t.circle.unreleasedEn ? t.circle : null;
    const skill = own.pGold > 1e-9 && t.gold ? t.gold : circle ?? t.white ?? t.gold;
    const purchases = [...new Map([t.white, circle, skill].filter((s): s is Skill => !!s).map((s) => [s.id, s])).values()];
    const cost = !purchases.length || purchases.some((s) => s.cost == null) ? null : purchases.reduce((a, s) => a + s.cost!, 0);
    if (cost == null) incomplete = true; else total += cost;
    items.push({ target: t, skill, cost, purchases });
  }
  return { total, incomplete, items };
}

export type DeckPrediction = Pick<RunPlan, 'pred' | 'parentGains' | 'inherited' | 'rawFinalMean' | 'finalMean' | 'statCaps' | 'rank'>;

/** Predict a supplied deck without selecting cards. */
export function predictRunDeck(deck: { card: Card; lb: number }[], input: RunInput, ctx: Ctx, apt: Aptitudes, expectedLosses: number): DeckPrediction {
  const { data, settings, trainee } = ctx;
  const fansBefore = ctx.fansBefore ?? (() => 0);
  const stars = clampStars(trainee, input.traineeStars);
  const pred = predictDeck(deck, trainee, ctx.races, settings.focus, expectedLosses, data.model, settings, fansBefore);
  const parentGains = input.parentSparks.map(gainsOfParentSparks);
  const inherited = STATS.map((_, i) => inheritedFromParents(parentGains, i, settings));
  const rawFinalMean = pred.finalMean.map((v, i) => v + inherited[i]!.total);
  const caps = SCENARIO_STAT_CAPS[settings.scenarioId];
  const statCaps: StatCaps | null = caps ? { cap: caps.map((c, i) => c + inherited[i]!.uncap), uncap: inherited.map((x) => x.uncap), capped: rawFinalMean.map((v, i) => v > caps[i]! + inherited[i]!.uncap) } : null;
  const finalMean = statCaps ? rawFinalMean.map((v, i) => Math.min(v, statCaps.cap[i]!)) : rawFinalMean;
  // the fan thresholds are keyed to the character (her own aptitude table), not to the aptitudes after inheritance
  const uniqueLevel = trainee ? uniqueSkillLevel(stars, trainee.aptitudes, fansBefore, settings) : 0;
  const rank = rankEstimate(finalMean, pred.sd, pred.sp, trainee, stars, uniqueLevel, trainee ? apt : null, data, settings);
  return { pred, parentGains, inherited, rawFinalMean, finalMean, statCaps, rank };
}

/** Plan the whole run: schedule, deck, prediction, rank estimate and prioritized skills. Pure; the app memoizes it. */
export function planRun(input: RunInput, settings: Settings, inventory: Inventory, data: Data): RunPlan {
  const traineeCard = input.traineeCardId != null ? data.charByCardId.get(input.traineeCardId) ?? null : null;
  const stars = clampStars(traineeCard, input.traineeStars);
  const trainee = traineeCard ? traineeAt(traineeCard, stars) : null;
  const apt = trainee ? startingAptitudes(trainee.aptitudes, input.aptOverrides, input.pinkLineage) : traineeAptitudes(trainee, input.aptOverrides);
  const schedule = buildSchedule(data.races, apt, settings.winThreshold, new Map(Object.entries(input.raceOverrides)), racePopularityMap(data), goalRaces(traineeCard));
  const sum = scheduleSummary(schedule);
  const turns = totalTurns(data.model, settings);
  const targets = input.targets.map(({ id }) => resolveTarget(id, data)).filter((t): t is Target => !!t);
  const lineage = new Map<number, Lineage>();
  for (const t of targets) { const l = input.targetLineage[String(t.id)]; if (l && lineageCount(l) > 0) lineage.set(t.id, l); }
  const fansBySlot = Array.from({ length: SLOT_COUNT + 1 }, (_, s) => expectedFansBefore(schedule, s));
  const fansBefore = (slot: number) => fansBySlot[Math.max(0, Math.min(SLOT_COUNT, slot))] ?? 0;
  const baseCtx: Ctx = { data, settings, races: sum.count, totalTurns: turns, trainee, raceWins: raceWinChances(schedule), lineage, priority: [], fansBefore };
  const { pool, unowned } = cardPool(data, inventory, settings);
  const deckPool = pool.filter((p) => !unowned.has(p.card.id));
  const pinnedIds = input.pinnedIds.filter((id) => data.cardById.has(id));
  const ownedPinIds = pinnedIds.filter((id) => deckPool.some((p) => p.card.id === id));
  // Any Global card can be borrowed from a friend, assumed at the borrowed limit break.
  const borrowPool = data.cards.map((card) => ({ card, lb: BORROWED_LB }));
  const build = { pinnedIds, borrowPool, borrowFromAll: input.borrowFromAll, size: DECK_SIZE };
  const order = (cands: WishlistEntry[]) => applyUserOrder(cands, input.wishlistOrder, input.wishlistExcluded, data);
  // Pass 1: build without conflict rules to get the prioritized-skill order; the first ten entries decide which
  // target an event's single choice goes to. Pass 2 rebuilds with those rules.
  const pass1 = buildDeck(deckPool, targets, baseCtx, build);
  const priority = derivePriority(order(wishlistCandidates(pass1.deck, targets, baseCtx)), targets, data);
  const ctx: Ctx = { ...baseCtx, priority };
  const existing = traineeCoverage(targets, ctx);
  const ranking = rankCards(pool, targets, existing, ctx);
  const deckResult = buildDeck(deckPool, targets, ctx, build);
  const issues: string[] = [];
  const ownedCount = deckResult.deck.filter((d) => !d.borrowed).length;
  const borrowedCount = deckResult.deck.filter((d) => d.borrowed).length;
  if (ownedCount !== DECK_SIZE - BORROWED_SLOTS || borrowedCount !== BORROWED_SLOTS) {
    issues.push(`Incomplete deck. Choose ${DECK_SIZE - BORROWED_SLOTS} owned cards from different characters and ${BORROWED_SLOTS} borrowed card. The current deck has ${ownedCount} owned and ${borrowedCount} borrowed.`);
  }
  const prediction = predictRunDeck(deckResult.deck, input, ctx, apt, sum.expectedLosses);
  const { pred, parentGains, inherited, rawFinalMean, finalMean, statCaps, rank } = prediction;
  const goalEstimate = evaluateParentGoal(goalWithTargets(input.goal, input.targets), input.pinkLineage, apt, deckResult, ctx, {
    rawMean: rawFinalMean, sd: pred.sd, caps: statCaps?.cap, skillPoints: rank.skillPts, skillSd: settings.skillScoreSd,
  }, issues);
  const spCost = targetSpCost(targets, deckResult.coverage);
  const candidates = wishlistCandidates(deckResult.deck, targets, ctx);
  const ordered = order(candidates);
  return {
    goalEstimate, issues, trainee, apt, schedule, sum, ctx, targets, pool, unowned, pinnedIds, ownedPinIds, existing, ranking, deckResult, pred, parentGains, inherited, rawFinalMean, finalMean, statCaps, rank, spCost,
    wl: ordered.slice(0, PRIORITIZED_SKILLS_MAX),
    wlRest: ordered.slice(PRIORITIZED_SKILLS_MAX),
    wlExcluded: candidates.filter((w) => input.wishlistExcluded.includes(w.key)),
  };
}
