import type { Card } from '../types.ts';
import { chooseGoal, type GoalScore } from './goal-objective.ts';
import { DECK_SIZE } from './rules.ts';

export interface GoalDeckEntry { card: Card; lb: number; borrowed?: boolean }
export interface GoalCandidate<T> { entries: GoalDeckEntry[]; key: string; score: GoalScore; statPower: number; value: T }
export interface GoalSearchOptions<T> {
  owned: GoalDeckEntry[];
  borrows: GoalDeckEntry[];
  ownedOrders: GoalDeckEntry[][];
  borrowOrders: GoalDeckEntry[][];
  seeds?: GoalDeckEntry[][];
  pinnedIds: number[];
  borrowFromAll: boolean;
  traineeId: number | null;
  tolerance: number;
  evaluate: (entries: GoalDeckEntry[]) => { score: GoalScore; statPower: number; value: T };
  budget?: number;
  size?: number;
}
export const goalDeckKey = (entries: GoalDeckEntry[]) => entries.map((e) => `${e.borrowed ? 'b' : 'o'}:${e.card.id}:${e.lb}`).sort().join('|');

/** Deterministic complete-deck search, exhaustive for small pools and bounded for normal inventories. */
export function searchGoalDeck<T>(options: GoalSearchOptions<T>) {
  const size = options.size ?? DECK_SIZE, ownedSlots = size - Number(options.borrows.length > 0), budget = options.budget ?? 192;
  const owned = options.owned.filter((e) => e.card.charId !== options.traineeId);
  const borrows = options.borrows.filter((e) => e.card.charId !== options.traineeId);
  const ownById = new Map(owned.map((e) => [e.card.id, e])), borrowById = new Map(borrows.map((e) => [e.card.id, e]));
  const pins = new Set(options.pinnedIds);
  const basicLegal = (entries: GoalDeckEntry[]) => entries.length === size && entries.filter((e) => !e.borrowed).length === ownedSlots
    && new Set(entries.map((e) => e.card.charId)).size === size && entries.every((e) => e.card.charId !== options.traineeId && (e.borrowed ? borrowById : ownById).get(e.card.id)?.lb === e.lb);
  const pinProfile = (entries: GoalDeckEntry[]) => {
    const own = entries.filter((e) => !e.borrowed && pins.has(e.card.id)).length;
    const borrowed = entries.find((e) => e.borrowed);
    return [own + Number(!!borrowed && pins.has(borrowed.card.id) && (!ownById.has(borrowed.card.id) || !options.borrowFromAll)), own];
  };
  const profileOrder = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]!;
  const fill = (order: GoalDeckEntry[], borrowed?: GoalDeckEntry) => {
    const entries: GoalDeckEntry[] = borrowed ? [{ ...borrowed, borrowed: true }] : [];
    for (const e of order.slice().sort((a, b) => Number(pins.has(b.card.id)) - Number(pins.has(a.card.id)))) {
      if (entries.length === size) break;
      if (e.card.charId === options.traineeId || entries.some((x) => x.card.charId === e.card.charId)) continue;
      entries.push({ ...e, borrowed: false });
    }
    return entries;
  };
  // A borrow can consume a pinned character. Check all borrow choices before fixing the pin constraint.
  const legalSeeds = (borrows.length ? borrows : [undefined]).map((b) => fill(owned, b)).filter(basicLegal);
  if (!legalSeeds.length) return null;
  const bestPins = legalSeeds.map(pinProfile).sort((a, b) => profileOrder(b, a))[0]!;
  const legal = (entries: GoalDeckEntry[]) => basicLegal(entries) && profileOrder(pinProfile(entries), bestPins) === 0;
  const evaluated = new Map<string, GoalCandidate<T>>();
  const evaluate = (entries: GoalDeckEntry[]) => {
    if (!legal(entries)) return;
    const key = goalDeckKey(entries);
    if (evaluated.has(key)) return evaluated.get(key)!;
    if (evaluated.size >= budget) return;
    const value = { entries, key, ...options.evaluate(entries) };
    evaluated.set(key, value);
    return value;
  };
  let exhaustive = false;
  if (owned.length <= 10 && borrows.length <= 10) {
    const all: GoalDeckEntry[][] = [];
    const enumerate = (entries: GoalDeckEntry[], from: number) => {
      if (all.length > budget) return;
      if (entries.length === size) { if (legal(entries)) all.push(entries); return; }
      for (let i = from; i < owned.length; i++) {
        const e = owned[i]!;
        if (!entries.some((x) => x.card.charId === e.card.charId)) enumerate([...entries, { ...e, borrowed: false }], i + 1);
      }
    };
    for (const b of borrows.length ? borrows : [undefined]) enumerate(b ? [{ ...b, borrowed: true }] : [], 0);
    if (all.length <= budget) { all.forEach(evaluate); exhaustive = true; }
  }
  if (!exhaustive) {
    for (const seed of options.seeds ?? []) evaluate(seed);
    for (const order of options.ownedOrders) {
      let added = 0;
      for (const b of options.borrowOrders.flat().concat(borrows).filter((e, i, a) => a.findIndex((x) => x.card.id === e.card.id) === i)) {
        const seed = fill(order, b);
        if (legal(seed)) { evaluate(seed); if (++added === 2) break; }
      }
      if (!borrows.length) evaluate(fill(order));
    }
    if (!evaluated.size) evaluate(legalSeeds.find(legal)!);
    const shortlist = (orders: GoalDeckEntry[][], pool: GoalDeckEntry[]) => pool.length <= 16 ? pool : [...new Map([...Array.from({ length: 5 }, (_, i) => orders.flatMap((o) => o[i] ? [o[i]!] : [])).flat(), ...pool.filter((e) => pins.has(e.card.id))].map((e) => [e.card.id, e])).values()];
    const replacements = { owned: shortlist(options.ownedOrders, owned), borrow: shortlist(options.borrowOrders, borrows) };
    const expanded = new Set<string>();
    for (let pass = 0; pass < 3 && evaluated.size < budget; pass++) {
      const remaining = [...evaluated.values()].filter((c) => !expanded.has(c.key));
      const beam: GoalCandidate<T>[] = [];
      for (let i = 0; i < 2 && remaining.length; i++) {
        const best = chooseGoal(remaining, options.tolerance); beam.push(best); remaining.splice(remaining.indexOf(best), 1);
      }
      if (!beam.length) break;
      // Interleave slots and alternatives so a budget cannot spend every evaluation on the first slot.
      for (const current of beam) expanded.add(current.key);
      const width = Math.max(replacements.owned.length, replacements.borrow.length);
      const roundLimit = Math.floor(budget * (pass + 1) / 3);
      neighbors: for (let n = 0; n < width; n++) for (let slot = 0; slot < size; slot++) for (const current of beam) {
        if (evaluated.size >= roundLimit) break neighbors;
        const old = current.entries[slot]!, replacement = (old.borrowed ? replacements.borrow : replacements.owned)[n];
        if (replacement) evaluate(current.entries.map((e, i) => i === slot ? { ...replacement, borrowed: old.borrowed } : e));
      }
      // Swapping which card is borrowed can upgrade an owned LB without changing the six characters.
      for (const current of beam) {
        const b = current.entries.find((e) => e.borrowed);
        if (!b) continue;
        for (const e of current.entries.filter((e) => !e.borrowed)) {
          const up = borrowById.get(e.card.id), own = ownById.get(b.card.id);
          if (up && own) evaluate(current.entries.map((x) => x === e ? { ...up, borrowed: true } : x === b ? { ...own, borrowed: false } : x));
        }
      }
    }
  }
  const candidates = [...evaluated.values()];
  return { best: chooseGoal(candidates, options.tolerance), candidates, exhaustive, evaluated: candidates.length, legal };
}
