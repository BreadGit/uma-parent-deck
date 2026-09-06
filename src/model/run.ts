import { STATS, type Card, type Character, type Data, type Inventory } from '../types.ts';
import type { Settings } from '../settings.ts';
import { buildDeck, rankCards, traineeCoverage, wishlistCandidates, type CardScore, type Ctx, type DeckResult, type Existing, type WishlistEntry } from './deck.ts';
import { lineageCount, resolveTarget, type Lineage, type Target } from './sparks.ts';
import { predictDeck, type Prediction } from './stats.ts';
import { buildSchedule, goalRaces, racePopularity, raceWinChances, scheduleSummary, traineeAptitudes, type Aptitudes, type ScheduledRace } from './races.ts';
import { rankEstimate, type RankEstimate } from './rank.ts';
import { inheritedFromParents, type Inheritance } from './inherit.ts';
import { traineeAt } from './trainee.ts';
import { BORROWED_LB, DECK_SIZE, PRIORITIZED_SKILLS_MAX } from './rules.ts';

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
  pinnedIds: number[];                     // support cards forced into the deck, in order
  parentStars: number[][];                 // [parent 1, parent 2], five stats each
}

export interface RunPlan {
  trainee: Character | null;
  apt: Aptitudes;
  schedule: ScheduledRace[];
  sum: ReturnType<typeof scheduleSummary>;
  ctx: Ctx;
  targets: Target[];
  pool: { card: Card; lb: number }[];      // every card in the ranking, at its effective LB
  unowned: Set<number>;                    // card ids marked not owned
  pinnedIds: number[];                     // pins that are actually owned
  existing: Existing;                      // what the trainee and lineage already cover
  ranking: CardScore[];
  deckResult: DeckResult;
  pred: Prediction;
  inherited: Inheritance[];                // per stat, from both parents' blue sparks
  finalMean: number[];                     // predicted final stats including inheritance
  rank: RankEstimate;
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
 * Targets absent from the list go last.
 */
export function derivePriority(ordered: WishlistEntry[], targets: Target[], data: Data): number[] {
  const priority: number[] = [];
  const pushFamily = (ids: Iterable<number>) => { for (const id of ids) if (!priority.includes(id)) priority.push(id); };
  for (const w of ordered) {
    const target = targets.find((t) => t.familyIds.has(w.skillId));
    if (target) { pushFamily(target.familyIds); continue; }
    const fam = resolveTarget(w.skillId, data);
    pushFamily(fam ? fam.familyIds : [w.skillId]);
  }
  for (const t of targets) pushFamily(t.familyIds);
  return priority;
}

/** Plan the whole run: schedule, deck, prediction, rank estimate and prioritized skills. Pure; the app memoizes it. */
export function planRun(input: RunInput, settings: Settings, inventory: Inventory, data: Data): RunPlan {
  const traineeCard = input.traineeCardId != null ? data.charByCardId.get(input.traineeCardId) ?? null : null;
  const trainee = traineeCard ? traineeAt(traineeCard, input.traineeStars) : null;
  const apt = traineeAptitudes(trainee, input.aptOverrides);
  const schedule = buildSchedule(data.races, apt, settings.winThreshold, new Map(Object.entries(input.raceOverrides)), racePopularityMap(data), goalRaces(traineeCard));
  const sum = scheduleSummary(schedule);
  const totalTurns = settings.totalTurnsOverride ?? data.model.races.totalTurns;
  const targets = input.targets.map((id) => resolveTarget(id, data)).filter((t): t is Target => !!t);
  const lineage = new Map<number, Lineage>();
  for (const t of targets) { const l = input.targetLineage[String(t.id)]; if (l && lineageCount(l) > 0) lineage.set(t.id, l); }
  const baseCtx: Ctx = { data, settings, races: sum.count, totalTurns, trainee, raceWins: raceWinChances(schedule), lineage, priority: [] };
  const { pool, unowned } = cardPool(data, inventory, settings);
  const deckPool = pool.filter((p) => !unowned.has(p.card.id));
  const pinnedIds = input.pinnedIds.filter((id) => deckPool.some((p) => p.card.id === id));
  // Any Global card can be borrowed from a friend, assumed at the borrowed limit break.
  const borrowPool = data.cards.map((card) => ({ card, lb: BORROWED_LB }));
  const order = (cands: WishlistEntry[]) => applyUserOrder(cands, input.wishlistOrder, input.wishlistExcluded, data);
  // Pass 1: build without conflict rules to get the prioritized-skill order; that order decides which target an
  // event's single choice goes to. Pass 2 rebuilds with those rules.
  const pass1 = buildDeck(deckPool, targets, baseCtx, pinnedIds, DECK_SIZE, borrowPool);
  const priority = derivePriority(order(wishlistCandidates(pass1.deck, targets, baseCtx)), targets, data);
  const ctx: Ctx = { ...baseCtx, priority };
  const existing = traineeCoverage(targets, ctx);
  const ranking = rankCards(pool, targets, existing, ctx);
  const deckResult = buildDeck(deckPool, targets, ctx, pinnedIds, DECK_SIZE, borrowPool);
  const pred = predictDeck(deckResult.deck.map((d) => ({ card: d.card, lb: d.lb })), trainee, sum.count, settings.focus, sum.expectedLosses, data.model, settings);
  const inherited = STATS.map((_, i) => inheritedFromParents(input.parentStars, i, settings));
  const finalMean = pred.finalMean.map((v, i) => v + inherited[i]!.total);
  const rank = rankEstimate(finalMean, pred.sd, pred.sp, trainee, data, settings);
  const candidates = wishlistCandidates(deckResult.deck, targets, ctx);
  const ordered = order(candidates);
  return {
    trainee, apt, schedule, sum, ctx, targets, pool, unowned, pinnedIds, existing, ranking, deckResult, pred, inherited, finalMean, rank,
    wl: ordered.slice(0, PRIORITIZED_SKILLS_MAX),
    wlRest: ordered.slice(PRIORITIZED_SKILLS_MAX),
    wlExcluded: candidates.filter((w) => input.wishlistExcluded.includes(w.key)),
  };
}
