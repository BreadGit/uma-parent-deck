import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { statMasses, statMoments, displayedStat } from '../src/model/stat-outcomes.ts';
import { buySkills, budgetForms, purchaseCost } from '../src/model/skill-purchases.ts';
import { resolveTarget } from '../src/model/sparks.ts';
import { inheritedFromSparks } from '../src/model/inherit.ts';
import { decodeShare } from '../src/share.ts';
import { planRun, predictRunDeck } from '../src/model/run.ts';
import { phi } from '../src/model/stats.ts';
import { MAX_STAT_VALUE } from '../src/model/rules.ts';

const data = loadData();
const apt = data.characters[0]!.aptitudes;
const focus = resolveTarget(200432, data)!;

test('raw totals convert once including base and inheritance, then cap', () => {
  // Independently recorded workbook rows, rather than expected values from the model.
  assert.equal(displayedStat(692 + 417 + 120 + 112), 1270);
  assert.equal(displayedStat(690 + 446 + 4 + 83), 1211);
  assert.equal(displayedStat(1201), 1200);
  assert.equal(displayedStat(1202), 1201);
  assert.deepEqual(statMasses(1400, 0, 1250, true), [{ value: 1250, probability: 1 }]);
  assert.equal(statMoments(statMasses(1400, 40, 1099, true)).above(1100), 0);
  const normal = statMoments(statMasses(1099.5, 25, 1600, true));
  assert.ok(Math.abs(normal.above(1100) - .5) < 1e-6, 'integer threshold includes the half-point continuity boundary');
  const capped = statMasses(1400, 40, 1250, true);
  assert.ok(Math.abs(capped.reduce((sum, x) => sum + x.probability, 0) - 1) < 1e-10);
  assert.ok(statMoments(capped).sd < 20, 'conversion and caps reduce displayed spread');
});

test('reusing normal boundaries preserves every rounded probability, including the tails', () => {
  for (const rawUnits of [false, true]) for (const mean of [-1.5, 0, .5, 599.5, 1099.5, 1200.5, 1400, 2000]) {
    for (const sd of [.1, 25, 120]) for (const cap of [600, 1099, 1250, Infinity]) {
      const maximum = Math.min(cap, MAX_STAT_VALUE);
      const boundary = (value: number) => ((rawUnits && value > 1200 ? 1200 + 2 * (value - 1200) : value) - .5 - mean) / sd;
      // Direct integration for each bin, independent of the shared-boundary optimization.
      const expected = Array.from({ length: maximum + 1 }, (_, value) => {
        const lower = value === 0 ? -Infinity : boundary(value);
        const upper = value === maximum ? Infinity : boundary(value + 1);
        return { value, probability: lower > 0 ? phi(-lower) - phi(-upper) : phi(upper) - phi(lower) };
      }).filter(({ probability }) => probability > 0);
      assert.deepEqual(statMasses(mean, sd, cap, rawUnits), expected, `mean=${mean}, sd=${sd}, cap=${cap}, raw=${rawUnits}`);
    }
  }
});

test('inspiration variance includes both roll variance and failed procs', () => {
  const one = inheritedFromSparks([1], { ...DEFAULT_SETTINGS, affinity: 0 });
  // Two independent events, proc p=.7, uniform integer roll 1..10, mean5.5 variance8.25.
  assert.ok(Math.abs(one.variance - 24.255) < 1e-10);
  assert.equal(inheritedFromSparks([], DEFAULT_SETTINGS).variance, 0);
});

test('individual skill values, hint floors, gold prerequisites and replacement rating', () => {
  assert.equal(focus.white!.name, 'Focus');
  assert.equal(focus.white!.rating, 129);
  assert.equal(focus.gold!.rating, 394);
  assert.equal(purchaseCost({ ...focus.white!, cost: 139 }, 1), 125);
  assert.equal(purchaseCost({ ...focus.white!, cost: 90 }, 3), 63, 'integer percentages avoid rounding 90 times .7 down to 62');
  assert.deepEqual(buySkills([focus], '3', 252, [focus.id], apt, 1), { state: '3', score: 394, spent: 252 });
  assert.deepEqual(buySkills([focus], '3', 251, [focus.id], apt, 1), { state: '1', score: 129, spent: 126 });
  assert.deepEqual(buySkills([focus], '0', 10000, [focus.id], apt, 1), { state: '0', score: 0, spent: 0 });
  assert.equal(buySkills([focus], '3', 126, [focus.id], apt, 1, new Set([focus.white!.id])).spent, 0, 'unhinted innate skills keep full cost');
});

