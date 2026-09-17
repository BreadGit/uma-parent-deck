import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from './helpers.ts';
import { chooseGoal, scoreGoal, type GoalScore } from '../src/model/goal-objective.ts';
import { searchGoalDeck, goalDeckKey, type GoalDeckEntry } from '../src/model/goal-deck.ts';
import { goalRankBands, type GoalRankBands } from '../src/model/goal.ts';
import { projectForms, subsetGeneration, type FormDistribution } from '../src/model/goal-skills.ts';
import { DEFAULT_GOAL, type ResolvedGoal } from '../src/model/goal-input.ts';
import { DEFAULT_SETTINGS, parseSetting } from '../src/settings.ts';
import { defaultState, migrate } from '../src/state.ts';
import { loadData } from '../src/data.ts';
import { planRun } from '../src/model/run.ts';
import type { Card } from '../src/types.ts';

const data = loadData();
const settings = { ...DEFAULT_SETTINGS, whiteSparkRate: 1, whiteStarsBelowB: [0, 1, 0] };
const goal: ResolvedGoal = { ...DEFAULT_GOAL, blueStars: 1, required: [], preferred: [] };
const basis: GoalRankBands = { blue: 1, rank: [1, 0, 0, 0], blueRank: [1, 0, 0, 0], pSS: 0, approximateRank: 1 };
const pink = { probability: 1, upperProbability: 1, warnings: [], eligibility: [] };
const distribution = (count: number, states: [string, number][]): FormDistribution => ({ count, components: [{ indices: Array.from({ length: count }, (_, i) => i), distribution: { states: new Map(states), approximate: false } }] });
const score = (p: number, preferred = 0, count = 2): GoalScore => ({ count, total: 2, comparison: p, probability: p, upperProbability: p, preferred, whiteIds: [], blue: true, pink: true, approximate: false, subsetApproximate: false });
const candidate = (key: string, p: number, preferred = 0) => ({ key, score: score(p, preferred), statPower: 0 });

test('relative ties stay anchored to the best chance, including rare goals and zero tolerance', () => {
  const c = [candidate('best', .1), candidate('edge', .1 * .999, 1), candidate('drift', .1 * .9985, 2)];
  for (const order of [c, [...c].reverse(), [c[1]!, c[2]!, c[0]!]]) {
    assert.equal(chooseGoal(order, .001).key, 'edge');
    assert.equal(chooseGoal(order, 0).key, 'best');
  }
  assert.equal(chooseGoal([candidate('best', 1e-20), candidate('close', 1e-20 * .999, 1), candidate('far', 1e-20 * .998, 2)], .001).key, 'close');
  assert.equal(chooseGoal([candidate('zero', 0, 99), candidate('tiny', 1e-30)], 1).key, 'tiny');
});

test('preferred extras count on successful parents and preserve shared source outcomes', () => {
  const g = { ...goal, required: [{ id: 10, stars: 1 }], preferred: [{ id: 11, priority: 0 }] };
  const a = scoreGoal(g, { copies: [0, 0], forms: distribution(2, [['11', .01], ['10', .09], ['01', .29], ['00', .61]]) }, basis, pink, settings);
  const b = scoreGoal(g, { copies: [0, 0], forms: distribution(2, [['11', .06], ['10', .04], ['01', .04], ['00', .86]]) }, basis, pink, settings);
  assert.ok(Math.abs(a.comparison - .1) < 1e-12);
  assert.ok(Math.abs(a.preferred - .1) < 1e-12);
  assert.ok(Math.abs(b.preferred - .6) < 1e-12);
  assert.equal(chooseGoal([{ key: 'a', score: a, statPower: 0 }, { key: 'b', score: b, statPower: 0 }], .001).key, 'b');
});

test('preferred appearances retain required blue and rank coupling without an extra star condition', () => {
  const g = { ...goal, required: [{ id: 10, stars: 2 }], preferred: [{ id: 11, priority: 0 }] };
  const shared = { ...basis, blue: .6, rank: [0, .5, .5, 0], blueRank: [0, .2, .4, 0] };
  const result = scoreGoal(g, { copies: [0, 0], forms: distribution(2, [['11', 1]]) }, shared, pink, settings);
  assert.ok(Math.abs(result.comparison - (.2 * .5 + .4 * .8)) < 1e-12);
  assert.ok(Math.abs(result.preferred - 1) < 1e-12);
});

