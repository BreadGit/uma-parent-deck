import type { Card, Inventory } from './types.ts';
import { effectiveLb } from './model/run.ts';
import { sanitizeInventory } from './state.ts';
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
  const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
  const normalized = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, v === -1 || v === 'none' ? null : typeof v === 'string' ? Number(v) : v]));
  return sanitizeInventory(normalized);
}
