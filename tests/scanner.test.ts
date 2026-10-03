import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLimitBreak, type Pixels, type ScanCard } from '../src/scanner/recognize.ts';
import { applyReadings, inventoryFromReview, summarize, triage, type ReviewRow } from '../src/scanner/results.ts';
import { importInventory } from '../src/inventory.ts';

const cards: ScanCard[] = [
  { id: 10001, rarity: 'R', type: 'guts', name: 'Rare', charName: 'Rare' },
  { id: 20001, rarity: 'SR', type: 'wit', name: 'Super rare', charName: 'Super rare' },
  { id: 30001, rarity: 'SSR', type: 'guts', name: 'SSR', charName: 'SSR' },
  { id: 30002, rarity: 'SSR', type: 'speed', name: 'Missing', charName: 'Missing' },
];
const row = (key: number, cardId = 30001, lb: number | null = 2): ReviewRow =>
  ({ key, cardId, lb, source: String(key), crop: '', detection: null, reviewed: true, excluded: false });

test('scanner exports explicit unowned SR/SSR and MLB R, and round-trips through the real importer', async () => {
  const exported = inventoryFromReview([row(1)], cards);
  assert.deepEqual(exported, { 10001: 4, 20001: null, 30001: 2, 30002: null });
  assert.deepEqual(await importInventory(new File([JSON.stringify(exported)], 'inventory.json')), exported);
});
test('overlap merges identical readings without upgrading a conflicting LB', () => {
  const rows = [row(1), row(2)];
  assert.equal(summarize(rows, cards).duplicates, 1);
  assert.equal(inventoryFromReview(rows, cards)['30001'], 2);
  rows[1]!.lb = 4;
  assert.deepEqual([...summarize(rows, cards).pending], [1, 2]);
  assert.throws(() => inventoryFromReview(rows, cards));
  rows[1]!.excluded = true;
  assert.equal(inventoryFromReview(rows, cards)['30001'], 2);
});
test('uncertainty, missing LB, invalid IDs and invalid LB cannot silently become exports', () => {
  for (const change of [{ reviewed: false }, { lb: null }, { lb: 5 }, { lb: 1.5 }, { cardId: 99999 }, { cardId: 10001 }]) {
    assert.throws(() => inventoryFromReview([{ ...row(1), ...change }], cards));
  }
  assert.deepEqual(inventoryFromReview([], cards), { 10001: 4, 20001: null, 30001: null, 30002: null });
  assert.equal(summarize([{ ...row(1), cardId: null }], cards).duplicates, 0);
  const excluded = { ...row(2), reviewed: false, excluded: true };
  assert.equal(summarize([row(1), excluded], cards).pending.size, 0);
});

// Diamond positions measured from the supplied game screenshots at an 80 px card width.
function diamonds(on: boolean[], offsetY = 0): Pixels {
  const image: Pixels = { width: 80, height: 109, data: new Uint8ClampedArray(80 * 109 * 4).fill(245) };
  for (const [i, x] of [7, 17, 26, 36].entries()) {
    for (let y = 94; y <= 104; y++) for (let dx = -4; dx <= 4; dx++) {
      if (Math.abs(dx) + Math.abs(y - 99) > 6) continue;
      image.data.set(on[i] ? [20, 205, 225, 255] : [155, 157, 156, 255], ((y + offsetY) * 80 + x + dx) * 4);
    }
  }
  return image;
}
test('LB comes from the four cyan diamonds, including unlevelled MLB cards', () => {
  for (const lb of [0, 1, 2, 3, 4]) assert.equal(readLimitBreak(diamonds([0, 1, 2, 3].map(i => i < lb))), lb);
  assert.equal(readLimitBreak(diamonds([true, false, true, false])), null);
  assert.equal(readLimitBreak({ width: 80, height: 109, data: new Uint8ClampedArray(80 * 109 * 4) }), null);
});
test('LB samples the diamond interior when the lower tips overlap colorful artwork', () => {
  for (const lb of [0, 1, 2, 3, 4]) {
    const tile = diamonds([0, 1, 2, 3].map(i => i < lb), -4);
    for (let y = 99; y < 109; y++) for (let x = 0; x < 45; x++) {
      tile.data.set([230, 95, 40, 255], (y * tile.width + x) * 4);
    }
    assert.equal(readLimitBreak(tile), lb);
  }
});

test('triage separates decisions from confident readings and merges overlapping ones', () => {
  const rows = [row(1), row(2), row(3, 20001, 4), { ...row(4, 20001, 1), excluded: true }, { ...row(5, 30002, 3), reviewed: false }];
  const t = triage(rows, cards);
  assert.deepEqual(t.ready.map(g => [g.cardId, g.lbs, g.rows.length]), [[30001, [2], 2], [20001, [4], 1]]);
  assert.deepEqual(t.attention.map(r => r.key), [5]);
  assert.deepEqual(t.excluded.map(r => r.key), [4]);
  assert.deepEqual(t.unseen, [], 'an unconfirmed reading still counts as seen');
  rows[1]!.lb = 3;
  const conflicted = triage(rows, cards);
  assert.deepEqual(conflicted.conflicts.map(g => [g.cardId, g.lbs]), [[30001, [2, 3]]]);
  assert.deepEqual(conflicted.ready.map(g => g.cardId), [20001]);
  assert.deepEqual(triage([row(1)], cards).unseen.map(c => c.id), [30002, 20001], 'unseen SR and SSR cards, SSR first');
});
test('applying readings replaces or updates the planner inventory and reports the difference', () => {
  const current = { 20001: 0, 30002: null };
  const effective = (card: ScanCard) => current[card.id as keyof typeof current] === undefined ? 4 : current[card.id as keyof typeof current];
  const result = summarize([row(1), row(2, 20001, 3)], cards);
  const replaced = applyReadings(current, cards, effective, result, 'replace');
  assert.deepEqual(replaced.inventory, { 20001: 3, 30001: 2, 30002: null });
  assert.deepEqual([replaced.owned, replaced.changed.map(c => c.id), replaced.unowned, replaced.unchanged], [[], [20001, 30001], [], 1]);
  const updated = applyReadings({ 30001: null, 30002: 1 }, cards, c => c.id === 30001 ? null : c.id === 30002 ? 1 : 4, result, 'update');
  assert.deepEqual(updated.inventory, { 20001: 3, 30001: 2, 30002: 1 });
  assert.deepEqual([updated.owned.map(c => c.id), updated.changed.map(c => c.id), updated.unowned, updated.unchanged], [[30001], [20001], [], 1]);
  assert.equal('10001' in updated.inventory, false, 'R cards are never written');
});
