import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from './helpers.ts';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { cardTargetChances, compareTargetChances, deckDisplayOrder, rankingRows } from '../src/model/card-ranking.ts';
import { makeCtx, scoreCard, traineeCoverage, type CardScore } from '../src/model/deck.ts';
import { resolveTarget, type SkillSource } from '../src/model/sparks.ts';

const data = loadData();
const ctx = makeCtx({ data, settings: { ...DEFAULT_SETTINGS, whiteSparkRate: 0.2, goldSparkRate: 0.4 }, races: 20, totalTurns: 60, trainee: null });
const groundwork = resolveTarget(201601, data)!;
const source: SkillSource = { kind: 'hint', skillId: groundwork.id, gold: false, circle: false, pObtain: 0.5, isChoice: false, detail: 'Half of runs' };
const card = scoreCard(must(data.cardById.get(30017), `data.cardById.get(30017)`), 4, [groundwork], traineeCoverage([groundwork], ctx), ctx);
const fixture = (sources: SkillSource[]): CardScore => ({ ...card, coverage: [{ target: groundwork, sources, own: { pGold: 0, pWhite: 0.5, pCircle: 0, pAny: 0.5 }, spark: 0.1, marginal: 0.1 }] });
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('card chances apply SS star quality to the selected Required stars and any-star Preferred sparks', () => {
  // Half the runs obtain the white skill; one fifth generate its spark. SS is 20/70/10% stars.
  for (const [stars, expected] of [[1, 0.1], [2, 0.08], [3, 0.01]]) {
    const result = cardTargetChances(fixture([source]), [{ id: groundwork.id, role: 'required', stars: stars!, priority: 0 }], ctx);
    close(result.required, expected!);
    assert.equal(result.preferred, 0);
  }
  const preferred = cardTargetChances(fixture([source]), [{ id: groundwork.id, role: 'preferred', stars: 3, priority: 0 }], ctx);
  close(preferred.preferred, 0.1);
  assert.equal(preferred.targets[0]!.stars, 1);
  const otherRankRates = { ...ctx, settings: { ...ctx.settings, whiteStarsBelowB: [1, 0, 0], whiteStarsUE: [0, 0, 1] } };
  close(cardTargetChances(fixture([source]), [{ id: groundwork.id, role: 'required', stars: 2, priority: 0 }], otherRankRates).required, 0.08);
});

test('card chances exclude scenario rewards, retain lineage generation bonuses and handle missing sources', () => {
  const scenario: SkillSource = { kind: 'scenario', skillId: groundwork.id, gold: true, circle: false, pObtain: 1, isChoice: false,
    detail: 'Scenario reward', event: { key: 'scenario:test', label: 'Scenario', option: '', optionIndex: 0 } };
  const goals = [{ id: groundwork.id, role: 'required' as const, stars: 2, priority: 0 }];
  close(cardTargetChances(fixture([source, scenario]), goals, ctx).required, 0.08);
  close(cardTargetChances(fixture([scenario]), goals, ctx).required, 0);
  const lineageCtx = { ...ctx, lineage: new Map([[groundwork.id, { k1: 1, p1: 1, k2: 0, p2: 0 }]]) };
  close(cardTargetChances(fixture([source]), goals, lineageCtx).required, 0.088);
  const missing = cardTargetChances(fixture([]), goals, ctx);
  assert.equal(missing.targets.length, 1);
  assert.equal(missing.targets[0]!.probability, 0);
  assert.deepEqual(missing.targets[0]!.sources, []);
});

test('real card estimates respect conflicting event choices and put Required targets first', () => {
  const focus = resolveTarget(200432, data)!;
  const targets = [groundwork, focus];
  const goals = [{ id: focus.id, role: 'preferred' as const, stars: 2, priority: 0 }, { id: groundwork.id, role: 'required' as const, stars: 2, priority: 0 }];
  const compute = (priority: number[]) => {
    const current = { ...ctx, priority };
    const scored = scoreCard(card.card, 4, targets, traineeCoverage(targets, current), current);
    return cardTargetChances(scored, goals, current);
  };
  const groundFirst = compute([groundwork.id, focus.id]);
  const focusFirst = compute([focus.id, groundwork.id]);
  assert.equal(groundFirst.targets[0]!.target.id, groundwork.id);
  assert.ok(groundFirst.required > focusFirst.required, 'the shared Smart Falcon event must respect the chosen skill');
  assert.ok(groundFirst.targets.every((t) => t.sources.every((s) => s.kind !== 'scenario')), 'scenario rewards are excluded from every target');
});

