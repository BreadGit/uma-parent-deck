import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { defaultState } from '../src/state.ts';
import { canReusePrioritySearch } from '../src/model/priority-search.ts';
import { planRun, type DeckSelection } from '../src/model/run.ts';
import { resolveTarget } from '../src/model/sparks.ts';
import type { WhiteTarget } from '../src/model/goal-input.ts';

const data = loadData();
const required: WhiteTarget[] = [{ id: 201601, role: 'required', stars: 2 }];
const before = [201601, 200432, 200501];
const after = [201601, 200501, 200432];

test('reuse is limited to known non-target permutations of an existing required-only list', () => {
  assert.equal(canReusePrioritySearch(before, after, required, data), true);
  assert.equal(canReusePrioritySearch(before, after, [], data), true);
  for (const [oldOrder, newOrder] of [
    [[], after], // first explicit order can affect other decks' implicit target order
    [before, [200432, 201601, 200501]], // a target moved
    [before, after.slice(0, 2)], // removal
    [before, [...after, 201631]], // addition
    [[...before, 201631], [...after, 200552]], // different membership
    [[201601, 200432, 200432], [201601, 200432, 200432]], // malformed duplicate
    [[201601, -1, 200432], [201601, 200432, -1]], // unknown skill
  ]) assert.equal(canReusePrioritySearch(oldOrder!, newOrder!, required, data), false);
  assert.equal(canReusePrioritySearch(before, after, [{ ...required[0]!, role: 'preferred' }], data), false);
  assert.equal(canReusePrioritySearch(before, after, [{ ...required[0]!, id: -1 }], data), false);
  const eleven = data.skills.slice(0, 11).map((s) => s.id);
  assert.equal(canReusePrioritySearch(eleven, [...eleven].reverse(), [], data), false, 'do not drop remembered entries beyond the ten-skill list');
});

test('gold and circle forms count as target entries even when the target uses its base name', () => {
  const corner = resolveTarget(200352, data)!;
  const right = data.skills.find((s) => s.name === 'Right-Handed ○')!;
  for (const target of [corner, resolveTarget(right.id, data)!]) {
    for (const form of target.familyIds) {
      assert.equal(canReusePrioritySearch([form, 200432, 200501], [200432, form, 200501],
        [{ id: target.id, role: 'required', stars: 2 }], data), false);
    }
  }
});

// Independently enumerate every legal deck in a nine-card pool with seven owned cards. This includes
// decks with and without Smart Falcon's shared event, Ines Fujin's multi-skill options, and gold forms.
const owned = [30052, 30017, 20030, 30028, 30020, 30078, 30083];
const borrows = [...owned, 30107, 30016];
const smallData = { ...data, cards: borrows.map((id) => data.cardById.get(id)!) };
const inventory = Object.fromEntries(borrows.map((id) => [id, owned.includes(id) ? (owned.indexOf(id) % 2 ? 2 : 4) : null]));
function allDecks(): DeckSelection[] {
  const decks: DeckSelection[] = [];
  for (let omittedA = 0; omittedA < owned.length; omittedA++) for (let omittedB = omittedA + 1; omittedB < owned.length; omittedB++) {
    const chosen = owned.filter((_, i) => i !== omittedA && i !== omittedB);
    for (const borrow of borrows.filter((id) => !chosen.includes(id))) decks.push([
      ...chosen.map((id) => ({ id, lb: inventory[id]!, borrowed: false })),
      { id: borrow, lb: 4, borrowed: true },
    ]);
  }
  return decks;
}

test('every legal deck in a small pool keeps its target odds, stats and rank under accepted reorders', () => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100501;
  saved.run.pinnedIds = [];
  saved.run.targets = [...required, { id: 201631, role: 'required', stars: 2 }, { id: 200352, role: 'required', stars: 2 }];
  const order = [201601, 201631, 200352, 200432, 200501, 201102, 200132, 200552, 201101, 201202];
  assert.ok(order.every((id) => data.skillById.has(id)));
  const reordered = [...order.slice(0, 3), ...order.slice(3).reverse()];
  assert.equal(canReusePrioritySearch(order, reordered, saved.run.targets, data), true);
  const decks = allDecks();
  assert.equal(decks.length, 84);
  for (const selection of decks) {
    assert.equal(new Set(selection.map((e) => data.cardById.get(e.id)!.charId)).size, 6);
    const a = planRun({ ...saved.run, wishlistOrder: order }, saved.settings, inventory, smallData, { selection, search: false });
    const b = planRun({ ...saved.run, wishlistOrder: reordered }, saved.settings, inventory, smallData, { selection, search: false });
    assert.deepEqual(b.goalEstimate, a.goalEstimate, JSON.stringify(selection));
    assert.deepEqual(b.deckResult.sparks, a.deckResult.sparks);
    assert.deepEqual(b.deckResult.coverage, a.deckResult.coverage, 'joint target outcomes retain the same event sources');
    assert.deepEqual(b.pred, a.pred);
    assert.deepEqual(b.rank, a.rank);
  }
});

test('a preferred target can change chance when only non-targets trade places above it', () => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100501;
  saved.run.pinnedIds = [];
  saved.run.targets = [{ id: 201631, role: 'preferred', stars: 2 }]; // Sympathy
  const order = [201102, 200132, 201631]; // Medium Straightaways / Standard Distance / Sympathy
  const reordered = [200132, 201102, 201631];
  const selection = allDecks().find((d) => d.some((e) => e.id === 20030))!;
  const a = planRun({ ...saved.run, wishlistOrder: order }, saved.settings, inventory, smallData, { selection, search: false });
  const b = planRun({ ...saved.run, wishlistOrder: reordered }, saved.settings, inventory, smallData, { selection, search: false });
  assert.ok(a.deckResult.sparks.get(201631)! > b.deckResult.sparks.get(201631)!, 'Ines Fujin offers Sympathy alongside only one of the competing non-targets');
  assert.equal(canReusePrioritySearch(order, reordered, saved.run.targets, data), false);
});

test('changing required target order still searches when the targets compete for an event', () => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100501;
  saved.run.pinnedIds = [];
  saved.run.targets = [...required, { id: 200432, role: 'required', stars: 2 }];
  const selection = allDecks().find((d) => d.some((e) => e.id === 30017))!;
  const a = planRun({ ...saved.run, wishlistOrder: [201601, 200432] }, saved.settings, inventory, smallData, { selection, search: false });
  const b = planRun({ ...saved.run, wishlistOrder: [200432, 201601] }, saved.settings, inventory, smallData, { selection, search: false });
  assert.ok(a.deckResult.sparks.get(201601)! > b.deckResult.sparks.get(201601)!);
  assert.equal(canReusePrioritySearch([201601, 200432], [200432, 201601], saved.run.targets, data), false);
});
