import type { Card, Inventory } from './types.ts';
import { effectiveLb } from './model/run.ts';
export { effectiveLb };

/** Writes every card explicitly so the file stands on its own: id -> lb or null. */
export function exportInventory(inv: Inventory, cards: Card[], defaults: { R: number; SR: number; SSR: number }) {
  const sorted = Object.fromEntries(cards.slice().sort((a, b) => a.id - b.id).map((c) => [String(c.id), effectiveLb(inv, c, defaults)]));
  const blob = new Blob([JSON.stringify(sorted, null, 1) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'inventory.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
/** Read an inventory.json; `-1` and `"none"` are accepted as "not owned" for hand-written files. */
export async function importInventory(file: File): Promise<Inventory> {
  const parsed: unknown = JSON.parse(await file.text());
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected an object of card IDs and limit breaks.');
  const normalized: Inventory = {};
  for (const [id, raw] of Object.entries(parsed)) {
    const value = raw === -1 || raw === 'none' ? null : typeof raw === 'string' && /^[0-4]$/.test(raw) ? Number(raw) : raw;
    if (!/^\d+$/.test(id) || !(value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4))) {
      throw new Error(`Invalid inventory entry for ${id}. Use a numeric card ID with LB 0 to 4 or null.`);
    }
    normalized[id] = value;
  }
  return normalized;
}