test('a zero required spark preserves the other required goals; uncertain pink is not discarded', () => {
  const g = { ...goal, required: [{ id: 10, stars: 2 }, { id: 11, stars: 2 }] };
  const sources = { copies: [0, 0], forms: distribution(2, [['10', .4], ['00', .6]]) };
  const result = scoreGoal(g, sources, basis, { ...pink, probability: 0, upperProbability: .3 }, settings);
  assert.deepEqual(result.whiteIds, [10]);
  assert.equal(result.count, 3);
  assert.equal(result.total, 4);
  assert.equal(result.comparison, .4);
  assert.equal(result.probability, 0);
  assert.equal(result.upperProbability, .12);
  const impossiblePink = scoreGoal(g, sources, basis, { ...pink, probability: 0, upperProbability: 0 }, settings);
  assert.equal(impossiblePink.count, 2);
  assert.equal(impossiblePink.probability, .4);
});

test('mutually exclusive required families choose the largest jointly possible subset', () => {
  const g = { ...goal, required: [{ id: 10, stars: 1 }, { id: 11, stars: 1 }, { id: 12, stars: 1 }] };
  const result = scoreGoal(g, { copies: [0, 0, 0], forms: distribution(3, [['110', .3], ['101', .7]]) }, basis, pink, settings);
  assert.equal(result.count, 4);
  assert.deepEqual(result.whiteIds, [10, 12]);
  assert.equal(result.comparison, .7);
});

test('projected marginals and required intersections use the original shared sample', () => {
  const forms = distribution(3, [['111', .2], ['101', .3], ['000', .5]]);
  forms.components[0]!.distribution.approximate = true;
  const projected = projectForms(forms, [2, 0]);
  assert.equal(subsetGeneration(forms, [0, 0, 0], [0, 2], settings), .5);
  assert.equal(subsetGeneration(projected, [0, 0], [0, 1], settings), .5);
  assert.equal(projected.components[0]!.distribution.approximate, true);
});

test('a bounded conflict search still retains achievable requirements', () => {
  const count = 12;
  const g = { ...goal, required: Array.from({ length: count }, (_, id) => ({ id, stars: 1 })) };
  const forms = distribution(count, g.required.map((_, i) => ['0'.repeat(i) + '1' + '0'.repeat(count - i - 1), 1 / count]));
  const result = scoreGoal(g, { copies: Array(count).fill(0), forms }, basis, pink, settings);
  assert.equal(result.subsetApproximate, true);
  assert.equal(result.count, 3, 'blue, pink and one of the mutually exclusive white sparks');
  assert.ok(Math.abs(result.comparison - 1 / count) < 1e-12);
});

test('fallback subset scoring does not spend the relative tie window before deck comparison', () => {
  const g = { ...goal, required: [{ id: 10, stars: 1 }, { id: 11, stars: 1 }], preferred: [{ id: 12, priority: 0 }] };
  const forms = distribution(3, [['101', .1], ['010', .10005], ['000', .79995]]);
  const result = scoreGoal(g, { copies: [0, 0, 0], forms }, basis, pink, settings);
  assert.deepEqual(result.whiteIds, [11]);
  assert.equal(result.comparison, .10005);
});

