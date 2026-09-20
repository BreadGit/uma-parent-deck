import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { statMasses, statMoments, displayedStat } from '../src/model/stat-outcomes.ts';
import { purchasesFromForms } from '../src/model/skill-purchases.ts';
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

test('purchases: every owned form is bought at full price; only the highest form is rated, prerequisites are paid, and independent spreads add', () => {
  assert.equal(focus.white!.name, 'Focus');
  assert.equal(focus.white!.rating, 129);
  assert.equal(focus.gold!.rating, 394);
  const upgraded = { ...focus, white: { ...focus.white!, tags: [], cost: 20, rating: 100 }, circle: null, gold: { ...focus.gold!, tags: [], cost: 80, rating: 260 } };
  const other = { ...focus, id: 2, circle: null, gold: null, white: { ...focus.white!, id: 3, tags: [], cost: 60, rating: 130 } };
  const one = purchasesFromForms([upgraded], { count: 1, components: [{ indices: [0], distribution: { states: new Map([['3', .5], ['1', .25], ['0', .25]]), approximate: false } }] }, apt);
  assert.equal(one.score, .5 * 260 + .25 * 100, 'the highest form owned is rated');
  assert.ok(Math.abs(one.variance - (.5 * 260 ** 2 + .25 * 100 ** 2 - one.score ** 2)) < 1e-9);
  assert.equal(one.spent, 100, 'the gold form pays its white prerequisite, whatever the budget');
  assert.equal(one.incomplete, false);
  const two = purchasesFromForms([upgraded, other], { count: 2, components: [
    { indices: [0], distribution: { states: new Map([['1', .5], ['0', .5]]), approximate: false } },
    { indices: [1], distribution: { states: new Map([['1', 1]]), approximate: false } },
  ] }, apt);
  assert.equal(two.score, .5 * 100 + 130);
  assert.equal(two.variance, .5 * 100 ** 2 - 50 ** 2, 'a certain purchase adds no spread');
  assert.equal(two.spent, 20 + 60);
  const never = purchasesFromForms([upgraded], { count: 1, components: [{ indices: [0], distribution: { states: new Map([['0', 1]]), approximate: false } }] }, apt);
  assert.deepEqual(never, { score: 0, variance: 0, spent: 0, incomplete: false, unverified: [] });
  const unpriced = { ...other, white: { ...other.white, cost: null, rating: undefined } };
  const unknown = purchasesFromForms([unpriced], { count: 1, components: [{ indices: [0], distribution: { states: new Map([['1', .3], ['0', .7]]), approximate: false } }] }, apt);
  assert.equal(unknown.incomplete, true);
  assert.deepEqual(unknown.unverified, [unpriced.white.id], 'an owned form without a rating is reported');
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
  assert.equal(p.rank.skillPts, p.purchases.score + p.rank.uniquePts);
  assert.ok(p.rawFinalSd.some((sd, i) => sd > p.pred.sd[i]!), 'inheritance uncertainty reaches the final distribution');
  // Keep the five owned cards and compare two real borrowed alternatives. Within the tie tolerance,
  // preferred sparks prefer Throne's Assemblage despite Biko's higher blue chance.
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
  assert.ok(suggested.goalEstimate.blue < biko.goalEstimate.blue);
  // Biko's chance is within the tie tolerance, so the preferred sparks decide for Throne's Assemblage.
  assert.ok(suggested.goalEstimate.probability! >= biko.goalEstimate.probability! * (1 - settings.goalTieTolerance));
  assert.ok(Math.abs(suggested.search!.score.probability - suggested.goalEstimate.probability!) < 1e-12);
});
