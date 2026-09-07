import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS, parseSetting } from '../src/settings.ts';
import { applyUserOrder, derivePriority, planRun, targetSpCost, type RunInput } from '../src/model/run.ts';
import { clampStars, hasExactStarTable, statsAtStars } from '../src/model/trainee.ts';
import { rankEstimate, uniqueSkillLevel } from '../src/model/rank.ts';
import { expectedFansBefore } from '../src/model/races.ts';
import { combineSources, resolveTarget } from '../src/model/sparks.ts';
import { SCENARIO_COMPLETION_SKILLS, SCENARIO_STAT_CAPS } from '../src/model/rules.ts';
import { raceScale } from '../src/model/stats.ts';
import type { WishlistEntry } from '../src/model/deck.ts';

const data = loadData();
const settings = { ...DEFAULT_SETTINGS };
const byName = (n: string) => data.skills.find((s) => s.name === n && !s.unreleasedEn)!;
const sw = data.characters.find((c) => c.name === 'Special Week')!;
const empty: RunInput = { targets: [], targetLineage: {}, wishlistOrder: [], wishlistExcluded: [], traineeCardId: null, traineeStars: 3, aptOverrides: {}, raceOverrides: {}, pinnedIds: [], borrowFromAll: false, parentGains: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]] };
const entry = (skillId: number, weight: number, key = skillId): WishlistEntry => ({ key, skillId, name: String(skillId), form: null, gated: true, isTarget: false, reason: '', weight });

test('star tables: every listed table is used as is; only a missing one interpolates, and counts outside the range clamp', () => {
  const ch = data.characters.find((c) => c.fourStarStats && c.fiveStarStats && c.rarity === 3)!;
  assert.deepEqual(statsAtStars(ch, 3), ch.baseStats);
  assert.deepEqual(statsAtStars(ch, 4), ch.fourStarStats);
  assert.deepEqual(statsAtStars(ch, 5), ch.fiveStarStats);
  assert.deepEqual(statsAtStars(ch, 1), ch.baseStats, 'below the base rarity clamps to the base table');
  const only = { ...ch, twoStarStats: null, threeStarStats: null, fourStarStats: null, fiveStarStats: null };
  assert.deepEqual(statsAtStars(only, 5), ch.baseStats, 'one known table is used for every star count');
  // Gold Ship [Red Strife] is a 2★ card: GameTora lists her 3★ table, which is not the 2★/4★ midpoint
  const gold = data.charByCardId.get(100701)!;
  assert.equal(gold.rarity, 2);
  assert.deepEqual(statsAtStars(gold, 3), [87, 101, 105, 81, 76]);
  assert.ok(hasExactStarTable(gold, 3));
  assert.deepEqual(statsAtStars({ ...gold, threeStarStats: null }, 3), [90, 105, 109, 84, 77], 'the old interpolation was off by up to four points');
  assert.ok(!hasExactStarTable({ ...gold, threeStarStats: null }, 3));
});

test('rank estimate: the unique skill at its level and a share of the innate skills count, P(SS) rises with score', () => {
  const apt = sw.aptitudes;
  const low = rankEstimate([600, 600, 600, 600, 600], [50, 50, 50, 50, 50], 300, sw, 3, 3, apt, data, settings);
  const high = rankEstimate([1100, 1100, 1100, 1100, 1100], [50, 50, 50, 50, 50], 600, sw, 3, 5, apt, data, settings);
  assert.ok(high.score > low.score && high.pSS > low.pSS);
  const noTrainee = rankEstimate([600, 600, 600, 600, 600], [50, 50, 50, 50, 50], 300, null, 3, 0, null, data, settings);
  assert.equal(low.uniquePts, 510, 'a 3★ trainee at unique Lv3');
  assert.ok(low.score - noTrainee.score >= 510, 'the trainee adds at least her unique skill');
  assert.equal(rankEstimate([600, 600, 600, 600, 600], [50, 50, 50, 50, 50], 300, sw, 3, 6, apt, data, settings).uniquePts, 1020);
  assert.equal(rankEstimate([600, 600, 600, 600, 600], [50, 50, 50, 50, 50], 300, sw, 2, 2, apt, data, settings).uniquePts, 240, 'a 2★ trainee scores 120 per level');
  assert.equal(low.ssMin, data.ranks.find((r) => r.name === 'SS')!.min);
});