const card = (id: number, charId = id): GoalDeckEntry => ({ card: { ...data.cards[0]!, id, charId } as Card, lb: 4 });
test('small search matches independent exhaustive enumeration and respects borrow and pin constraints', () => {
  const owned = [card(1), card(2), card(3), card(4)], borrows = [card(5), card(6), card(7, 1)];
  const value = (entries: GoalDeckEntry[]) => entries.reduce((n, e) => n + e.card.id, 0) + (entries.some((e) => e.card.id === 2) && entries.some((e) => e.card.id === 3) ? 10 : 0);
  const found = searchGoalDeck({ owned, borrows, ownedOrders: [owned], borrowOrders: [borrows], pinnedIds: [1], borrowFromAll: false,
    traineeId: null, size: 3, tolerance: 0, evaluate: (entries) => ({ score: score(value(entries) / 100), statPower: 0, value: null }) })!;
  const all: GoalDeckEntry[][] = [];
  for (const a of owned) for (const b of owned) for (const c of borrows) {
    if (a.card.id >= b.card.id || new Set([a.card.charId, b.card.charId, c.card.charId]).size < 3) continue;
    if (![a, b].some((e) => e.card.id === 1)) continue;
    all.push([a, b, { ...c, borrowed: true }]);
  }
  const maximum = Math.max(...all.map(value));
  assert.equal(found.best.score.comparison, maximum / 100);
  assert.equal(found.evaluated, all.length);
  assert.ok(found.exhaustive);
  assert.equal(found.best.entries.filter((e) => e.borrowed).length, 1);
  assert.ok(found.best.entries.some((e) => !e.borrowed && e.card.id === 1));
});

test('a stat card with no target hints wins by crossing the required blue threshold', () => {
  const owned = [card(1), card(2), card(3)];
  const power = new Map([[1, 250], [2, 250], [3, 350]]);
  const g = { ...goal, blueStats: ['speed' as const], blueStars: 3 };
  const found = searchGoalDeck({ owned, borrows: [], ownedOrders: [owned], borrowOrders: [], pinnedIds: [], borrowFromAll: false,
    traineeId: null, size: 2, tolerance: 0, evaluate: (entries) => {
      const total = entries.reduce((n, e) => n + power.get(e.card.id)!, 0);
      const rank = goalRankBands({ rawMean: [total, 0, 0, 0, 0], sd: [0, 0, 0, 0, 0], skillPoints: 0, skillSd: 0 }, g, 17500, settings);
      return { score: scoreGoal(g, { copies: [], forms: { count: 0, components: [] } }, rank, pink, settings), statPower: total, value: null };
    } })!;
  assert.ok(found.best.entries.some((e) => e.card.id === 3));
  assert.ok(Math.abs(found.best.score.comparison - .01) < 1e-12);
});

test('balanced required coverage beats a larger sum of individual spark chances', () => {
  const owned = [card(1), card(2), card(3)];
  const g = { ...goal, required: [{ id: 10, stars: 1 }, { id: 11, stars: 1 }] };
  const found = searchGoalDeck({ owned, borrows: [], ownedOrders: [owned], borrowOrders: [], pinnedIds: [1], borrowFromAll: false,
    traineeId: null, size: 2, tolerance: .001, evaluate: (entries) => {
      const rates = entries.some((e) => e.card.id === 2) ? [.6, .6] : [.99, .3];
      const forms: FormDistribution = { count: 2, components: rates.map((p, i) => ({ indices: [i], distribution: { states: new Map([['1', p], ['0', 1 - p]]), approximate: false } })) };
      return { score: scoreGoal(g, { forms, copies: [0, 0] }, basis, pink, settings), statPower: 0, value: null };
    } })!;
  assert.ok(found.best.entries.some((e) => e.card.id === 2));
  assert.equal(found.best.score.comparison, .36);
});

test('a requirement missing from the first deck is recovered before any partial-goal fallback wins', () => {
  const owned = [card(1), card(2), card(3)];
  const g = { ...goal, required: [{ id: 10, stars: 1 }, { id: 11, stars: 1 }] };
  const found = searchGoalDeck({ owned, borrows: [], ownedOrders: [owned], borrowOrders: [], pinnedIds: [1], borrowFromAll: false,
    traineeId: null, size: 2, tolerance: .001, evaluate: (entries) => {
      const complete = entries.some((e) => e.card.id === 3);
      const forms = complete ? distribution(2, [['11', .001], ['00', .999]]) : distribution(2, [['10', 1]]);
      return { score: scoreGoal(g, { forms, copies: [0, 0] }, basis, pink, settings), statPower: 0, value: null };
    } })!;
  assert.ok(found.best.entries.some((e) => e.card.id === 3));
  assert.equal(found.best.score.count, 4);
  assert.equal(found.best.score.comparison, .001);
});

