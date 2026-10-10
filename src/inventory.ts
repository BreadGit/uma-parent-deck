import { gameIdKey, type Card, type Inventory } from './types.ts';
import { sanitizeInventory } from './state.ts';
import { effectiveLb } from './model/run.ts';
import { downloadText } from './download.ts';
import { isLimitBreak, MAX_LB } from './model/rules.ts';
export { effectiveLb };

/** Writes every card explicitly so the file stands on its own: id -> lb or null. */
export function exportInventory(inv: Inventory, cards: Card[], defaults: { R: number; SR: number; SSR: number }) {
  const sorted = Object.fromEntries(cards.slice().sort((a, b) => a.id - b.id).map((c) => [String(c.id), effectiveLb(inv, c, defaults)]));
  downloadText('inventory.json', JSON.stringify(sorted, null, 1) + '\n', 'application/json');
}
/**
 * Read an inventory.json; `-1` and `"none"` are accepted as "not owned" for hand-written files. Card IDs follow the saved
 * state's rule, including its canonical form for zero-padded keys.
 */
export async function importInventory(file: File): Promise<Inventory> {
  const parsed: unknown = JSON.parse(await file.text());
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected an object of card IDs and limit breaks.');
  const normalized: Inventory = {};
  for (const [id, raw] of Object.entries(parsed)) {
    const value = raw === -1 || raw === 'none' ? null : typeof raw === 'string' && /^\d$/.test(raw) ? Number(raw) : raw;
    if (gameIdKey(id) === null || !(value === null || isLimitBreak(value))) {
      throw new Error(`Invalid inventory entry for ${id}. Use a numeric card ID with LB 0 to ${MAX_LB} or null.`);
    }
    normalized[id] = value;
  }
  return sanitizeInventory(normalized);
}