test('ranking compares Required totals, then Preferred totals, then stat gain, including empty goals', () => {
  const entry = (required: number, preferred: number, statPower: number) => ({ targets: [], required, preferred, statPower });
  const a = entry(0.08, 0, 100), b = entry(0.07, 0.9, 1000), c = entry(0.08, 0.02, 50), d = entry(0.08, 0.02, 90);
  assert.deepEqual([b, a, c, d].sort(compareTargetChances), [d, c, a, b]);
  assert.ok(compareTargetChances(entry(0, 0.1, 1), entry(0, 0.09, 999)) < 0);
  assert.ok(compareTargetChances(entry(0, 0, 100), entry(0, 0, 90)) < 0);
  assert.deepEqual(cardTargetChances(card, [], ctx), { targets: [], required: 0, preferred: 0, statPower: card.statPower });
});

test('preferred ranking weights halve per priority while individual probabilities stay unweighted', () => {
  for (const [priority, weight] of [[0, 1], [1, .5], [2, .25], [3, .125], [Number.MAX_SAFE_INTEGER, 0]]) {
    const estimate = cardTargetChances(fixture([source]), [{ id: groundwork.id, role: 'preferred', stars: 3, priority: priority! }], ctx);
    close(estimate.targets[0]!.probability, .1);
    close(estimate.preferred, .1 * weight!);
  }
});

test('deck slots show pins first in pin order, then the other owned cards best first, then the borrow', () => {
  const entry = (id: number, value: number, borrowed = false) => ({ card: { id }, value, borrowed });
  const byValue = (a: { value: number }, b: { value: number }) => b.value - a.value;
  const deck = [entry(5, 9, true), entry(1, 1), entry(2, 5), entry(3, 3), entry(4, 4), entry(6, 2)];
  assert.deepEqual(deckDisplayOrder(deck, [4, 2], byValue).map((e) => e.card.id), [4, 2, 3, 6, 1, 5]);
  assert.deepEqual(deckDisplayOrder(deck, [2, 4, 99], byValue).map((e) => e.card.id), [2, 4, 3, 6, 1, 5], 'a pin outside the deck changes nothing');
  assert.deepEqual(deckDisplayOrder(deck, [], byValue).map((e) => e.card.id), [2, 4, 3, 6, 1, 5]);
  assert.deepEqual(deckDisplayOrder(deck, [5], byValue).map((e) => e.card.id), [2, 4, 3, 6, 1, 5], "the friend's card stays last even when pinned");
  const ties = [entry(3, 1), entry(1, 1), entry(2, 1)];
  assert.deepEqual(deckDisplayOrder(ties, [], byValue).map((e) => e.card.id), [1, 2, 3], 'equal cards fall back to the card id, so the order never depends on search order');
  assert.deepEqual(deckDisplayOrder(ties.slice().reverse(), [], byValue).map((e) => e.card.id), [1, 2, 3]);
});

test('ranking rows keep every pin on top in pin order, then the rest of the deck as shown, whatever the sort', () => {
  const entry = (id: number, value: number) => ({ card: { id }, value });
  const byValue = (a: { value: number }, b: { value: number }) => b.value - a.value;
  const ranking = [entry(1, 10), entry(2, 9), entry(3, 8), entry(4, 7), entry(5, 6), entry(6, 5), entry(7, 4)];
  const deck = [{ card: { id: 6 } }, { card: { id: 2 } }, { card: { id: 7 } }];
  assert.deepEqual(rankingRows(ranking, [7, 5], deck, byValue).map((e) => e.card.id), [7, 5, 6, 2, 1, 3, 4]);
  assert.deepEqual(rankingRows(ranking, [], deck, byValue).map((e) => e.card.id), [6, 2, 7, 1, 3, 4, 5]);
  assert.deepEqual(rankingRows(ranking, [4], [], byValue).map((e) => e.card.id), [4, 1, 2, 3, 5, 6, 7]);
  assert.deepEqual(rankingRows(ranking, [99], deck, byValue).map((e) => e.card.id), [6, 2, 7, 1, 3, 4, 5], 'a pin hidden from the ranking leaves no gap');
  const reversed = (a: { value: number }, b: { value: number }) => a.value - b.value;
  assert.deepEqual(rankingRows(ranking, [7, 5], deck, reversed).map((e) => e.card.id), [7, 5, 6, 2, 4, 3, 1], 'only the rows below the deck follow the sort');
});