test('tight goal tolerance migrates, validates and can be overridden', () => {
  assert.equal(migrate({ current: { version: 15, settings: {} } }, data).settings.goalTieTolerance, .001);
  assert.equal(parseSetting('goalTieTolerance', '0'), 0);
  assert.equal(parseSetting('goalTieTolerance', '1'), 1);
  for (const invalid of ['-1', '1.1', 'NaN']) assert.equal(parseSetting('goalTieTolerance', invalid), undefined);
  assert.equal(migrate({ current: { version: 15, settings: { goalTieTolerance: .02 } } }, data).settings.goalTieTolerance, .02);
});

test('required targets outrank custom preferred ordering and excluded choices remain excluded', () => {
  const saved = defaultState(data);
  const focus = must(data.skills.find((s) => s.name === 'Focus'), `data.skills.find((s) => s.name === 'Focus')`);
  const falcon = must(data.cards.find((c) => c.charName === 'Smart Falcon' && c.rarity === 'SSR' && c.type === 'power'), `data.cards.find((c) => c.charName === 'Smart Falcon' && c.rarity === 'SSR' && c.type ==...`);
  saved.run.traineeCardId = 100101;
  saved.run.pinnedIds.push(falcon.id);
  saved.run.targets = [{ id: 201601, role: 'required', stars: 2, priority: 0 }, { id: focus.id, role: 'preferred', stars: 2, priority: 0 }];
  saved.run.wishlistOrder = [focus.id, 201601];
  const preferredFirst = structuredClone(saved.run.wishlistOrder);
  const plan = planRun(saved.run, saved.settings, saved.inventory, data, { budget: 8 });
  assert.equal(plan.wl[0]!.skillId, 201601);
  assert.equal(plan.deckResult.conflicts.find((c) => c.eventKey.startsWith(`${falcon.id}:chain`))?.taken.target, 201601);
  assert.deepEqual(saved.run.wishlistOrder, preferredFirst);
  saved.run.wishlistExcluded = [201601];
  const excluded = planRun(saved.run, saved.settings, saved.inventory, data, { budget: 8 });
  assert.ok(excluded.priorityIssues.some((s) => s.includes('Groundwork')));
  assert.ok(!excluded.wl.some((w) => w.skillId === 201601));
  assert.ok(!excluded.deckResult.coverage.get(201601)!.some((s) => s.isChoice && s.skillId === 201601));
});

test('complete search and displayed goal agree; fallback preserves the original requirements', () => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  saved.run.targets = [{ id: 200352, role: 'required', stars: 2, priority: 0 }, { id: 201601, role: 'preferred', stars: 2, priority: 0 }];
  const full = planRun(saved.run, saved.settings, saved.inventory, data, { budget: 16 });
  assert.ok(Math.abs(full.goalEstimate.probability! - full.search!.score.probability) < 1e-12);
  const selection = full.deckResult.deck.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: e.borrowed }));
  const restored = planRun(saved.run, saved.settings, saved.inventory, data, { selection, summary: full.search! });
  assert.equal(goalDeckKey(restored.deckResult.deck), goalDeckKey(full.deckResult.deck));
  assert.equal(restored.goalEstimate.probability, full.goalEstimate.probability);
  saved.run.targets.push({ id: must(data.skills.find((s) => s.name === 'Runaway'), `data.skills.find((s) => s.name === 'Runaway')`).id, role: 'required', stars: 2, priority: 0 });
  const before = structuredClone(saved.run);
  const fallback = planRun(saved.run, saved.settings, saved.inventory, data, { budget: 16 });
  assert.equal(fallback.goalEstimate.probability, 0);
  assert.equal(fallback.search!.score.count, 3);
  assert.ok(fallback.search!.score.probability > 0);
  assert.deepEqual(saved.run, before);
});