test('a shared SP budget preserves rare outcomes and excludes unaffordable joint purchases', () => {
  const other = resolveTarget(200352, data)!;
  const bought = budgetForms([focus, other], { count: 2, components: [
    { indices: [0, 1], distribution: { states: new Map([['11', 1 - 1e-9], ['01', 1e-9]]), approximate: false } },
  ] }, 170, [focus.id, other.id], apt, 0);
  assert.deepEqual([...bought.forms.components[0]!.distribution.states], [['10', 1 - 1e-9], ['01', 1e-9]]);
  assert.ok(bought.spent <= 170);
  assert.equal(bought.forms.components[0]!.distribution.approximate, false);
});

test('greedy purchases reprice upgrades, preserve ties and skip unaffordable choices', () => {
  const upgraded = { ...focus, white: { ...focus.white!, tags: [], cost: 20, rating: 100 },
    gold: { ...focus.gold!, tags: [], cost: 80, rating: 260 } };
  const other = { ...focus, id: 2, gold: null, white: { ...focus.white!, tags: [], cost: 60, rating: 130 } };
  // The base's ratio is 5. Buying it drops its gold upgrade from 2.6 to 2, below the other skill's 130/60.
  assert.deepEqual(buySkills([upgraded, other], '31', 100, [], apt, 0), { state: '11', score: 230, spent: 80 });
  const tied = { ...other, white: { ...other.white, cost: 40, rating: 80 } };
  assert.deepEqual(buySkills([upgraded, tied], '31', 100, [], apt, 0), { state: '30', score: 260, spent: 100 });
  assert.deepEqual(buySkills([tied, upgraded], '13', 100, [], apt, 0), { state: '11', score: 180, spent: 60 });
  // A higher-ratio upgrade no longer fits after the base purchase, but the other base does.
  assert.deepEqual(buySkills([upgraded, tied], '31', 60, [], apt, 0), { state: '11', score: 180, spent: 60 });
});

test('purchase outcomes reset spent points and upgrades while retaining priority order', () => {
  const upgraded = { ...focus, white: { ...focus.white!, tags: [], cost: 20, rating: 100 },
    gold: { ...focus.gold!, tags: [], cost: 80, rating: 260 } };
  const other = { ...focus, id: 2, gold: null, white: { ...focus.white!, tags: [], cost: 40, rating: 80 } };
  const result = budgetForms([upgraded, other], { count: 2, components: [
    { indices: [0, 1], distribution: { states: new Map([['31', .25], ['30', .25], ['01', .25], ['00', .25]]), approximate: false } },
  ] }, 100, [other.id, upgraded.id], apt, 0);
  // With both skills available, their required bases leave only 40 SP for an 80 SP upgrade.
  // Without the other skill, the same budget buys the gold form for 100 SP.
  assert.deepEqual([...result.forms.components[0]!.distribution.states], [['11', .25], ['30', .25], ['01', .25], ['00', .25]]);
  assert.equal(result.score, 130);
  assert.equal(result.variance, 9700);
  assert.equal(result.spent, 50);
});

test('large purchase samples balance every independent source, including late dimensions', () => {
  const targets = Array.from({ length: 60 }, (_, i) => ({ ...focus, id: i + 1 }));
  const forms = { count: targets.length, components: targets.map((_, i) => ({ indices: [i],
    distribution: { states: new Map([['0', .5], ['1', .5]]), approximate: false } })) };
  const result = budgetForms(targets, forms, 100000, [], apt, 0, 32);
  assert.equal(result.score, 60 * .5 * 129);
  const states = result.forms.components[0]!.distribution.states;
  for (let i = 0; i < targets.length; i++) assert.equal([...states].reduce((p, [s, mass]) => p + (s[i] === '1' ? mass : 0), 0), .5);
  assert.equal(result.forms.components[0]!.distribution.approximate, true);
});

test('sampled purchases preserve linked forms at interleaved indices and fixed outcomes', () => {
  const targets = Array.from({ length: 9 }, (_, i) => ({ ...focus, id: i + 1 }));
  const forms = { count: targets.length, components: [
    { indices: [0, 4], distribution: { states: new Map([['30', .5], ['03', .5]]), approximate: false } },
    { indices: [8, 2], distribution: { states: new Map([['31', 1]]), approximate: false } },
    { indices: [1, 6], distribution: { states: new Map([['10', .5], ['01', .5]]), approximate: false } },
    { indices: [3, 7], distribution: { states: new Map([['13', .5], ['31', .5]]), approximate: false } },
    { indices: [5], distribution: { states: new Map([['0', 1]]), approximate: false } },
  ] };
  const before = structuredClone(forms);
  // Eight combinations exceed the four-sample limit, so this exercises sampled assembly.
  const result = budgetForms(targets, forms, 100000, [], apt, 0, 4);
  for (const state of result.forms.components[0]!.distribution.states.keys()) {
    assert.ok(['30', '03'].includes(state[0]! + state[4]!), 'exclusive gold rewards stay exclusive');
    assert.equal(state[8]! + state[2]! + state[5]!, '310', 'fixed outcomes survive every sample');
    assert.ok(['10', '01'].includes(state[1]! + state[6]!));
    assert.ok(['13', '31'].includes(state[3]! + state[7]!));
  }
  assert.equal(result.score, 3 * 394 + 3 * 129);
  assert.equal(result.spent, 3 * 280 + 3 * 140);
  assert.equal(result.variance, 0);
  assert.deepEqual(forms, before, 'sampling does not mutate shared source outcomes');
  assert.deepEqual(budgetForms(targets, forms, 100000, [], apt, 0, 4), result, 'sampling remains deterministic');
});

