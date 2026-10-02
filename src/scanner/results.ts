import type { Inventory } from '../types.ts';
import type { Detection, ScanCard } from './recognize.ts';

export interface ReviewRow {
  key: number;
  source: string;
  crop: string;
  detection: Detection | null;
  cardId: number | null;
  lb: number | null;
  reviewed: boolean;
  excluded: boolean;
}

export function summarize(rows: ReviewRow[], cards: ScanCard[]) {
  const cardById = new Map(cards.map(c => [c.id, c]));
  const included = rows.filter(r => !r.excluded);
  const invalid = included.filter(r => !r.reviewed || r.cardId === null || !cardById.has(r.cardId)
    || cardById.get(r.cardId)?.rarity === 'R' || r.lb === null || !Number.isInteger(r.lb) || r.lb < 0 || r.lb > 4);
  const values = new Map<number, Set<number>>();
  for (const row of included) {
    if (invalid.includes(row)) continue;
    const lbs = values.get(row.cardId!) ?? new Set<number>();
    lbs.add(row.lb!);
    values.set(row.cardId!, lbs);
  }
  const conflicts = new Set([...values].filter(([, lbs]) => lbs.size > 1).map(([id]) => id));
  const pending = new Set([...invalid.map(r => r.key), ...included.filter(r => r.cardId !== null && conflicts.has(r.cardId)).map(r => r.key)]);
  const identified = included.map(r => r.cardId).filter(id => id !== null);
  return { included, values, conflicts, pending, owned: values.size, duplicates: identified.length - new Set(identified).size };
}

/** List every catalog card explicitly: an omitted ID would inherit the planner's rarity default. */
export function inventoryFromReview(rows: ReviewRow[], cards: ScanCard[]): Inventory {
  const result = summarize(rows, cards);
  if (result.pending.size) throw new Error('unresolved-inventory');
  return Object.fromEntries(cards.slice().sort((a, b) => a.id - b.id).map(c => [
    String(c.id), c.rarity === 'R' ? 4 : result.values.get(c.id)?.values().next().value ?? null,
  ]));
}