test('an excluded required skill keeps its warning when the deck has no source for it', () => {
  const saved = defaultState(data);
  const id = must(data.skills.find((s) => s.name === 'Runaway'), `data.skills.find((s) => s.name === 'Runaway')`).id;
  saved.run.traineeCardId = 100101;
  saved.run.targets = [{ id, role: 'required', stars: 2, priority: 0 }];
  saved.run.wishlistExcluded = [id];
  const result = planRun(saved.run, saved.settings, saved.inventory, data, { search: false });
  assert.deepEqual(result.wlExcluded, [], 'this deck does not offer the excluded skill');
  assert.ok(result.priorityIssues.some((s) => s.includes('Runaway is required but excluded')));
});

test('screening scores never replace fully evaluated scores or discard a stronger incumbent', () => {
  const owned = Array.from({ length: 30 }, (_, i) => card(i + 1));
  const actual = (entries: GoalDeckEntry[]) => entries.some((e) => e.card.id === 2) ? .8 : .1;
  const progress: number[] = [];
  const found = searchGoalDeck({ owned, borrows: [], ownedOrders: [owned], borrowOrders: [],
    pinnedIds: [1], borrowFromAll: false, traineeId: null, size: 2, tolerance: 0, budget: 1, screenBudget: 128,
    seeds: [[owned[0]!, owned[1]!]],
    evaluate: (entries) => ({ score: score(actual(entries)), statPower: 0, value: null }),
    screen: (entries) => ({ score: score(actual(entries) === .8 ? .01 : .99), statPower: 0 }),
    onProgress: (result) => progress.push(result.best.score.probability),
  })!;
  assert.deepEqual(progress, [.8]);
  assert.ok(found.screened > 1);
  assert.equal(found.best.score.probability, .8);
  for (const c of found.candidates) assert.equal(c.score.probability, actual(c.entries));
});

test('many owned cards with five fixed pins still use exhaustive search when only two decks are legal', () => {
  const owned = Array.from({ length: 30 }, (_, i) => card(i + 1)), borrows = [card(31), card(32)];
  const found = searchGoalDeck({ owned, borrows, ownedOrders: [owned], borrowOrders: [borrows],
    pinnedIds: [1, 2, 3, 4, 5], borrowFromAll: false, traineeId: null, tolerance: 0,
    evaluate: (entries) => ({ score: score(must(entries.find((e) => e.borrowed), `entries.find((e) => e.borrowed)`).card.id / 100), statPower: 0, value: null }),
    screen: () => { throw new Error('Small legal spaces do not need screening'); },
  })!;
  assert.equal(found.evaluated, 2);
  assert.ok(found.exhaustive);
  assert.equal(found.screened, 0);
  assert.equal(found.best.score.probability, .32);
});

test('screening can exchange competing pins without weakening the pin constraint', () => {
  const owned = Array.from({ length: 30 }, (_, i) => card(i + 1));
  const rate = (entries: GoalDeckEntry[]) => entries.some((e) => e.card.id === 30) ? .9 : .1;
  const found = searchGoalDeck({ owned, borrows: [], ownedOrders: [owned], borrowOrders: [],
    pinnedIds: owned.map((e) => e.card.id), borrowFromAll: false, traineeId: null, size: 2, tolerance: 0, budget: 1, screenBudget: 256,
    evaluate: (entries) => ({ score: score(rate(entries)), statPower: 0, value: null }),
    screen: (entries) => ({ score: score(rate(entries)), statPower: 0 }),
  })!;
  assert.ok(found.screened > 1);
  assert.equal(found.best.score.probability, .9);
  assert.ok(found.candidates.every((c) => found.legal(c.entries)));
});

test('cheap rank sampling leaves analytic blue odds and subsequent full evaluations intact', () => {
  const stats = { rawMean: [1000, 900, 800, 700, 600], sd: [50, 50, 50, 50, 50], skillPoints: 5000, skillSd: 400 };
  const full = goalRankBands(stats, goal, 17500, settings);
  const cheap = goalRankBands(stats, goal, 17500, settings, 32);
  assert.equal(cheap.blue, full.blue);
  assert.deepEqual(goalRankBands(stats, goal, 17500, settings), full);
});

