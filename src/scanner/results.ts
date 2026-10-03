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

export type Summary = ReturnType<typeof summarize>;

const indexes = new WeakMap<ScanCard[], Map<number, ScanCard>>();
export function cardIndex(cards: ScanCard[]) {
  let byId = indexes.get(cards);
  if (!byId) indexes.set(cards, byId = new Map(cards.map(c => [c.id, c])));
  return byId;
}

export function summarize(rows: ReviewRow[], cards: ScanCard[]) {
  const cardById = cardIndex(cards);
  const included = rows.filter(r => !r.excluded);
  const invalid = new Set(included.filter(r => !r.reviewed || r.cardId === null || !cardById.has(r.cardId)
    || cardById.get(r.cardId)?.rarity === 'R' || r.lb === null || !Number.isInteger(r.lb) || r.lb < 0 || r.lb > 4));
  const values = new Map<number, Set<number>>();
  for (const row of included) {
    if (invalid.has(row)) continue;
    const lbs = values.get(row.cardId!) ?? new Set<number>();
    lbs.add(row.lb!);
    values.set(row.cardId!, lbs);
  }
  const conflicts = new Set([...values].filter(([, lbs]) => lbs.size > 1).map(([id]) => id));
  const pending = new Set([...[...invalid].map(r => r.key), ...included.filter(r => r.cardId !== null && conflicts.has(r.cardId)).map(r => r.key)]);
  const identified = included.map(r => r.cardId).filter(id => id !== null);
  return { included, invalid, values, conflicts, pending, owned: values.size, duplicates: identified.length - new Set(identified).size };
}

/** Every reading of one card: identical readings from overlapping screenshots collapse into one entry. */
export interface Group { cardId: number; card: ScanCard; rows: ReviewRow[]; lbs: number[] }
export interface Triage {
  /** Rows that still need a card or a limit break chosen, in the order they were read. */
  attention: ReviewRow[];
  /** Cards whose screenshots disagree about the limit break. */
  conflicts: Group[];
  /** Cards read with one agreed limit break, by character name. */
  ready: Group[];
  excluded: ReviewRow[];
  /** Catalog SR and SSR cards with no reading at all, SSR first. */
  unseen: ScanCard[];
}
const byName = (a: ScanCard, b: ScanCard) => a.charName.localeCompare(b.charName) || a.id - b.id;
export function triage(rows: ReviewRow[], cards: ScanCard[], result: Summary = summarize(rows, cards)): Triage {
  const cardById = cardIndex(cards);
  const groups = new Map<number, Group>();
  const attention: ReviewRow[] = [], excluded: ReviewRow[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    if (row.excluded) { excluded.push(row); continue; }
    if (row.cardId !== null) seen.add(row.cardId);
    if (result.invalid.has(row)) { attention.push(row); continue; }
    const card = cardById.get(row.cardId!)!;
    const group = groups.get(card.id) ?? { cardId: card.id, card, rows: [], lbs: [] };
    group.rows.push(row);
    if (!group.lbs.includes(row.lb!)) group.lbs.push(row.lb!);
    groups.set(card.id, group);
  }
  const all = [...groups.values()].sort((a, b) => byName(a.card, b.card));
  const rank = { SSR: 0, SR: 1, R: 2 };
  const unseen = cards.filter(c => c.rarity !== 'R' && !seen.has(c.id)).sort((a, b) => rank[a.rarity] - rank[b.rarity] || byName(a, b));
  return { attention, conflicts: all.filter(g => g.lbs.length > 1), ready: all.filter(g => g.lbs.length === 1), excluded, unseen };
}

/** List every catalog card explicitly: an omitted ID would inherit the planner's rarity default. */
export function inventoryFromReview(rows: ReviewRow[], cards: ScanCard[], result: Summary = summarize(rows, cards)): Inventory {
  if (result.pending.size) throw new Error('unresolved-inventory');
  return Object.fromEntries(cards.slice().sort((a, b) => a.id - b.id).map(c => [
    String(c.id), c.rarity === 'R' ? 4 : result.values.get(c.id)?.values().next().value ?? null,
  ]));
}

/** `replace` marks every unseen SR and SSR card not owned; `update` only writes the cards that were read. */
export type ApplyMode = 'replace' | 'update';
export interface InventoryChange {
  inventory: Inventory;
  /** SR and SSR cards whose effective value changes, by kind. */
  owned: ScanCard[]; unowned: ScanCard[]; changed: ScanCard[];
  unchanged: number;
}
/** The planner's inventory after the readings, plus what the change does to each card's effective limit break. */
export function applyReadings(current: Inventory, cards: ScanCard[], effective: (card: ScanCard) => number | null,
  result: Summary, mode: ApplyMode): InventoryChange {
  const inventory: Inventory = { ...current };
  const change: InventoryChange = { inventory, owned: [], unowned: [], changed: [], unchanged: 0 };
  for (const card of cards) {
    if (card.rarity === 'R') continue;
    const read = result.values.get(card.id)?.values().next().value;
    if (read !== undefined) inventory[String(card.id)] = read;
    else if (mode === 'replace') inventory[String(card.id)] = null;
    const stored = inventory[String(card.id)];
    const before = effective(card), after = stored === undefined ? before : stored;
    if (before === after) change.unchanged++;
    else if (before === null) change.owned.push(card);
    else if (after === null) change.unowned.push(card);
    else change.changed.push(card);
  }
  return change;
}
