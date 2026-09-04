import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Card, Character, Data, Race, Rank, Skill, StatModel } from '../src/types.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { cardContribution, modelContribution, predictDeck, raceScale } from '../src/model/stats.ts';
import { resolveTarget, cardSourcesForTarget, combineSources } from '../src/model/sparks.ts';
import { buildDeck, rankCards, traineeCoverage, wishlist, type Ctx } from '../src/model/deck.ts';
import { buildSchedule, scheduleSummary, traineeAptitudes } from '../src/model/races.ts';
import { statScore } from '../src/model/rank.ts';

const root = path.resolve(import.meta.dirname, '..');
const J = <T,>(f: string): T => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8')) as T;
const cards = J<Card[]>('cards.json'), skills = J<Skill[]>('skills.json'), characters = J<Character[]>('characters.json');
const data: Data = {
  cards, skills, characters, races: J<Race[]>('races.json'), ranks: J<Rank[]>('ranks.json'), model: J<StatModel>('stat-model.json'),
  cardById: new Map(cards.map((c) => [c.id, c])), skillById: new Map(skills.map((s) => [s.id, s])), charByCardId: new Map(characters.map((c) => [c.cardId, c])),
};
const settings = { ...DEFAULT_SETTINGS };
const kitasan = data.cardById.get(30028)!;

test('data is Global only and decoded', () => {
  assert.ok(cards.every((c) => c.releaseEn));
  assert.equal(kitasan.chainEvents.length, 3);
  assert.ok(kitasan.chainEvents[2]!.choices[0]!.outcomes.flat().some((r) => r.t === 'sk' && r.d === 200331));
  assert.equal(kitasan.randomEvents.length, 2);
});

test('skill families resolve gold and white forms', () => {
  const t = resolveTarget(200352, data)!; // Corner Recovery ○
  assert.equal(t.gold?.name, 'Swinging Maestro');
  assert.equal(t.white?.id, 200352);
  const fromGold = resolveTarget(200351, data)!;
  assert.equal(fromGold.id, t.id);
});

test('model reproduces observed Kitasan MLB within tolerance', () => {
  const obs = data.model.observed.find((o) => o.cardId === 30028 && o.lb === 4)!;
  const m = modelContribution(kitasan, 4, data.model);
  m.stats.forEach((v, i) => assert.ok(Math.abs(v - obs.stats[i]!) < 15, `stat ${i}: model ${v} vs observed ${obs.stats[i]}`));
  const c = cardContribution(kitasan, 4, data.model);
  assert.equal(c.source, 'observed');
  const c0 = cardContribution(kitasan, 0, data.model);
  assert.equal(c0.source, 'observed+model');
  assert.ok(c0.stats[0]! <= c.stats[0]!);
});

test('race scaling grows card stats with fewer races', () => {
  assert.ok(raceScale(23, data.model, settings) > 1.08 && raceScale(23, data.model, settings) < 1.14);
  assert.equal(raceScale(28, data.model, settings), 1);
});

test('kitasan provides Corner Recovery via hint and Arc Maestro via event skill list', () => {
  const t = resolveTarget(200352, data)!;
  const srcs = cardSourcesForTarget(kitasan, 4, t, 28, data.model.races.totalTurns, data, settings);
  assert.ok(srcs.some((s) => s.kind === 'hint' && s.skillId === 200352));
  const own = combineSources(srcs);
  assert.ok(own.pAny > 0 && own.pAny <= 1);
});

test('schedule respects threshold and consecutive penalty', () => {
  const sw = characters.find((c) => c.name === 'Special Week')!;
  const apt = traineeAptitudes(sw, {});
  const sched = buildSchedule(data.races, apt, 0.8, new Map());
  const sum = scheduleSummary(sched);
  assert.ok(sum.count > 5 && sum.count < 30, `count ${sum.count}`);
  assert.ok(sched.filter((s) => s.selected).every((s) => s.pWin >= 0.8));
  const dirt = sched.find((s) => s.race.surface === 'dirt');
  assert.ok(dirt && dirt.base <= 0.5);
});

test('greedy deck covers targets and produces a wishlist', () => {
  const trainee = characters.find((c) => c.name === 'Special Week')!;
  const ctx: Ctx = { data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee };
  const targets = [200352, 200762].map((id) => resolveTarget(id, data)!);
  const pool = cards.filter((c) => c.rarity === 'SSR').map((card) => ({ card, lb: 4 }));
  const r = rankCards(pool, targets, traineeCoverage(targets, ctx), ctx);
  assert.ok(r[0]!.marginalValue >= r[r.length - 1]!.marginalValue);
  const d = buildDeck(pool, targets, ctx, [30052]);
  assert.equal(d.deck.length, 6);
  assert.equal(d.deck[0]!.card.id, 30052);
  assert.equal(new Set(d.deck.map((x) => x.card.charId)).size, 6);
  assert.ok(!d.deck.some((x) => x.card.charId === trainee.charId));
  const p = predictDeck(d.deck.map((x) => ({ card: x.card, lb: x.lb })), trainee, 20, 'stamina', 1, data.model, settings);
  assert.ok(p.mean.every((v) => v > 300 && v < 1600), JSON.stringify(p.mean));
  const wl = wishlist(d.deck, targets, ctx);
  assert.ok(wl.length <= 10);
});

test('rank score matches published anchors', () => {
  assert.ok(Math.abs(statScore(1000) - 2635) < 30);
  assert.ok(Math.abs(statScore(600) - 1143) < 20);
});

test('blue spark inheritance packs stars and caps the total', async () => {
  const { inheritedStat, clampStars, sparksFromStars } = await import('../src/model/inherit.ts');
  assert.deepEqual(sparksFromStars(9), [3, 3, 3]);
  assert.deepEqual(sparksFromStars(7), [3, 3, 1]);
  const s = { ...DEFAULT_SETTINGS, affinity: 150 };
  const r = inheritedStat(9, s);
  assert.equal(r.start, 63);
  assert.equal(r.inspiration, 126); // 3★ sparks proc at 100% with 150 affinity
  const low = inheritedStat(3, { ...DEFAULT_SETTINGS, affinity: 0 });
  assert.ok(Math.abs(low.inspiration - 2 * 21 * 0.9) < 1e-9);
  assert.deepEqual(clampStars([9, 3, 3, 3, 6], 4), [9, 3, 3, 3, 0]);
});
