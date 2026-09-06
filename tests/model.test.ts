import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { cardContribution, EFFECT, modelContribution, passives, predictDeck, raceScale } from '../src/model/stats.ts';
import type { Card } from '../src/types.ts';
import { resolveTarget, cardSourcesForTarget, combineSources, eventKeyOf, eventSources, expectedHints, sparkChance } from '../src/model/sparks.ts';
import { buildDeck, evaluate, makeCtx, rankCards, traineeCoverage, wishlist, wishlistCandidates, type Ctx } from '../src/model/deck.ts';
import { buildSchedule, goalRaces, scheduleSummary, traineeAptitudes } from '../src/model/races.ts';
import { statScore } from '../src/model/rank.ts';

const data = loadData();
const { cards, skills, characters } = data;
const settings = { ...DEFAULT_SETTINGS };
const kitasan = data.cardById.get(30028)!;

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

test('a card is a hint source for its hint skills and a chain-event source for the skill an event gives', () => {
  const corner = resolveTarget(200352, data)!; // Corner Recovery ○, on Kitasan's hint list
  const hints = cardSourcesForTarget(kitasan, 4, corner, 28, data.model.races.totalTurns, data, settings);
  const hint = hints.find((s) => s.kind === 'hint' && s.skillId === 200352)!;
  assert.ok(hint && hint.pObtain > 0 && hint.pObtain < 1);
  const eh = expectedHints(kitasan, 4, 28, data.model.races.totalTurns, settings);
  assert.ok(Math.abs(hint.pObtain - (1 - Math.pow(1 - 1 / kitasan.hintSkills.length, eh))) < 1e-9, 'P(at least one hint) over a uniform pool');
  const professor = resolveTarget(200331, data)!; // Professor of Curvature, given by chain event 3
  const chain = cardSourcesForTarget(kitasan, 4, professor, 28, data.model.races.totalTurns, data, settings).find((s) => s.kind === 'chain')!;
  assert.ok(chain && chain.gold, 'chain 3 gives the gold form');
  assert.ok(Math.abs(chain.pObtain - settings.chainRatesSSR[2]!) < 1e-9, 'at the SSR chain-3 completion rate');
  assert.equal(chain.isChoice, false, 'both options give it, so it is not choice-gated');
});

test('expected hints scale with turns off the track and Hint Frequency', () => {
  const hf = (c: Card) => passives(c, 4)[EFFECT.hintFreq] ?? 0;
  const noHf = cards.find((c) => c.rarity === 'SSR' && hf(c) === 0)!;
  const withHf = cards.find((c) => hf(c) >= 30)!;
  const T = data.model.races.totalTurns;
  const base = expectedHints(noHf, 4, 20, T, settings);
  assert.ok(Math.abs(base - (T - 20) * settings.hintTurnsShare * settings.hintBase * settings.hintScale) < 1e-9);
  assert.ok(expectedHints(noHf, 4, 28, T, settings) < base, 'more races, fewer training turns, fewer hints');
  assert.ok(Math.abs(expectedHints(withHf, 4, 20, T, settings) / base - (1 + hf(withHf) / 100)) < 1e-9);
});