test('the star count is clamped to the trainee: a count below her rarity cannot lower her unique skill', () => {
  assert.equal(clampStars(sw, 1), 3, 'Special Week is a 3★ uma');
  assert.equal(clampStars(sw, 9), 5);
  assert.equal(clampStars(sw, NaN), 3);
  assert.equal(clampStars(null, 1), 1);
  const urara = data.characters.find((c) => c.name === 'Haru Urara')!;
  assert.equal(clampStars(urara, 1), 1, 'a 1★ uma can be 1★');
  const at = (traineeStars: number) => planRun({ ...empty, traineeCardId: sw.cardId, traineeStars }, settings, {}, data);
  const p1 = at(1), p3 = at(3), p5 = at(5);
  assert.equal(p1.rank.uniqueLevel, p3.rank.uniqueLevel);
  assert.equal(p1.rank.score, p3.rank.score, 'a stale 1★ scores like 3★');
  assert.ok(p5.rank.uniquePts > p3.rank.uniquePts && p5.rank.uniqueLevel <= 6);
});

test('the dirt fan thresholds follow the character, so an aptitude override on the legacy screen cannot switch them', () => {
  // Special Week made dirt A / turf G at a 95% threshold: her agenda's fans sit between the dirt and the turf thresholds
  const strict = { ...settings, winThreshold: 0.95 };
  const p = planRun({ ...empty, traineeCardId: sw.cardId, traineeStars: 3, aptOverrides: { turf: 'G', dirt: 'A' } }, strict, {}, data);
  const fans = (slot: number) => expectedFansBefore(p.schedule, slot);
  assert.ok(fans(50) > 40000 && fans(50) < 60000, `fans before February ${fans(50)}`);
  assert.equal(uniqueSkillLevel(3, p.apt, fans, strict), 5.5, 'the overridden table would call her dirt-oriented');
  assert.equal(p.rank.uniqueLevel, uniqueSkillLevel(3, sw.aptitudes, fans, strict), 'the plan uses her own table');
  assert.equal(p.rank.uniqueLevel, 4, 'only the December check (120,000 fans) is met on the turf thresholds');
});

test('a total-turn override at or below the reference race count is rejected and cannot divide by zero', () => {
  assert.equal(parseSetting('totalTurnsOverride', '28'), undefined);
  assert.equal(parseSetting('totalTurnsOverride', '20'), undefined);
  assert.equal(parseSetting('totalTurnsOverride', '29'), 29);
  for (const T of [28, 20, 0, -5]) {
    const bad = { ...settings, totalTurnsOverride: T };
    assert.ok(Number.isFinite(raceScale(28, data.model, bad)) && Number.isFinite(raceScale(20, data.model, bad)), `T=${T} falls back to the fitted value`);
    const plan = planRun(empty, bad, {}, data);
    assert.ok(plan.finalMean.every(Number.isFinite) && Number.isFinite(plan.rank.score));
  }
  assert.ok(Math.abs(raceScale(23, data.model, { ...settings, totalTurnsOverride: 78 }) - 55 / 50) < 1e-9);
});

test('the scenario completion reward is a source for I Wanna Win with You and On the Way to Our Dream, one outcome roll', () => {
  const spec = SCENARIO_COMPLETION_SKILLS[3]!;
  assert.equal(data.skillById.get(spec.gold)!.name, 'I Wanna Win with You');
  assert.equal(data.skillById.get(spec.white)!.name, 'On the Way to Our Dream');
  const target = resolveTarget(spec.white, data)!;
  assert.equal(target.gold?.id, spec.gold);
  const plan = planRun({ ...empty, targets: [target.id] }, { ...settings, scenarioSongsRate: 0.8 }, {}, data);
  const srcs = plan.deckResult.coverage.get(target.id)!.filter((s) => s.kind === 'scenario');
  assert.equal(srcs.length, 2);
  assert.ok(Math.abs(srcs.find((s) => s.gold)!.pObtain - 0.8) < 1e-9 && Math.abs(srcs.find((s) => !s.gold)!.pObtain - 0.2) < 1e-9);
  const o = combineSources(srcs);
  assert.ok(Math.abs(o.pAny - 1) < 1e-9 && Math.abs(o.pGold - 0.8) < 1e-9, 'the two branches are exclusive, so one of them always happens');
  assert.ok((plan.deckResult.sparks.get(target.id) ?? 0) > 0.3);
  assert.ok([...plan.wl, ...plan.wlRest].some((w) => w.skillId === spec.gold || w.skillId === spec.white), 'listed as a target given without a choice');
});

