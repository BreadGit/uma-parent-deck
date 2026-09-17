import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { defaultState, type AppState } from '../src/state.ts';
import { planRun, type DeckSelection } from '../src/model/run.ts';

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
