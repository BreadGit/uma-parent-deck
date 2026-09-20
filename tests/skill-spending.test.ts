import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { makeCtx, purchaseCoverage } from '../src/model/deck.ts';
import { estimatePurchases, estimateSkillRating, ratingFromCoverage } from '../src/model/skill-purchases.ts';
import { resolveTarget, type SkillSource, type EventSource, type Target } from '../src/model/sparks.ts';
import { prepareRunSources } from '../src/model/run-sources.ts';
import { planRun } from '../src/model/run.ts';
import { defaultState } from '../src/state.ts';

const data = loadData();
const apt = data.characters[0]!.aptitudes;
const focus = resolveTarget(200432, data)!;
const hint = (skillId: number, pObtain: number): SkillSource => ({ kind: 'hint', skillId, pObtain, isChoice: false, gold: false, circle: false, detail: 'Test hint' });

test('rank spends all SP at probability-weighted full-price efficiency, with prerequisites counted once', () => {
  const a = { ...focus, white: { ...focus.white!, tags: [], cost: 20, rating: 100 }, circle: null, gold: { ...focus.gold!, tags: [], cost: 80, rating: 260 } };
  const b = { ...focus, id: 2, white: { ...focus.white!, id: 2, tags: [], cost: 60, rating: 130 }, circle: null, gold: null };
  const coverage = new Map([[a.id, [hint(a.id, 1), { ...hint(a.gold!.id, .5), gold: true }]], [b.id, [hint(b.id, .5)]]]);
  // A costs .5*20 + .5*100 = 60 and rates .5*100 + .5*260 = 180.
  // B costs .5*60 = 30 and rates .5*130 = 65. The pool's efficiency is 245/90.
  const rating = ratingFromCoverage([a, b], coverage, 900, apt, []);
  assert.ok(Math.abs(rating.score - 2450) < 1e-9);
  assert.equal(rating.fallback, false);
  assert.equal(ratingFromCoverage([a, b], coverage, 1800, apt, []).score, 2 * rating.score);
  assert.equal(ratingFromCoverage([a, b], coverage, 0, apt, []).score, 0);
  const missing = { ...b, white: { ...b.white, cost: null } };
  assert.equal(ratingFromCoverage([a, missing], coverage, 900, apt, []).pointsPerSp, 3, 'unpriced forms do not contribute rating without cost');
});

test('rank includes unlisted hints while target cost includes only obtainable goal and listed families', () => {
  const ids = [201601, 200432, 200352];
  const skills = ids.map((id, i) => ({ ...data.skillById.get(id)!, versions: [], tags: [], rating: [100, 300, 100][i], cost: 100 }));
  const fixture = { ...data, skills, skillById: new Map(skills.map((s) => [s.id, s])), scenarioEvents: [] };
  const [a, b, absent] = ids.map((id) => resolveTarget(id, fixture)!);
  const card = { ...data.cardById.get(30028)!, hintSkills: ids.slice(0, 2), eventSkills: [], chainEvents: [], randomEvents: [], recreationEvents: [], specialEvents: [] };
  const ctx = makeCtx({ data: fixture, settings: DEFAULT_SETTINGS, races: 20, totalTurns: 72, trainee: null, priority: [a!.id] });
  const deck = [{ card, lb: 4 }];
  const rating = estimateSkillRating(deck, ctx, 1000, apt);
  assert.equal(rating.pointsPerSp, 2, 'the two equally likely hints average 200 rating per 100 SP');
  assert.equal(rating.score, 2000);
  const cost = estimatePurchases(deck, [a!, absent!], ctx, apt);
  assert.equal(cost.spent, 100, 'listed A is not counted twice and the unavailable target contributes nothing');
  assert.equal(estimatePurchases(deck, [a!, b!, absent!], ctx, apt).spent, 200, 'an unlisted preferred target with a hint is included');
  assert.equal(estimatePurchases(deck, [a!, absent!], { ...ctx, priority: [a!.id, b!.id] }, apt).spent, 200, 'a listed extra is included');
  assert.equal(estimatePurchases(deck, [a!], { ...ctx, settings: { ...DEFAULT_SETTINGS, hintScale: 0 } }, apt).spent, 0, 'zero-probability sources cost nothing');
});

test('rank discloses its reference pool when no obtainable form has a known price', () => {
  const skill = { ...focus.white!, cost: 100, rating: 150, tags: [] };
  const rating = ratingFromCoverage([], new Map(), 1000, apt, [skill]);
  assert.deepEqual(rating, { score: 1500, pointsPerSp: 1.5, fallback: true, unverified: [] });
});