test("predicted stats are clamped to the scenario caps plus the blue sparks' start uncaps", () => {
  const caps = SCENARIO_STAT_CAPS[3]!;
  const heavy: RunInput = { ...empty, traineeCardId: sw.cardId, parentGains: [[63, 63, 63, 63, 63], [63, 63, 63, 63, 63]] };
  const plan = planRun(heavy, settings, {}, data);
  assert.ok(plan.statCaps);
  plan.statCaps!.uncap.forEach((u) => assert.equal(u, 96, 'six 3★ sparks per stat raise its cap by 16 each'));
  plan.finalMean.forEach((v, i) => { assert.ok(v <= caps[i]! + 96 + 1e-9, `stat ${i} ${v} within cap`); assert.ok(v <= plan.rawFinalMean[i]! + 1e-9); });
  assert.equal(plan.statCaps!.capped.some(Boolean), plan.rawFinalMean.some((v, i) => v > caps[i]! + 96));
  const light = planRun({ ...empty, traineeCardId: sw.cardId }, settings, {}, data);
  assert.deepEqual(light.finalMean, light.rawFinalMean, 'nothing to clamp without inheritance');
});

test('worst-case target SP cost: each target once at the dearest form the run can hand over, missing costs mark it incomplete', () => {
  const corner = resolveTarget(200352, data)!; // Corner Recovery ○ / Swinging Maestro
  const plan = planRun({ ...empty, targets: [corner.id], pinnedIds: [30028] }, settings, {}, data);
  const cost = targetSpCost([corner], new Map([[corner.id, plan.deckResult.coverage.get(corner.id)!]]));
  const goldCost = corner.gold!.cost!, whiteCost = corner.white!.cost!;
  assert.equal(cost.total, Math.max(goldCost, whiteCost), 'Kitasan can hand over the gold, so the dearer form counts');
  assert.equal(cost.incomplete, false);
  assert.equal(plan.spCost.total, cost.total);
  assert.equal(targetSpCost([corner], new Map()).total, whiteCost, 'no source at all still buys the white form');
  assert.equal(targetSpCost([{ ...corner, white: { ...corner.white!, cost: null }, gold: null }], new Map()).incomplete, true);
});

test("prioritized skills: the user's order applies to a whole skill family, every form of a family ranks together, targets absent from the list go last", () => {
  const focus = resolveTarget(byName('Focus').id, data)!;
  const concentration = focus.gold!.id;
  const cands = [entry(byName('Groundwork').id, 5), entry(focus.white!.id, 4), entry(byName('Lane Legerdemain').id, 3)];
  // the user dragged Concentration (the gold form) first; the deck changed and the list now offers Focus (the white form)
  const ordered = applyUserOrder(cands, [concentration, byName('Groundwork').id], [], data);
  assert.deepEqual(ordered.map((w) => w.skillId), [focus.white!.id, byName('Groundwork').id, byName('Lane Legerdemain').id]);
  const excluded = applyUserOrder(cands, [], [byName('Groundwork').id], data);
  assert.ok(!excluded.some((w) => w.skillId === byName('Groundwork').id));
  assert.deepEqual(excluded.map((w) => w.weight), [4, 3], 'no order: by weight');
  const allIveGot = resolveTarget(byName("All I've Got").id, data)!;
  const pr = derivePriority([entry(allIveGot.gold!.id, 5), entry(focus.gold!.id, 4)], [focus], data);
  for (const id of allIveGot.familyIds) assert.ok(pr.indexOf(id) < pr.indexOf(focus.id), `form ${id} outranks the target`);
  for (const id of focus.familyIds) assert.ok(pr.includes(id), 'the target is ranked in every form too');
  assert.deepEqual(new Set(derivePriority([], [focus], data)), focus.familyIds, 'targets absent from the list still get a rank');
});