test('event rewards decode: split outcomes use the big-reward rate, random skill lists share, an all-option skill is not gated, many random events scale', () => {
  const riko = data.cardById.get(10060)!; // random 2, option 1: small reward Ramp Up, big reward Maverick ○
  const rikoEv = eventSources(riko, settings).filter((s) => s.kind === 'random' && s.event.key.endsWith(':random:2'));
  const rampUp = rikoEv.find((s) => data.skillById.get(s.skillId)?.name === 'Ramp Up')!;
  const maverick = rikoEv.find((s) => data.skillById.get(s.skillId)?.name === 'Maverick ○')!;
  const pFire = settings.randomEventRate * Math.min(1, 2 / riko.randomEvents.length);
  assert.ok(Math.abs(rampUp.pObtain - pFire * (1 - settings.bigRewardRate)) < 1e-9 && rampUp.detail.includes('small reward'));
  assert.ok(Math.abs(maverick.pObtain - pFire * settings.bigRewardRate) < 1e-9 && maverick.detail.includes('big reward'));
  const fine = data.cardById.get(30010)!; // chain 3 hands out one of two skills at random
  const shared = eventSources(fine, settings).filter((s) => s.event.key.endsWith(':chain:3'));
  assert.equal(shared.length, 2);
  for (const s of shared) assert.ok(Math.abs(s.pObtain - settings.chainRatesSSR[2]! / 2) < 1e-9, 'each gets half the event chance');
  const diamond = data.cardById.get(30029)!; // chain 3: Iron Will in every option
  const ironWill = eventSources(diamond, settings).find((s) => s.event.key.endsWith(':chain:3') && data.skillById.get(s.skillId)?.name === 'Iron Will')!;
  assert.equal(ironWill.isChoice, false);
  const sirius = data.cardById.get(30081)!; // 14 random events: scaled so two fire on average
  const one = eventSources(sirius, settings).find((s) => s.kind === 'random')!;
  assert.ok(one.pObtain <= settings.randomEventRate * 2 / sirius.randomEvents.length + 1e-9);
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

test('the consecutive-race penalty drops the fourth race of a streak under a 90% threshold and reports why', () => {
  const allA = traineeAptitudes(null, { turf: 'A', dirt: 'A', sprint: 'A', mile: 'A', medium: 'A', long: 'A' });
  const sched = buildSchedule(data.races, allA, 0.9, new Map());
  const sel = sched.filter((s) => s.selected);
  assert.ok(sel.length > 10, 'with every aptitude at A most G1s are runnable');
  assert.ok(sel.every((s) => s.consecutive <= 3), 'a fourth race in a row would sit at 0.75 and fail the threshold');
  assert.ok(sel.some((s) => s.consecutive === 3), 'three in a row is still allowed (1.0 - 0.1 >= 0.9)');
  assert.ok(sched.some((s) => !s.selected && s.reason.startsWith('Streak penalty')), 'the dropped race says so');
  const loose = buildSchedule(data.races, allA, 0.5, new Map());
  assert.ok(loose.filter((s) => s.selected).some((s) => s.consecutive >= 4), 'a lower threshold lets longer streaks through');
});

test('prediction: focus multiplies the split, growth raises event stats, race losses cost stat points', () => {
  const grown = characters.find((c) => c.growth.some((g) => g >= 20))!;
  const gi = grown.growth.findIndex((g) => g >= 20);
  const deck = cards.filter((c) => c.rarity === 'SSR').slice(0, 6).map((card) => ({ card, lb: 4 }));
  const balanced = predictDeck(deck, grown, 20, 'balanced', 0, data.model, settings);
  const sprint = predictDeck(deck, grown, 20, 'sprint', 0, data.model, settings);
  const f = data.model.focus;
  balanced.mean.forEach((v, i) => assert.ok(Math.abs(sprint.mean[i]! / v - f.sprint[i]! / f.balanced[i]!) < 1e-6, `focus ratio on stat ${i}`));
  const flat = predictDeck(deck, { ...grown, growth: [0, 0, 0, 0, 0] }, 20, 'balanced', 0, data.model, settings);
  assert.ok(Math.abs(balanced.eventStats[gi]! / flat.eventStats[gi]! - (1 + data.model.growthEffect * grown.growth[gi]! / 100)) < 1e-9, 'growth scales the event stats');
  const penalised = predictDeck(deck, grown, 20, 'balanced', 2, data.model, { ...settings, lossPenalty: 50 });
  balanced.mean.forEach((v, i) => assert.ok(Math.abs(v - penalised.mean[i]! - 100 / 5) < 1e-9, 'each expected loss removes lossPenalty points spread over five stats'));
});

test('greedy deck covers targets and produces a wishlist', () => {
  const trainee = characters.find((c) => c.name === 'Special Week')!;
  const ctx: Ctx = makeCtx({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee });
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

test('lineage sparks: two 3★ copies hand over the hint about two thirds of the time, and each copy multiplies the spark chance', () => {
  const trainee = characters.find((c) => c.name === 'Special Week')!;
  const target = resolveTarget(200352, data)!;
  const ctx: Ctx = makeCtx({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee, lineage: new Map([[target.id, { k1: 1, k2: 1, p1: 3, p2: 3 }]]) });
  const lin = (traineeCoverage([target], ctx).sources.get(target.id) ?? []).find((s) => s.kind === 'lineage')!;
  const perEvent = Math.min(1, settings.whiteSparkInheritRates[2]! * (1 + settings.affinity / 100));
  assert.ok(Math.abs(lin.pObtain - (1 - Math.pow(1 - perEvent, 4))) < 1e-9, 'two sparks, two inspiration events each');
  assert.ok(Math.abs(sparkChance({ pGold: 0, pWhite: 1 }, settings, 2) - settings.whiteSparkRate * 1.21) < 1e-9);
  assert.ok(Math.abs(sparkChance({ pGold: 1, pWhite: 0 }, settings, 0) - settings.goldSparkRate) < 1e-9);
});

test('the deck has exactly one borrowed slot at the borrowed limit break, six distinct characters', () => {
  const trainee = characters.find((c) => c.name === 'Special Week')!;
  const targets = [resolveTarget(200352, data)!, resolveTarget(201601, data)!];
  const ctx: Ctx = makeCtx({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee });
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
  const ctx: Ctx = makeCtx({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: null });
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
  const kitasan = cards.find((c) => c.id === 30028)!;
  assert.ok(!cardSourcesForTarget(kitasan, 4, focus, 20, data.model.races.totalTurns, data, settings).some((s) => s.kind === 'scenario'));
});

test('one option per event: Smart Falcon chain 1 offers Groundwork or Focus, priority decides', () => {
  const groundwork = resolveTarget(201601, data)!;
  const focus = resolveTarget(skills.find((s) => s.name === 'Focus' && !s.unreleasedEn)!.id, data)!;
  const falcon = cards.find((c) => c.charName === 'Smart Falcon' && c.rarity === 'SSR' && c.type === 'power')!;
  const targets = [groundwork, focus];
  const mk = (priority: number[]): Ctx => makeCtx({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: null, priority });
  const a = buildDeck([{ card: falcon, lb: 4 }], targets, mk([groundwork.id, focus.id]), [], 1);
  assert.equal(a.conflicts.length, 1);
  assert.equal(a.conflicts[0]!.taken.target, groundwork.id);
  const focusSources = a.coverage.get(focus.id)!.filter((s) => eventKeyOf(s) === a.conflicts[0]!.eventKey);
  assert.equal(focusSources.length, 0, 'Focus should not be counted from the shared event');
  assert.ok(a.coverage.get(groundwork.id)!.some((s) => eventKeyOf(s) === a.conflicts[0]!.eventKey));
  const b = buildDeck([{ card: falcon, lb: 4 }], targets, mk([focus.id, groundwork.id]), [], 1);
  assert.equal(b.conflicts[0]!.taken.target, focus.id);
});

test('a pinned card is never swapped for another card of the same character', () => {
  const ghost = cards.find((c) => c.charName === 'Mihono Bourbon' && c.type === 'wit')!;
  const focus = resolveTarget(skills.find((s) => s.name === 'Focus' && !s.unreleasedEn)!.id, data)!;
  const ctx: Ctx = makeCtx({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: null });
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
  const ctx: Ctx = makeCtx({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: null });
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
  const mk = (priority: number[]): Ctx => makeCtx({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: null, priority });
  const a = buildDeck([{ card: falcon, lb: 4 }], [groundwork, focus], mk([groundwork.id, focus.id]), [], 1);
  const namesA = wishlistCandidates(a.deck, [groundwork, focus], mk([groundwork.id, focus.id])).map((w) => w.name);
  assert.ok(namesA.includes('Groundwork') && namesA.includes('Focus'), `both options listed: ${namesA.join(', ')}`);
  const evalA = evaluate({ sources: a.deck[0]!.mine, chars: new Set([falcon.charId]), cards: [falcon] }, [groundwork, focus], mk([groundwork.id, focus.id]));
  const evalB = evaluate({ sources: a.deck[0]!.mine, chars: new Set([falcon.charId]), cards: [falcon] }, [groundwork, focus], mk([focus.id, groundwork.id]));
  const key = evalA.conflicts[0]!.eventKey;
  assert.ok(evalA.map.get(groundwork.id)!.some((s) => eventKeyOf(s) === key) && !evalA.map.get(focus.id)!.some((s) => eventKeyOf(s) === key), 'Groundwork keeps the event when first');
  assert.ok(evalB.map.get(focus.id)!.some((s) => eventKeyOf(s) === key) && !evalB.map.get(groundwork.id)!.some((s) => eventKeyOf(s) === key), 'Focus keeps the event when first');
  assert.ok(evalA.sparks.get(groundwork.id)! > evalB.sparks.get(groundwork.id)!, 'Groundwork spark chance rises when it is first');
});

test('scenario options are listed as prioritized-skill candidates even with no targets', () => {
  const ctx: Ctx = makeCtx({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: null });
  const names = wishlistCandidates([], [], ctx).map((w) => w.name);
  for (const n of ['Focus', "All I've Got", 'Full Tilt', 'Rosy Outlook', 'Lane Legerdemain']) assert.ok(names.includes(n), `${n} missing from ${names.join(', ')}`);
  const bourbonUma = characters.find((c) => c.name === 'Mihono Bourbon')!;
  const names2 = wishlistCandidates([], [], { ...ctx, trainee: bourbonUma }).map((w) => w.name);
  assert.ok(names2.includes('Concentration') && !names2.includes('Focus'));
});

test('a non-target option ranked above a target takes the event and is reported', () => {
  const focus = resolveTarget(skills.find((s) => s.name === 'Focus' && !s.unreleasedEn)!.id, data)!;
  const lane = skills.find((s) => s.name === 'Lane Legerdemain' && !s.unreleasedEn)!;
  const base: Ctx = makeCtx({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: null });
  const names = wishlistCandidates([], [focus], base);
  assert.ok(names[0]!.isTarget, `targets come first: ${names.map((w) => w.name).join(', ')}`);
  const normal = evaluate(traineeCoverage([focus], base), [focus], { ...base, priority: [focus.id, lane.id] });
  assert.ok(normal.map.get(focus.id)!.some((s) => s.kind === 'scenario'), 'Focus keeps the scenario event when ranked first');
  assert.equal(normal.conflicts.length, 0);
  const blocked = evaluate(traineeCoverage([focus], base), [focus], { ...base, priority: [lane.id, focus.id] });
  assert.ok(!blocked.map.get(focus.id)!.some((s) => s.kind === 'scenario'), 'Lane Legerdemain ranked first takes the event');
  assert.equal(blocked.conflicts.length, 1);
  assert.equal(blocked.conflicts[0]!.taken.skillId, lane.id);
  assert.equal(blocked.conflicts[0]!.taken.target, null);
});

test('priority ranks every form of a non-target family together', () => {
  const focus = resolveTarget(skills.find((s) => s.name === 'Focus' && !s.unreleasedEn)!.id, data)!;
  const allIveGot = resolveTarget(skills.find((s) => s.name === "All I've Got" && !s.unreleasedEn)!.id, data)!;
  const base: Ctx = makeCtx({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: null });
  // Come What May ranked first as a non-target blocker; with Tachyon absent the event offers All I've Got instead,
  // which must still outrank Focus because the whole family is ranked together
  const pr = [...allIveGot.familyIds, focus.id];
  const r = evaluate(traineeCoverage([focus], base), [focus], { ...base, priority: pr });
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0]!.taken.skillId, allIveGot.white!.id);
});
