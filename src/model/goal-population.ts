import { chooseGoal, type GoalScore } from './goal-objective.ts';
import type { GoalDeckEntry } from './goal-deck.ts';

export const SCREENED_DECKS = 1536;
export const SEARCH_RANK_SAMPLES = 32;
export const EXPLORATION_SAMPLES = 128;
export const SEARCH_FINALISTS = 16;
const POPULATION_SIZE = 12;

interface ScreenedDeck { entries: GoalDeckEntry[]; key: string; score: GoalScore; statPower: number }
interface PopulationOptions {
  owned: GoalDeckEntry[];
  borrows: GoalDeckEntry[];
  ownedOrders: GoalDeckEntry[][];
  borrowOrders: GoalDeckEntry[][];
  seeds: GoalDeckEntry[][];
  pinnedIds: number[];
  tolerance: number;
  budget: number;
  key: (entries: GoalDeckEntry[]) => string;
  legal: (entries: GoalDeckEntry[]) => boolean;
  fill: (order: GoalDeckEntry[], borrow?: GoalDeckEntry) => GoalDeckEntry[];
  screen: (entries: GoalDeckEntry[]) => { score: GoalScore; statPower: number };
}

/** Interleave rankings without removing cards below a cutoff. */
function interleave(orders: GoalDeckEntry[][], pool: GoalDeckEntry[]): GoalDeckEntry[] {
  const allowed = new Set(pool.map((e) => e.card.id)), entries = new Map<number, GoalDeckEntry>();
  const add = (e: GoalDeckEntry) => { if (allowed.has(e.card.id) && !entries.has(e.card.id)) entries.set(e.card.id, e); };
  for (let i = 0; i < Math.max(0, ...orders.map((o) => o.length)); i++) for (const order of orders) if (order[i]) add(order[i]!);
  pool.forEach(add);
  return [...entries.values()];
}

/** A fixed stream makes exploration reproducible. It is unrelated to the probability model's samples. */
function randomStream() {
  let seed = 1;
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

/** Explore complete legal decks cheaply; callers must fully evaluate the returned finalists. */
export function screenGoalDecks(options: PopulationOptions) {
  const screened = new Map<string, ScreenedDeck>(), random = randomStream();
  const owned = interleave(options.ownedOrders, options.owned), borrows = interleave(options.borrowOrders, options.borrows);
  const pins = new Set(options.pinnedIds);
  const ownedPins = owned.filter((e) => pins.has(e.card.id));
  const evaluate = (entries: GoalDeckEntry[]) => {
    if (!options.legal(entries)) return undefined;
    const key = options.key(entries);
    if (screened.has(key)) return screened.get(key)!;
    if (screened.size >= options.budget) return undefined;
    const result = { entries, key, ...options.screen(entries) };
    screened.set(key, result);
    return result;
  };
  let population: ScreenedDeck[] = [];
  const seed = (entries: GoalDeckEntry[]) => { const result = evaluate(entries); if (result && !population.includes(result)) population.push(result); };
  options.seeds.forEach(seed);
  for (let n = 0; n < 24 && options.ownedOrders.length; n++) {
    const borrowed = borrows.length ? borrows[n % Math.min(6, borrows.length)] : undefined;
    seed(options.fill(options.ownedOrders[Math.floor(n / 6) % options.ownedOrders.length]!, borrowed));
  }
  const sample = (pool: GoalDeckEntry[]) => random() < .1
    ? pool[Math.floor(random() * pool.length)]!
    : pool[Math.min(pool.length - 1, Math.floor(-Math.log(Math.max(1e-8, random())) * 14))]!;
  for (let trial = 0; population.length && screened.size < options.budget && trial < options.budget * 30; trial++) {
    const parent = population[Math.floor(random() * population.length)]!;
    let entries = parent.entries.slice();
    const competingPins = ownedPins.length > entries.filter((e) => !e.borrowed && pins.has(e.card.id)).length;
    const slots = entries.flatMap((e, i) => e.borrowed || !pins.has(e.card.id) || competingPins ? [i] : []);
    if (!slots.length) break;
    const changes = random() < .25 ? 2 : 1;
    for (let n = 0; n < changes; n++) {
      const slot = slots[Math.floor(random() * slots.length)]!, old = entries[slot]!;
      const replacement = sample(old.borrowed ? borrows : pins.has(old.card.id) ? ownedPins : owned);
      entries = entries.map((e, i) => i === slot ? { ...replacement, borrowed: old.borrowed } : e);
    }
    const result = evaluate(entries);
    if (!result || population.includes(result)) continue;
    const remaining = [...population, result];
    population = [];
    while (remaining.length && population.length < POPULATION_SIZE) {
      const best = chooseGoal(remaining, options.tolerance);
      population.push(best);
      remaining.splice(remaining.indexOf(best), 1);
    }
  }
  const remaining = [...screened.values()], finalists: GoalDeckEntry[][] = [];
  while (remaining.length && finalists.length < SEARCH_FINALISTS) {
    const best = chooseGoal(remaining, options.tolerance);
    finalists.push(best.entries);
    remaining.splice(remaining.indexOf(best), 1);
  }
  return { finalists, screened: screened.size };
}