test('planRun: the prioritized order decides a shared event, and only the first ten entries steer choices', () => {
  const groundwork = resolveTarget(201601, data)!;
  const focus = resolveTarget(byName('Focus').id, data)!;
  const falcon = data.cards.find((c) => c.charName === 'Smart Falcon' && c.rarity === 'SSR' && c.type === 'power')!;
  const base: RunInput = { ...empty, targets: [groundwork.id, focus.id], pinnedIds: [falcon.id] };
  const a = planRun({ ...base, wishlistOrder: [groundwork.id, focus.id] }, settings, {}, data);
  const b = planRun({ ...base, wishlistOrder: [focus.id, groundwork.id] }, settings, {}, data);
  const falconEvent = (p: typeof a) => p.deckResult.conflicts.find((c) => c.eventKey.startsWith(`${falcon.id}:chain`));
  assert.equal(falconEvent(a)?.taken.target, groundwork.id);
  assert.equal(falconEvent(b)?.taken.target, focus.id);
  // six pins fix the whole deck, so the candidate list does not move between plans
  const lane = byName('Lane Legerdemain');
  const seen = new Set([sw.charId, falcon.charId]);
  const pins = [30052, falcon.id];
  for (const c of data.cards) { if (pins.length === 6) break; if (c.rarity === 'SSR' && !seen.has(c.charId) && c.charName !== 'Light Hello') { seen.add(c.charId); pins.push(c.id); } }
  const fixed: RunInput = { ...empty, targets: [focus.id], traineeCardId: sw.cardId, pinnedIds: pins };
  const probe = planRun(fixed, settings, {}, data);
  // fillers: candidates that are neither the target family nor another option of the scenario event
  const others = [...probe.wl, ...probe.wlRest].filter((w) => w.key !== lane.id && !focus.familyIds.has(w.key) && !w.reason.startsWith('Scenario')).map((w) => w.key);
  assert.ok(others.length >= 10, `need ten other candidates, have ${others.length}`);
  const laneTakes = (p: typeof probe) => p.deckResult.conflicts.find((c) => c.eventKey.startsWith('scenario:') && c.taken.skillId === lane.id);
  const blocked = planRun({ ...fixed, wishlistOrder: [...others.slice(0, 9), lane.id, focus.id] }, settings, {}, data);
  assert.ok(blocked.wl.some((w) => w.key === lane.id) && !blocked.wl.some((w) => focus.familyIds.has(w.key)), 'Lane Legerdemain is listed, Focus is not');
  assert.ok(laneTakes(blocked), 'Lane Legerdemain in tenth place takes the scenario event from an unlisted Focus');
  const free = planRun({ ...fixed, wishlistOrder: [...others.slice(0, 10), lane.id, focus.id] }, settings, {}, data);
  assert.ok(!free.wl.some((w) => w.key === lane.id) && free.wlRest.some((w) => w.key === lane.id), 'Lane Legerdemain is now eleventh');
  assert.equal(laneTakes(free), undefined, 'in eleventh place it is not prioritized and cannot steer the choice');
  assert.ok(free.deckResult.coverage.get(focus.id)!.some((s) => s.kind === 'scenario'));
});

test('planRun: an empty input still builds a full deck with scenario options; the trainee, her lineage and the inventory shape the result', () => {
  const plan = planRun(empty, settings, {}, data);
  assert.equal(plan.trainee, null);
  assert.equal(plan.deckResult.deck.length, 6);
  assert.equal(plan.deckResult.deck.filter((d) => d.borrowed).length, 1);
  assert.ok(plan.wl.length > 0 && plan.wl.length <= 10);
  assert.equal(plan.ranking.length, data.cards.length);
  assert.ok(plan.rank.pSS >= 0 && plan.rank.pSS <= 1);
  const corner = resolveTarget(200352, data)!;
  const input: RunInput = { ...empty, traineeCardId: sw.cardId, traineeStars: 3, targets: [corner.id], targetLineage: { [corner.id]: { k1: 1, k2: 0, p1: 3, p2: 0 } }, pinnedIds: [30052] };
  const withTrainee = planRun(input, settings, {}, data);
  assert.equal(withTrainee.trainee?.name, 'Special Week');
  assert.ok(withTrainee.deckResult.deck.some((d) => d.card.id === 30052), 'pinned Light Hello is in the deck');
  assert.ok(!withTrainee.deckResult.deck.some((d) => d.card.charId === sw.charId), "the trainee's own cards are excluded");
  assert.ok((withTrainee.existing.sources.get(corner.id) ?? []).some((s) => s.kind === 'lineage'));
  assert.ok((withTrainee.deckResult.sparks.get(corner.id) ?? 0) > (planRun({ ...input, targetLineage: {} }, settings, {}, data).deckResult.sparks.get(corner.id) ?? 0), 'lineage raises the spark chance');
  const unowned = planRun({ ...empty, pinnedIds: [30052] }, settings, { '30052': null }, data);
  assert.ok(!unowned.deckResult.deck.some((d) => d.card.id === 30052 && !d.borrowed), 'an unowned pin is skipped');
  assert.ok(unowned.unowned.has(30052) && unowned.ranking.some((r) => r.card.id === 30052), 'still shown in the ranking');
  assert.ok(!planRun(empty, { ...settings, showUnowned: false }, { '30052': null }, data).ranking.some((r) => r.card.id === 30052));
});
