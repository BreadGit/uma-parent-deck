import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from './helpers.ts';
import { loadData } from '../src/data.ts';
import { cardContribution, modelContribution, uniqueExtras } from '../src/model/stats.ts';
import type { StatModel } from '../src/types.ts';
import modelJson from '../data/stat-model.json' with { type: 'json' };

const data = loadData();

test('limit-break adjustments preserve measurements below the fitted floor and cannot become negative', () => {
  const card = structuredClone(must(data.cards.find((c) => c.type === 'pal'), `data.cards.find((c) => c.type === 'pal')`));
  card.unique = null;
  card.effectsByLb = [{}, { 9: 30, 30: 2 }, {}, {}, {}];
  const model: StatModel = { ...data.model, floor: 23, sp: { base: 30, wit: 0, friend: 0, skillPointBonus: 10 },
    observed: [{ cardId: card.id, lb: 1, source: 'test', runs: 20, wellTested: true, stats: [21, 21, 21, 21, 21], sp: 15 }] };
  const adjusted = cardContribution(card, 0, model);
  assert.deepEqual(adjusted.stats, [0, 21, 21, 21, 21]);
  assert.equal(adjusted.sp, 0);
  assert.equal(adjusted.source, 'observed+model');
});

test('additional card inputs affect their fitted outcomes and preserve observed references', () => {
  const card = structuredClone(must(data.cards.find((c) => c.type === 'speed'), `data.cards.find((c) => c.type === 'speed')`));
  card.effectsByLb = [{ 14: 20, 25: 10 }, {}, {}, {}, {}];
  const model: StatModel = { ...data.model, floor: 0, roleConstants: { 'speed.primary': 100, 'speed.secondary': 50 },
    slopes: { fr: 0, mo: 0, te: 0, sb: 0 }, effectSlopes: { 14: 2 },
    sp: { base: 30, wit: 0, friend: 0, skillPointBonus: 0, effectSlopes: { 14: 3, 25: 4 } }, observed: [] };
  assert.deepEqual(modelContribution(card, 0, model), { stats: [140, 0, 90, 0, 0], sp: 130 });
  assert.deepEqual(modelContribution(card, 0, model, { 14: 5 }), { stats: [150, 0, 100, 0, 0], sp: 145 });
  model.observed = [{ cardId: card.id, lb: 0, source: 'test', runs: 10, wellTested: true, stats: [101, 2, 51, 4, 5], sp: 123 }];
  assert.deepEqual(cardContribution(card, 0, model, { 14: 5 }), {
    stats: [101, 2, 51, 4, 5], sp: 123, source: 'observed', runs: 10,
  });
});

test('evaluation metadata covers each held-out card once and agrees with retained inputs', () => {
  for (const target of ['stats', 'sp'] as const) {
    const evaluation = modelJson.evaluation[target];
    const ids = evaluation.folds.flatMap((fold) => fold.cards);
    assert.equal(new Set(ids).size, ids.length, `${target} cards must not cross outer folds`);
    const slopes: Record<string, number> = target === 'stats' ? modelJson.effectSlopes : modelJson.sp.effectSlopes;
    for (const input of evaluation.inputs) {
      assert.equal(input.status === 'retained', Math.abs(slopes[String(input.effectId)] ?? 0) > 1e-8, `${target} effect ${input.effectId}`);
    }
    if (evaluation.retained) {
      assert.ok(evaluation.expandedRmse <= evaluation.baselineRmse * 0.98, `${target}: expanded RMSE ${evaluation.expandedRmse} must beat baseline ${evaluation.baselineRmse} by 2%`);
      assert.ok(evaluation.folds.filter((fold) => fold.expandedRmse < fold.baselineRmse).length >= 3, `${target}: at least three folds improve`);
    }
  }
});

test('expanded model remains finite and nonnegative for every imported card and limit break', () => {
  for (const card of data.cards) for (let lb = 0; lb <= 4; lb++) {
    const value = modelContribution(card, lb, data.model, uniqueExtras(card, lb, data.model));
    for (const number of [...value.stats, value.sp]) {
      assert.ok(Number.isFinite(number) && number >= 0, `${card.id} LB${lb}: ${number}`);
    }
  }
});

test('pal/group SP uses the previous formula despite expanded coefficients', () => {
  const card = structuredClone(must(data.cards.find((c) => c.type === 'pal'), `data.cards.find((c) => c.type === 'pal')`));
  card.effectsByLb = [{ 14: 20, 25: 10, 30: 2 }, {}, {}, {}, {}];
  const model: StatModel = { ...data.model, sp: {
    base: 100, wit: 0, friend: 100, skillPointBonus: 10, effectSlopes: { 14: 3, 25: 4 },
    fittedTypes: ['speed', 'stamina', 'power', 'guts', 'wit'],
    fallback: { base: 30, wit: 5, friend: 20, skillPointBonus: 4 },
  } };
  assert.equal(modelContribution(card, 0, model, { 14: 5 }).sp, 58);
  card.type = 'group';
  assert.equal(modelContribution(card, 0, model, { 14: 5 }).sp, 58);
  card.type = 'speed';
  assert.equal(modelContribution(card, 0, model, { 14: 5 }).sp, 235);
});
