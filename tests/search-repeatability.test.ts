// A separate file from search-quality.test.ts so the test runner runs these slow searches in parallel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { defaultState } from '../src/state.ts';
import { planRun } from '../src/model/run.ts';
import { decodeShare } from '../src/share.ts';

const data = loadData();

test('the shared run is independent of previous recommendations and card order', async () => {
  const saved = defaultState(data);
  const shared = await decodeShare('4dXZBLjgQhDEMvZI3sEKjiLBE3aM1u7j8iRauhxcJ6iUM-IbJS-P17vRBWYIggNMZAhFG1C4KBA2E0tQ1F8UTtZrUD6d12bL6jvJ1YD_NXtu1jUK0e6LeBic8Sq3OBUD-O-Rz-BOaas8hXUUHHPRANDT0jDkEDcS_t87_UZGbzmPXpyYzPykJWG-8Lr1ZrBOriJNqVVFtK0RTWFFVPUuZo5bFc9j6FjTn6zzX-AQ');
  Object.assign(saved.run, shared.run);
  Object.assign(saved.settings, shared.settings);
  saved.inventory = { ...Object.fromEntries(data.cards.map((c) => [c.id, 4])),
    30001: 1, 30002: 0, 30003: 0, 30004: null, 30005: null, 30006: 2, 30007: 0, 30008: null, 30014: 0, 30015: null,
    30017: 0, 30018: 1, 30020: null, 30024: 0, 30027: null, 30031: null, 30032: null, 30039: null, 30042: null,
    30045: 1, 30047: 3, 30052: 2, 30056: 0, 30057: 3, 30064: null, 30067: null, 30072: null, 30074: 3, 30078: null,
    30083: null, 30084: null, 30089: null, 30093: null, 30095: null, 30101: 1, 30105: 1, 30106: null, 30114: 0,
    30115: null, 30116: null, 30120: null,
  };
  const before = structuredClone(saved);
  const fresh = planRun(saved.run, saved.settings, saved.inventory, data);
  const reference = [30078, 30052, 30057, 20005, 30045, 30074].map((id, i) => ({ id, borrowed: i === 0, lb: i === 0 ? 4 : saved.inventory[String(id)]! }));
  const referencePlan = planRun({ ...saved.run, wishlistOrder: [], wishlistExcluded: [] }, saved.settings, saved.inventory, data, { selection: reference });
  assert.ok(fresh.search!.score.probability >= referencePlan.goalEstimate.probability! * (1 - saved.settings.goalTieTolerance),
    'the search retains the known Gold Ship alternative within the required-goal tolerance');
  const previous = [30078, 30052, 30045, 20005, 30101, 30074].map((id, i) => ({ id, borrowed: i === 0, lb: i === 0 ? 4 : saved.inventory[String(id)]! }));
  // An intervening edit must not affect a search after that edit is undone.
  planRun({ ...saved.run, goal: { ...saved.run.goal, blueStars: 1 } }, saved.settings, saved.inventory, data, { previous, budget: 8 });
  const repeated = planRun(saved.run, saved.settings, saved.inventory, data, { previous: previous.slice().reverse() });
  const selection = (p: ReturnType<typeof planRun>) => p.deckResult.deck.map((e) => [e.card.id, e.lb, !!e.borrowed]);
  assert.deepEqual(selection(repeated), selection(fresh));
  assert.deepEqual(repeated.search, fresh.search);
  assert.deepEqual(repeated.rank, fresh.rank);
  assert.deepEqual(saved, before, 'search leaves saved priorities and inventory unchanged');

  const pearl = [30078, 30052, 20023, 20005, 20029, 30074].map((id, i) => ({ id, borrowed: i === 0, lb: i === 0 ? 4 : saved.inventory[String(id)]! }));
  const run = { ...saved.run, wishlistOrder: [], wishlistExcluded: [] };
  const forward = planRun(run, saved.settings, saved.inventory, data, { selection: pearl });
  for (const permuted of [pearl.slice().reverse(), [...pearl.slice(2), ...pearl.slice(0, 2)]]) {
    const reversed = planRun(run, saved.settings, saved.inventory, data, { selection: permuted });
    assert.deepEqual(reversed.wl.map((w) => w.key), forward.wl.map((w) => w.key), 'tied extra skills have the same default order');
    assert.deepEqual(reversed.rank, forward.rank);
    assert.deepEqual(reversed.finalMean, forward.finalMean);
    assert.equal(reversed.goalEstimate.probability, forward.goalEstimate.probability);
  }
});