test('reported Fuji build counts 22 races and shares one probability basis', async () => {
  const shared = await decodeShare('3dXZHJbUMxDEQbIoKZ0fZdi6AOjNzSf0BKtj99GjzuyyTQQPv9ez5tqphsThjXWjanwA4aTIZlUx6sDwK1yfhGqt8RYEal4E7eUDXlUl-Va8J2SnFX5iOhkL0jY8vYM5aMpy_v9yhWrFn_XETH4DHNmtGzqz2MNWy-qJv60Xr02opYa9Jq-Bz6y-_5xZus14_2DGfycwt_RQlj8XGcQlrR3sN_LEhXmAcjcyBIw0W6PIQlCLUF-RvO-b1VVCV2iLx4DIWfsf4B');
  const selection = [[30052, 2], [20031, 4], [20005, 4], [30107, 4], [30017, 0], [30078, 4]].map(([id, lb], i) => ({ id: id!, lb: lb!, borrowed: i === 5 }));
  const p = planRun({ ...shared.run, raceOverrides: shared.run.raceOverrides ?? {} }, { ...DEFAULT_SETTINGS, ...shared.settings }, {}, data, { selection, search: false });
  assert.equal(p.sum.count, 19);
  assert.equal(p.ctx.races, 22);
  assert.equal(p.goalEstimate.pSS, p.rank.pSS);
  assert.ok(p.statChances[2]!.high > .45 && p.statChances[2]!.high < .6, 'the reported 1091 and 1083 outcomes are plausible');
  assert.ok(Math.abs(p.finalMean[2]! - 1101) < 1);
  assert.ok(p.purchases.spent <= p.pred.sp);
  assert.equal(p.rank.skillPts, p.purchases.score + p.rank.uniquePts);
  assert.ok(p.rawFinalSd.some((sd, i) => sd > p.pred.sd[i]!), 'inheritance uncertainty reaches the final distribution');
  // Keep the five owned cards and compare two real borrowed alternatives. The corrected
  // purchase/rank model prefers Throne's Assemblage despite Biko's higher blue chance.
  const owned = selection.slice(0, 5), candidateIds = [...owned.map((e) => e.id), 30020, 30067];
  const limited = { ...data, cards: data.cards.filter((c) => candidateIds.includes(c.id)) };
  const inventory = Object.fromEntries([...owned.map((e) => [String(e.id), e.lb]), ['30020', null], ['30067', null]]);
  const input = { ...shared.run, raceOverrides: shared.run.raceOverrides ?? {}, pinnedIds: owned.map((e) => e.id), borrowFromAll: true };
  const settings = { ...DEFAULT_SETTINGS, ...shared.settings };
  const suggested = planRun(input, settings, inventory, limited);
  const biko = planRun(input, settings, inventory, limited, { selection: [...owned, { id: 30020, lb: 4, borrowed: true }], search: false });
  assert.equal(suggested.deckResult.deck.find((e) => e.borrowed)!.card.id, 30067);
  const prediction = predictRunDeck(suggested.deckResult.deck, input, suggested.ctx, suggested.apt, suggested.sum.expectedLosses);
  for (const key of ['pred', 'parentGains', 'inherited', 'rawFinalMean', 'rawFinalSd', 'finalMean', 'finalSd', 'statChances', 'purchases', 'statCaps'] as const) {
    assert.deepEqual(suggested[key], prediction[key], `the chosen deck retains its full ${key} summary`);
  }
  assert.deepEqual(suggested.rank, { ...prediction.rank, pSS: suggested.goalEstimate.pSS });
  assert.ok(suggested.rank.pSS > biko.rank.pSS);
  assert.ok(suggested.goalEstimate.blue < biko.goalEstimate.blue);
  assert.ok(suggested.goalEstimate.probability! > biko.goalEstimate.probability!);
  assert.ok(Math.abs(suggested.search!.score.probability - suggested.goalEstimate.probability!) < 1e-12);
});
