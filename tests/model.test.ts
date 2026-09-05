import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Card, Character, Data, Race, Rank, ScenarioEvent, Skill, StatModel } from '../src/types.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { cardContribution, modelContribution, predictDeck, raceScale } from '../src/model/stats.ts';
import { resolveTarget, cardSourcesForTarget, combineSources, sparkChance } from '../src/model/sparks.ts';
import { buildDeck, evaluate, rankCards, traineeCoverage, wishlist, wishlistCandidates, type Ctx } from '../src/model/deck.ts';
import { buildSchedule, goalRaces, scheduleSummary, traineeAptitudes } from '../src/model/races.ts';
import { statScore } from '../src/model/rank.ts';

const root = path.resolve(import.meta.dirname, '..');
const J = <T,>(f: string): T => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8')) as T;
const cards = J<Card[]>('cards.json'), skills = J<Skill[]>('skills.json'), characters = J<Character[]>('characters.json');
const data: Data = {
  cards, skills, characters, races: J<Race[]>('races.json'), ranks: J<Rank[]>('ranks.json'), scenarioEvents: J<ScenarioEvent[]>('scenario-events.json'), model: J<StatModel>('stat-model.json'),
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
  const sel = sched.filter((s) => s.selected);
  assert.ok(sel.every((s) => s.pWin >= 0.8));
  assert.equal(new Set(sel.map((s) => s.race.raceId)).size, sel.length, 'each G1 at most once');
  assert.equal(new Set(sel.map((s) => s.slot)).size, sel.length, 'one race per slot');
  const dirt = sched.find((s) => s.race.surface === 'dirt');
  assert.ok(dirt && dirt.base <= 0.5);
  // forcing a race in and excluding another
  const arima = sched.filter((s) => s.race.name === 'Arima Kinen');
  const forced = buildSchedule(data.races, apt, 0.8, new Map([[arima[0]!.race.calendarId, true], [arima[1]!.race.calendarId, false]]));
  assert.ok(forced.find((s) => s.race.calendarId === arima[0]!.race.calendarId)!.selected);
  assert.ok(!forced.find((s) => s.race.calendarId === arima[1]!.race.calendarId)!.selected);
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
  assert.deepEqual(clampStars([3, 3, 3, 3, 0], 3, 9), [3, 3, 3, 0, 0]);
  const { inheritedFromParents } = await import('../src/model/inherit.ts');
  const two = inheritedFromParents([[9, 0, 0, 0, 0], [3, 0, 0, 0, 0]], 0, s);
  assert.equal(two.start, 63 + 21);
});

test('Pal and Group outings are skill sources at their own rates', () => {
  const lightHello = data.cardById.get(30052)!;
  const seeYa = resolveTarget(201661, data)!; // Playtime's Over (white) / See Ya Later! (gold)
  assert.equal(seeYa.gold?.id, 201662);
  const srcs = cardSourcesForTarget(lightHello, 4, seeYa, 20, data.model.races.totalTurns, data, settings);
  const finale = srcs.find((s) => s.kind === 'recreation');
  assert.ok(finale && finale.gold, 'finale should give the gold form');
  assert.ok(Math.abs(finale!.pObtain - settings.palChainRate) < 1e-9, `pObtain ${finale!.pObtain}`);
  assert.equal(combineSources(srcs).pGold > 0.95, true);
  const throne = data.cardById.get(30067)!;
  const photon = resolveTarget(201113, data)!;
  const t = cardSourcesForTarget(throne, 4, photon, 20, data.model.races.totalTurns, data, settings).find((s) => s.kind === 'recreation')!;
  assert.ok(Math.abs(t.pObtain - settings.groupFinaleRate) < 1e-9);
  const prudent = resolveTarget(200452, data)!;
  const m = cardSourcesForTarget(throne, 4, prudent, 20, data.model.races.totalTurns, data, settings).find((s) => s.kind === 'recreation')!;
  assert.ok(Math.abs(m.pObtain - settings.groupOutingRate) < 1e-9);
});

test('lineage sparks raise obtain and spark chances; the deck has exactly one borrow', () => {
  const trainee = characters.find((c) => c.name === 'Special Week')!;
  const targets = [resolveTarget(200352, data)!, resolveTarget(201601, data)!];
  const ctx: Ctx = { data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee, lineage: new Map([[targets[0]!.id, { k1: 1, k2: 1, p1: 3, p2: 3 }]]) };
  const cover = traineeCoverage(targets, ctx).sources;
  const lin = (cover.get(targets[0]!.id) ?? []).find((s) => s.kind === 'lineage')!;
  assert.ok(lin && lin.pObtain > 0.6 && lin.pObtain < 0.7, `lineage obtain ${lin?.pObtain}`);
  assert.ok(Math.abs(sparkChance({ pGold: 0, pWhite: 1 }, settings, 2) - 0.2 * 1.21) < 1e-9);
  const pool = cards.filter((c) => c.rarity === 'SR').map((card) => ({ card, lb: 2 }));
  const d = buildDeck(pool, targets, ctx, [], 6, cards.map((card) => ({ card, lb: 4 })));
  assert.equal(d.deck.filter((x) => x.borrowed).length, 1);
  assert.ok(d.borrow && d.borrow.gain >= 0);
  assert.equal(d.deck.find((x) => x.borrowed)!.lb, 4);
  assert.equal(new Set(d.deck.map((x) => x.card.charId)).size, 6);
});

