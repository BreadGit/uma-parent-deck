import type { Card, Inventory } from './types.ts';
import defaultInventory from '../inventory.json' with { type: 'json' };
import { effectiveLb } from './model/run.ts';
export { effectiveLb };

const KEY = 'uma-parent-deck.inventory';

export function loadInventory(): Inventory {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Inventory;
  } catch { /* ignore */ }
  return { ...(defaultInventory as Inventory) };
}
export function saveInventory(inv: Inventory) {
  localStorage.setItem(KEY, JSON.stringify(inv));
}
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
export async function importInventory(file: File): Promise<Inventory> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const out: Inventory = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!/^\d+$/.test(k)) continue;
    if (v === null || v === -1 || v === 'none') { out[k] = null; continue; }
    const lb = Number(v);
    if (Number.isInteger(lb) && lb >= 0 && lb <= 4) out[k] = lb;
  }
  return out;
}
