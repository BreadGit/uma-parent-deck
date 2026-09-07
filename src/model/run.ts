import { STATS, type Card, type Character, type Data, type Inventory, type Skill } from '../types.ts';
import type { Settings } from '../settings.ts';
import { buildDeck, rankCards, traineeCoverage, wishlistCandidates, type CardScore, type Ctx, type DeckResult, type Existing, type WishlistEntry } from './deck.ts';
import { combineSources, lineageCount, resolveTarget, type Lineage, type SkillSource, type Target } from './sparks.ts';
import { predictDeck, totalTurns, type Prediction } from './stats.ts';
import { buildSchedule, expectedFansBefore, goalRaces, racePopularity, raceWinChances, scheduleSummary, traineeAptitudes, type Aptitudes, type ScheduledRace } from './races.ts';
import { rankEstimate, uniqueSkillLevel, type RankEstimate } from './rank.ts';
import { inheritedFromParents, type Inheritance } from './inherit.ts';
import { traineeAt } from './trainee.ts';
import { BORROWED_LB, DECK_SIZE, PRIORITIZED_SKILLS_MAX, SCENARIO_STAT_CAPS } from './rules.ts';

/** Everything the user chose about the run. The app persists exactly this (plus UI-only fields). */
export interface RunInput {
  targets: number[];                       // target family ids (the white form's skill id)
  targetLineage: Record<string, Lineage>;  // target id -> copies of the spark already in the lineage
  wishlistOrder: number[];                 // prioritized-skill keys the user arranged, in order
  wishlistExcluded: number[];              // prioritized-skill keys the user removed
  traineeCardId: number | null;
  traineeStars: number;                    // picks the base stat table
  aptOverrides: Partial<Aptitudes>;
  raceOverrides: Record<string, boolean>;  // calendar id -> forced in (true) or out (false)
  pinnedIds: number[];                     // pinned support cards: owned ones shortlist the owned slots, unowned ones ask for the friend's slot
  borrowFromAll: boolean;                  // with six or more owned pins, borrow the best card overall rather than the best leftover pin
  parentGains: number[][];                 // [parent 1, parent 2], five stats each: the start gain the legacy screen shows
}

/** The base cost of every selected target, each bought once in the dearest form the run can hand over. */
export interface SpCost { total: number; incomplete: boolean; items: { target: Target; skill: Skill | null; cost: number | null }[] }
/** Scenario stat caps after the blue sparks' start-of-run uncaps, and whether the prediction hit them. */
export interface StatCaps { cap: number[]; uncap: number[]; capped: boolean[] }

export interface RunPlan {
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
 * Worst-case SP to buy every target once: the gold form's base cost when the run can hand over the gold, the
 * target's own base cost otherwise, the higher of the two when both are possible. No prerequisite costs, hint
 * discounts or probability weighting: an undiscounted upper bound to compare with the predicted SP.
 */
export function targetSpCost(targets: Target[], coverage: Map<number, SkillSource[]>): SpCost {
  const items: SpCost['items'] = [];
  let total = 0, incomplete = false;
  for (const t of targets) {
    const own = combineSources(coverage.get(t.id) ?? []);
    const forms: Skill[] = [];
    if (own.pGold > 1e-9 && t.gold) forms.push(t.gold);
    if (own.pGold < 1 - 1e-9 || !forms.length) { const w = t.white ?? t.circle ?? t.gold; if (w) forms.push(w); }
    const dearest = forms.sort((a, b) => (b.cost ?? Infinity) - (a.cost ?? Infinity))[0] ?? null;
    const cost = dearest?.cost ?? null;
    if (cost == null) incomplete = true; else total += cost;
    items.push({ target: t, skill: dearest, cost });
  }
  return { total, incomplete, items };
}

/** Plan the whole run: schedule, deck, prediction, rank estimate and prioritized skills. Pure; the app memoizes it. */
export function planRun(input: RunInput, settings: Settings, inventory: Inventory, data: Data): RunPlan {
  const traineeCard = input.traineeCardId != null ? data.charByCardId.get(input.traineeCardId) ?? null : null;
  const trainee = traineeCard ? traineeAt(traineeCard, input.traineeStars) : null;
  const apt = traineeAptitudes(trainee, input.aptOverrides);
  const schedule = buildSchedule(data.races, apt, settings.winThreshold, new Map(Object.entries(input.raceOverrides)), racePopularityMap(data), goalRaces(traineeCard));
  const sum = scheduleSummary(schedule);
  const turns = totalTurns(data.model, settings);
  const targets = input.targets.map((id) => resolveTarget(id, data)).filter((t): t is Target => !!t);
  const lineage = new Map<number, Lineage>();
  for (const t of targets) { const l = input.targetLineage[String(t.id)]; if (l && lineageCount(l) > 0) lineage.set(t.id, l); }
  const baseCtx: Ctx = { data, settings, races: sum.count, totalTurns: turns, trainee, raceWins: raceWinChances(schedule), lineage, priority: [] };
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
  const pred = predictDeck(deckResult.deck.map((d) => ({ card: d.card, lb: d.lb })), trainee, sum.count, settings.focus, sum.expectedLosses, data.model, settings);
  const inherited = STATS.map((_, i) => inheritedFromParents(input.parentGains, i, settings));
  const rawFinalMean = pred.finalMean.map((v, i) => v + inherited[i]!.total);
  const caps = SCENARIO_STAT_CAPS[settings.scenarioId];
  const statCaps: StatCaps | null = caps ? { cap: caps.map((c, i) => c + inherited[i]!.uncap), uncap: inherited.map((x) => x.uncap), capped: rawFinalMean.map((v, i) => v > caps[i]! + inherited[i]!.uncap) } : null;
  const finalMean = statCaps ? rawFinalMean.map((v, i) => Math.min(v, statCaps.cap[i]!)) : rawFinalMean;
  const uniqueLevel = trainee ? uniqueSkillLevel(input.traineeStars, apt, (slot) => expectedFansBefore(schedule, slot), settings) : 0;
  const rank = rankEstimate(finalMean, pred.sd, pred.sp, trainee, input.traineeStars, uniqueLevel, trainee ? apt : null, data, settings);
  const spCost = targetSpCost(targets, deckResult.coverage);
  const candidates = wishlistCandidates(deckResult.deck, targets, ctx);
  const ordered = order(candidates);
  return {
    trainee, apt, schedule, sum, ctx, targets, pool, unowned, pinnedIds, ownedPinIds, existing, ranking, deckResult, pred, inherited, rawFinalMean, finalMean, statCaps, rank, spCost,
    wl: ordered.slice(0, PRIORITIZED_SKILLS_MAX),
    wlRest: ordered.slice(PRIORITIZED_SKILLS_MAX),
    wlExcluded: candidates.filter((w) => input.wishlistExcluded.includes(w.key)),
  };
}