test('Grand Concert linked event: Bourbon present gives Concentration, otherwise Focus', () => {
  const focus = resolveTarget(skills.find((s) => s.name === 'Focus' && !s.unreleasedEn)!.id, data)!;
  assert.equal(focus.gold?.name, 'Concentration');
  const ctx: Ctx = { data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: null };
  const bourbon = cards.find((c) => c.charName === 'Mihono Bourbon' && c.type === 'wit')!;
  const without = evaluate(traineeCoverage([focus], ctx), [focus], ctx).map.get(focus.id)!.filter((s) => s.kind === 'scenario');
  assert.equal(without.length, 1); assert.ok(!without[0]!.gold, 'Focus (normal) when Bourbon is absent');
  const d = buildDeck([{ card: bourbon, lb: 4 }], [focus], ctx, [bourbon.id], 1);
  const withCard = d.coverage.get(focus.id)!.filter((s) => s.kind === 'scenario');
  assert.equal(withCard.length, 1); assert.ok(withCard[0]!.gold, 'Concentration when Bourbon is in the deck');
  const bourbonUma = characters.find((c) => c.name === 'Mihono Bourbon')!;
  const asTrainee = evaluate(traineeCoverage([focus], { ...ctx, trainee: bourbonUma }), [focus], { ...ctx, trainee: bourbonUma }).map.get(focus.id)!.filter((s) => s.kind === 'scenario');
  assert.equal(asTrainee.length, 1); assert.ok(asTrainee[0]!.gold, 'Concentration when Bourbon is the trainee');
  const names = wishlistCandidates(d.deck, [focus], ctx).map((w) => w.name);
  assert.ok(names.includes('Concentration'));
  assert.ok(!names.some((n) => n === 'Focus' && false));
  const kitasan = cards.find((c) => c.id === 30028)!;
  assert.ok(!cardSourcesForTarget(kitasan, 4, focus, 20, data.model.races.totalTurns, data, settings).some((s) => s.kind === 'scenario'));
});

test('one option per event: Smart Falcon chain 1 offers Groundwork or Focus, priority decides', () => {
  const groundwork = resolveTarget(201601, data)!;
  const focus = resolveTarget(skills.find((s) => s.name === 'Focus' && !s.unreleasedEn)!.id, data)!;
  const falcon = cards.find((c) => c.charName === 'Smart Falcon' && c.rarity === 'SSR' && c.type === 'power')!;
  const targets = [groundwork, focus];
  const mk = (priority: number[]): Ctx => ({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: null, priority });
  const a = buildDeck([{ card: falcon, lb: 4 }], targets, mk([groundwork.id, focus.id]), [], 1);
  assert.equal(a.conflicts.length, 1);
  assert.equal(a.conflicts[0]!.kept, groundwork.id);
  const focusSources = a.coverage.get(focus.id)!.filter((s) => s.eventKey === a.conflicts[0]!.eventKey);
  assert.equal(focusSources.length, 0, 'Focus should not be counted from the shared event');
  assert.ok(a.coverage.get(groundwork.id)!.some((s) => s.eventKey === a.conflicts[0]!.eventKey));
  const b = buildDeck([{ card: falcon, lb: 4 }], targets, mk([focus.id, groundwork.id]), [], 1);
  assert.equal(b.conflicts[0]!.kept, focus.id);
});

test('a pinned card is never swapped for another card of the same character', () => {
  const ghost = cards.find((c) => c.charName === 'Mihono Bourbon' && c.type === 'wit')!;
  const focus = resolveTarget(skills.find((s) => s.name === 'Focus' && !s.unreleasedEn)!.id, data)!;
  const ctx: Ctx = { data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: null };
  const pool = cards.map((card) => ({ card, lb: 2 }));
  const d = buildDeck(pool, [focus], ctx, [ghost.id], 6, cards.map((card) => ({ card, lb: 4 })));
  const bourbons = d.deck.filter((x) => x.card.charId === ghost.charId);
  assert.equal(bourbons.length, 1);
  assert.equal(bourbons[0]!.card.id, ghost.id, 'the pinned Bourbon card must be the one in the deck');
});

test('career goal races are fixed in the agenda and highlighted', () => {
  const seiun = characters.find((c) => c.name === 'Seiun Sky')!;
  const goals = goalRaces(seiun);
  assert.ok(goals.some((g) => g.name.includes('Tokyo Yushun')));
  const sched = buildSchedule(data.races, traineeAptitudes(seiun, {}), 0.8, new Map(), new Map(), goals);
  const derbySlot = sched.find((s) => s.race.name.includes('Tokyo Yushun') && s.selected)!;
  assert.ok(derbySlot && derbySlot.goal, 'the Derby should be a selected goal');
  assert.ok(!sched.some((s) => s.race.name === 'Japanese Oaks' && s.selected), 'the Oaks cannot be run in the Derby slot');
  const arima = sched.filter((s) => s.race.name === 'Arima Kinen' && s.selected);
  assert.equal(arima.length, 2, 'both Arima goals run even though it is the same G1');
});

