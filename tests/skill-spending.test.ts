import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { makeCtx } from '../src/model/deck.ts';
import { estimatePurchases, estimateSkillRating, ratingFromCoverage } from '../src/model/skill-purchases.ts';
import { resolveTarget, type SkillSource } from '../src/model/sparks.ts';

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