test('hiding every extra leaves an explicit empty list that cannot steer choice rewards', () => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100501;
  saved.run.targets = [];
  const first = planRun(saved.run, saved.settings, saved.inventory, data, { search: false });
  const selection = first.deckResult.deck.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: e.borrowed }));
  saved.run.wishlistExcluded = [...first.wlLayout.entries.keys()];
  const hidden = planRun(saved.run, saved.settings, saved.inventory, data, { selection, search: false });
  assert.deepEqual(hidden.wl, []);
  assert.deepEqual(hidden.ctx.priority, []);
  const coverage = purchaseCoverage(hidden.deckResult.deck, [focus], hidden.ctx).get(focus.id)!;
  assert.equal(coverage.filter((s) => s.isChoice).length, 0, 'no hidden choice reward is credited');
  assert.deepEqual(coverage, purchaseCoverage(hidden.deckResult.deck, [focus], { ...hidden.ctx, priority: [-1] }).get(focus.id));
  assert.equal(hidden.purchases.spent, 0);
  assert.ok(hidden.skillRating.score > 0, 'Rank still spends the full SP budget');
});

test('obtainable gold-only skills cost full price even though they cannot generate a white spark', () => {
  const target = resolveTarget(202061, data)!;
  const card = data.cards.find((c) => c.name === '[Passing the Dream On] Team Sirius')!;
  assert.ok(card);
  assert.equal(target.gold!.cost, 360);
  const ctx = makeCtx({ data, settings: DEFAULT_SETTINGS, races: 20, totalTurns: 72, trainee: null, priority: [...target.familyIds] });
  const purchases = estimatePurchases([{ card, lb: 4 }], [target], ctx, apt);
  assert.equal(purchases.spent, 360);
  assert.equal(purchases.incomplete, false);
  assert.deepEqual([...purchases.forms.components[0]!.distribution.states], [['0', 1]], 'gold-only skills still cannot generate white sparks');
});

test('full-price cost retains rare gold sources omitted by bounded joint sampling', () => {
  const skills = Array.from({ length: 13 }, (_, i) => [0, 1].map((form) => ({
    ...focus.white!, id: 900000 + i * 2 + form, name: `Test ${i} ${form}`, rarity: form ? 2 : 1,
    cost: form ? 90 : 10, versions: [900000 + i * 2 + (1 - form)],
  }))).flat();
  const fixture = { ...data, skillById: new Map(skills.map((s) => [s.id, s])) };
  const targets = Array.from({ length: 13 }, (_, i) => resolveTarget(900000 + i * 2, fixture)!);
  const reward = (skillId: number, share: number) => ({ skillId, share, gold: fixture.skillById.get(skillId)!.rarity === 2, circle: false, rolled: false });
  const rare = 1e-8;
  const roll = { pFire: 1, outcomes: [targets.map((t, i) => i ? [reward(t.id, .5)] : [reward(t.id, 1 - rare), reward(t.gold!.id, rare)])] };
  const coverage = new Map(targets.map((t, i) => [t.id, (i ? [{ id: t.id, p: .5 }] : [{ id: t.id, p: 1 - rare }, { id: t.gold!.id, p: rare }]).map(({ id, p }): EventSource => ({
    kind: 'chain', skillId: id, gold: fixture.skillById.get(id)!.rarity === 2, circle: false, pObtain: p, isChoice: false,
    detail: 'Shared reward', event: { key: 'shared', label: 'Shared reward', option: '', optionIndex: 0 }, roll,
  }))]));
  const ctx = makeCtx({ data: fixture, settings: DEFAULT_SETTINGS, races: 20, totalTurns: 72, trainee: null, priority: [] });
  ctx.sources = { ...prepareRunSources(ctx), trainee: (t) => coverage.get(t.id) ?? [] };
  const purchases = estimatePurchases([], targets, ctx, apt);
  assert.ok(purchases.forms.components[0]!.distribution.approximate, 'the fixture exceeds the joint state bound');
  assert.ok(![...purchases.forms.components[0]!.distribution.states].some(([state]) => state[0] === '3'), 'sampling misses the rare gold outcome');
  assert.equal(purchases.spent, 100 + 12 * 10, 'the first family costs white plus gold, the other twelve cost white');
  assert.equal(purchases.incomplete, false);
});

test('source costs include circle upgrades and prerequisites, and disclose unknown prices', () => {
  const white = { ...focus.white!, cost: 20 };
  const circle = { ...white, id: 999001, name: 'Test ◎', cost: 30, unreleasedEn: false };
  const gold = { ...focus.gold!, cost: 80 };
  const target: Target = { ...focus, white, circle, gold };
  const ctx = makeCtx({ data, settings: DEFAULT_SETTINGS, races: 20, totalTurns: 72, trainee: null, priority: [] });
  const sources = [hint(white.id, .5), { ...hint(gold.id, 0), gold: true }];
  ctx.sources = { ...prepareRunSources(ctx), trainee: () => sources };
  const buy = (t = target) => estimatePurchases([], [t], ctx, apt);
  assert.equal(buy().spent, 50, 'a white hint permits the released circle upgrade, with its white prerequisite');
  assert.equal(buy({ ...target, circle: { ...circle, unreleasedEn: true } }).spent, 20, 'unreleased circle upgrades cannot be bought');
  sources[1]!.pObtain = .01;
  assert.equal(buy().spent, 130, 'gold costs white plus circle plus gold regardless of probability');
  const unknown = buy({ ...target, gold: { ...gold, cost: null } });
  assert.equal(unknown.incomplete, true, 'the highest obtainable form has an unknown price');
  assert.equal(unknown.spent, 0, 'the unknown family does not inflate the lower bound');
});