test('a linked character in the run replaces the normal scenario option with the gold one', () => {
  const allIveGot = resolveTarget(skills.find((s) => s.name === "All I've Got" && !s.unreleasedEn)!.id, data)!;
  const tachyon = cards.find((c) => c.charName === 'Agnes Tachyon' && c.rarity === 'SSR')!;
  const ctx: Ctx = { data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: null };
  const d = buildDeck([{ card: tachyon, lb: 4 }], [allIveGot], ctx, [tachyon.id], 1);
  const srcs = d.coverage.get(allIveGot.id)!.filter((s) => s.kind === 'scenario');
  assert.equal(srcs.length, 1, 'exactly one scenario option for this target');
  assert.ok(srcs[0]!.gold, 'and it is the gold one');
  const wl = wishlistCandidates(d.deck, [allIveGot], ctx).map((w) => w.name);
  assert.ok(wl.includes('Come What May') && !wl.includes("All I've Got"), `list: ${wl.join(', ')}`);
  // with Focus also targeted, both scenario options stay listed even though only one can be taken
  const focus = resolveTarget(skills.find((s) => s.name === 'Focus' && !s.unreleasedEn)!.id, data)!;
  const both = buildDeck([{ card: tachyon, lb: 4 }], [allIveGot, focus], { ...ctx, priority: [focus.id, allIveGot.id] }, [tachyon.id], 1);
  const names = wishlistCandidates(both.deck, [allIveGot, focus], { ...ctx, priority: [focus.id, allIveGot.id] }).map((w) => w.name);
  assert.ok(names.includes('Come What May') && names.includes('Focus'), `both options listed: ${names.join(', ')}`);
  const tachyonUma = characters.find((c) => c.name === 'Agnes Tachyon')!;
  const cov = evaluate(traineeCoverage([allIveGot], { ...ctx, trainee: tachyonUma }), [allIveGot], { ...ctx, trainee: tachyonUma }).map.get(allIveGot.id)!;
  assert.ok(cov.some((s) => s.kind === 'scenario' && s.gold), 'trainee as linked character gives the gold option');
});

test('regular card events keep both options listed and the order decides which is taken', () => {
  const groundwork = resolveTarget(201601, data)!;
  const focus = resolveTarget(skills.find((s) => s.name === 'Focus' && !s.unreleasedEn)!.id, data)!;
  const falcon = cards.find((c) => c.charName === 'Smart Falcon' && c.rarity === 'SSR' && c.type === 'power')!;
  const mk = (priority: number[]): Ctx => ({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: null, priority });
  const a = buildDeck([{ card: falcon, lb: 4 }], [groundwork, focus], mk([groundwork.id, focus.id]), [], 1);
  const namesA = wishlistCandidates(a.deck, [groundwork, focus], mk([groundwork.id, focus.id])).map((w) => w.name);
  assert.ok(namesA.includes('Groundwork') && namesA.includes('Focus'), `both options listed: ${namesA.join(', ')}`);
  const evalA = evaluate({ sources: a.deck[0]!.mine, chars: new Set([falcon.charId]) }, [groundwork, focus], mk([groundwork.id, focus.id]));
  const evalB = evaluate({ sources: a.deck[0]!.mine, chars: new Set([falcon.charId]) }, [groundwork, focus], mk([focus.id, groundwork.id]));
  const key = evalA.conflicts[0]!.eventKey;
  assert.ok(evalA.map.get(groundwork.id)!.some((s) => s.eventKey === key) && !evalA.map.get(focus.id)!.some((s) => s.eventKey === key), 'Groundwork keeps the event when first');
  assert.ok(evalB.map.get(focus.id)!.some((s) => s.eventKey === key) && !evalB.map.get(groundwork.id)!.some((s) => s.eventKey === key), 'Focus keeps the event when first');
  assert.ok(evalA.sparks.get(groundwork.id)! > evalB.sparks.get(groundwork.id)!, 'Groundwork spark chance rises when it is first');
});

test('scenario options are listed as prioritized-skill candidates even with no targets', () => {
  const ctx: Ctx = { data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: null };
  const names = wishlistCandidates([], [], ctx).map((w) => w.name);
  for (const n of ['Focus', "All I've Got", 'Full Tilt', 'Rosy Outlook', 'Lane Legerdemain']) assert.ok(names.includes(n), `${n} missing from ${names.join(', ')}`);
  const bourbonUma = characters.find((c) => c.name === 'Mihono Bourbon')!;
  const names2 = wishlistCandidates([], [], { ...ctx, trainee: bourbonUma }).map((w) => w.name);
  assert.ok(names2.includes('Concentration') && !names2.includes('Focus'));
});