// A Fuji Kiseki player reported this six-card deck, Maruzensky borrowed, for a required Groundwork spark.
// Evaluating it as a fixed selection gives the chance the search must reach without being told to pin Maruzensky.
const FUJI_DECK = [30017, 30107, 30052, 30020, 30078, 30083].map((id, i) => ({ id, lb: 4, borrowed: i === 0 }));
const fujiState = () => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100501;
  saved.run.targets = [{ id: 201601, role: 'required', stars: 2, priority: 0 }];
  saved.inventory['30017'] = null;
  return saved;
};
const fujiReference = (saved = fujiState()) => planRun(saved.run, saved.settings, saved.inventory, data, { selection: FUJI_DECK, search: false }).goalEstimate.probability!;

test('Fuji Kiseki finds a deck at least as good as the reported Maruzensky pin without requiring the pin', () => {
  const saved = fujiState();
  const before = structuredClone(saved);
  const reference = fujiReference(saved);
  assert.ok(reference > 0, 'the reported deck is a legal selection with a positive chance');
  const progress: number[] = [];
  const result = planRun(saved.run, saved.settings, saved.inventory, data, { onProgress: (selection, summary) => {
    const check = planRun(saved.run, saved.settings, saved.inventory, data, { selection });
    assert.equal(check.goalEstimate.probability, summary.score.probability);
    progress.push(summary.score.probability);
  } });
  assert.ok(result.goalEstimate.probability! >= reference, `search reached ${result.goalEstimate.probability} against the reported deck's ${reference}`);
  assert.ok(progress.length && result.goalEstimate.probability! >= progress[0]!);
  assert.ok(result.search!.screened > 0);
  assert.ok(!result.deckResult.deck.some((e) => e.card.id === 30017 && !e.borrowed));
  assert.deepEqual(saved, before);
});

test('previous recommendations are rescored at current limit breaks and rejected when they break current ownership or pins', () => {
  const saved = fujiState();
  const previous = FUJI_DECK;
  const reused = planRun(saved.run, saved.settings, saved.inventory, data, { previous, budget: 8 });
  assert.ok(reused.goalEstimate.probability! >= fujiReference(saved), 'a seeded search never falls below its seed');
  saved.inventory['30107'] = 0;
  const changed = planRun(saved.run, saved.settings, saved.inventory, data, { previous, budget: 8 });
  for (const e of changed.deckResult.deck) if (e.card.id === 30107 && !e.borrowed) assert.equal(e.lb, 0);
  saved.inventory['30107'] = null;
  saved.run.pinnedIds.push(30028);
  const invalid = planRun(saved.run, saved.settings, saved.inventory, data, { previous, budget: 8 });
  assert.ok(!invalid.deckResult.deck.some((e) => e.card.id === 30107 && !e.borrowed));
  assert.ok(invalid.deckResult.deck.some((e) => e.card.id === 30028));
});

test('preferred priorities weight any-star appearances without changing required success', () => {
  const g = { ...goal, required: [{ id: 10, stars: 2 }], preferred: [{ id: 11, priority: 0 }, { id: 12, priority: 1 }] };
  const sources = { copies: [0, 0, 0], forms: distribution(3, [['111', .2], ['110', .2], ['101', .1], ['100', .5]]) };
  const lowRank = { ...settings, whiteStarsBelowB: [1, 0, 0] };
  // Required cannot roll 2 stars here; its fallback leaves blue and pink, with .4 + .3/2 preferred score.
  const fallback = scoreGoal(g, sources, basis, pink, lowRank);
  assert.equal(fallback.count, 2);
  assert.ok(Math.abs(fallback.preferred - .55) < 1e-12);
  const original = scoreGoal(g, sources, basis, pink, settings);
  const changed = scoreGoal({ ...g, preferred: [{ id: 11, priority: 2 }, { id: 12, priority: 2 }] }, sources, basis, pink, settings);
  assert.equal(changed.probability, original.probability);
  assert.equal(changed.comparison, original.comparison);
  assert.ok(Math.abs(changed.preferred - .175) < 1e-12);
  const huge = scoreGoal({ ...g, preferred: g.preferred.map((p) => ({ ...p, priority: Number.MAX_SAFE_INTEGER })) }, sources, basis, pink, settings);
  assert.equal(huge.preferred, 0);
  assert.equal(huge.probability, original.probability);
});
