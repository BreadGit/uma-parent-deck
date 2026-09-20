import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { defaultState, type AppState } from '../src/state.ts';
import { planRun, type DeckSelection } from '../src/model/run.ts';
import { decodeShare } from '../src/share.ts';

const data = loadData();

// Reference decks found by fully evaluating local neighbors before broad screening.
// Rescore them against current data so these checks do not freeze a particular probability model.
const cases: { name: string; setup: (saved: AppState) => void; reference: DeckSelection }[] = [
  {
    name: 'a three-star required white with only SR cards owned',
    setup(saved) {
      saved.run.targets = [{ id: 200352, role: 'required', stars: 3, priority: 0 }];
      saved.inventory = Object.fromEntries(data.cards.map((c) => [c.id, c.rarity === 'SR' ? 2 : null]));
    },
    reference: [30052, 20009, 20020, 20038, 20031, 20007].map((id, i) => ({ id, lb: i === 0 ? 4 : 2, borrowed: i === 0 })),
  },
  {
    name: 'two three-star required whites with a speed-only blue goal',
    setup(saved) {
      saved.run.traineeCardId = 100101;
      saved.run.targets = [200352, 200432].map((id) => ({ id, role: 'required', stars: 3, priority: 0 }));
      saved.run.goal.blueStats = ['speed'];
      saved.run.goal.blueStars = 3;
      saved.settings.focus = 'balanced';
      saved.settings.defaultLb = { R: 2, SR: 2, SSR: 1 };
    },
    reference: [
      { id: 20009, lb: 2 }, { id: 30052, lb: 1 }, { id: 30101, lb: 1 },
      { id: 30078, lb: 4, borrowed: true }, { id: 20020, lb: 2 }, { id: 30016, lb: 1 },
    ],
  },
];

for (const { name, setup, reference } of cases) test(`cheaper exploration retains search quality for ${name}`, () => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100501;
  saved.inventory['30017'] = null;
  setup(saved);
  const baseline = planRun(saved.run, saved.settings, saved.inventory, data, { selection: reference, search: false });
  assert.ok(baseline.goalEstimate.probability! > 0, 'the reference completes the required goal');
  const result = planRun(saved.run, saved.settings, saved.inventory, data);
  assert.equal(result.search!.score.count, result.search!.score.total, 'every requirement remains achievable');
  assert.ok(result.goalEstimate.probability! >= baseline.goalEstimate.probability! * (1 - saved.settings.goalTieTolerance),
    `${result.goalEstimate.probability} falls below the reference ${baseline.goalEstimate.probability}`);
  assert.ok(result.search!.evaluated < 50, 'local exploration reserves full evaluations for its finalists');
});

test('the final recommendation finds the Maruzensky upgrade without an extra pin', async () => {
  const saved = defaultState(data);
  const shared = await decodeShare('3dXZHJbUMxDEQbIoKZ0fZdi6AOjNzSf0BKtj99GjzuyyTQQPv9ez5tqphsThjXWjanwA4aTIZlUx6sDwK1yfhGqt8RYEal4E7eUDXlUl-Va8J2SnFX5iOhkL0jY8vYM5aMpy_v9yhWrFn_XETH4DHNmtGzqz2MNWy-qJv60Xr02opYa9Jq-Bz6y-_5xZus14_2DGfycwt_RQlj8XGcQlrR3sN_LEhXmAcjcyBIw0W6PIQlCLUF-RvO-b1VVCV2iLx4DIWfsf4B');
  Object.assign(saved.run, shared.run);
  // Search evaluates its derived list. Custom extras can change the displayed rank after selection.
  saved.run.wishlistOrder = [];
  saved.run.wishlistExcluded = [];
  Object.assign(saved.settings, shared.settings);
  saved.inventory = {
    ...Object.fromEntries(data.cards.map((c) => [c.id, 4])),
    30002: 0, 30003: 0, 30004: null, 30007: null, 30008: null, 30014: 0, 30015: null,
    30017: 0, 30018: 1, 30020: null, 30024: 0, 30027: null, 30039: null, 30042: null,
    30045: 1, 30047: 3, 30052: 2, 30056: 0, 30057: 3, 30064: null, 30067: null,
    30078: null, 30083: null, 30084: null, 30089: null, 30095: null, 30101: 1, 30105: 1,
    30106: null, 30114: 0, 30115: null, 30116: null, 30120: null,
  };
  const reference = [30078, 30052, 30107, 20005, 20044, 20009]
    .map((id, i) => ({ id, lb: id === 30052 ? 2 : 4, borrowed: i === 0 }));
  const baseline = planRun(saved.run, saved.settings, saved.inventory, data, { selection: reference, search: false });
  const result = planRun(saved.run, saved.settings, saved.inventory, data);
  assert.deepEqual(saved.run.pinnedIds, [30052], 'Maruzensky is available without being pinned');
  assert.ok(result.goalEstimate.probability! >= baseline.goalEstimate.probability! * (1 - saved.settings.goalTieTolerance),
    `${result.goalEstimate.probability} falls below the single-card upgrade ${baseline.goalEstimate.probability}`);
  assert.ok(result.search!.evaluated < 50, 'only promising replacements need full evaluation');
});
