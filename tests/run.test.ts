import { DEFAULT_GOAL, emptyPinkLineage, goalWithTargets } from '../src/model/goal-input.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from './helpers.ts';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS, parseSetting } from '../src/settings.ts';
import { applyExtrasOrder, contestedRequired, deriveOrder, derivePriority, isLegalRunSelection, layoutWishlist, permutations, planRun, targetSpCost, withRequiredOrder, type RunInput } from '../src/model/run.ts';
import { clampStars, hasExactStarTable, statsAtStars } from '../src/model/trainee.ts';
import { rankEstimate, skillPointsOf, uniqueSkillLevel } from '../src/model/rank.ts';
import { combineSources, resolveTarget } from '../src/model/sparks.ts';
import { displayedStat } from '../src/model/stat-outcomes.ts';
import { SCENARIO_COMPLETION_SKILLS, SCENARIO_STAT_CAPS } from '../src/model/rules.ts';
import { raceScale } from '../src/model/stats.ts';
import type { EntryRole, WishlistEntry } from '../src/model/deck.ts';
import type { Target } from '../src/model/sparks.ts';

const data = loadData();
const settings = { ...DEFAULT_SETTINGS };
const byName = (n: string) => must(data.skills.find((s) => s.name === n && !s.unreleasedEn), `released skill ${n}`);
const sw = must(data.characters.find((c) => c.name === 'Special Week'));
const empty: RunInput = { goal: structuredClone(DEFAULT_GOAL), pinkLineage: emptyPinkLineage(), targets: [], targetLineage: {}, wishlistOrder: [], wishlistExcluded: [], traineeCardId: null, traineeStars: 3, aptOverrides: {}, raceOverrides: {}, pinnedIds: [], borrowFromAll: false, ignoredIds: [], borrowIgnored: false, parentSparks: [[null, null, null], [null, null, null]] };
const entry = (skillId: number, weight: number, key = skillId): WishlistEntry => ({ key, skillId, name: String(skillId), form: null, gated: true, isTarget: false, role: 'extra', targetId: null, reason: '', weight, events: [] });
const targetEntry = (t: Target, role: EntryRole, weight: number, skillId = t.id): WishlistEntry => ({ ...entry(skillId, weight), isTarget: true, role, targetId: t.id });

test('star tables: every listed table is used as is; only a missing one interpolates, and counts outside the range clamp', () => {
  const ch = must(data.characters.find((c) => c.fourStarStats && c.fiveStarStats && c.rarity === 3));
  assert.deepEqual(statsAtStars(ch, 3), ch.baseStats);
  assert.deepEqual(statsAtStars(ch, 4), ch.fourStarStats);
  assert.deepEqual(statsAtStars(ch, 5), ch.fiveStarStats);
  assert.deepEqual(statsAtStars(ch, 1), ch.baseStats, 'below the base rarity clamps to the base table');
  const only = { ...ch, twoStarStats: null, threeStarStats: null, fourStarStats: null, fiveStarStats: null };
  assert.deepEqual(statsAtStars(only, 5), ch.baseStats, 'one known table is used for every star count');
  // Gold Ship [Red Strife] is a 2★ card: GameTora lists her 3★ table, which is not the 2★/4★ midpoint
  const gold = must(data.charByCardId.get(100701));
  assert.equal(gold.rarity, 2);
  assert.deepEqual(statsAtStars(gold, 3), [87, 101, 105, 81, 76]);
  assert.ok(hasExactStarTable(gold, 3), 'Gold Ship lists an exact 3★ table');
  assert.deepEqual(statsAtStars({ ...gold, threeStarStats: null }, 3), [90, 105, 109, 84, 77], 'the old interpolation was off by up to four points');
  assert.ok(!hasExactStarTable({ ...gold, threeStarStats: null }, 3));
});

test('rank estimate: the unique skill at its level adds to the budgeted purchase score, P(SS) rises with score', () => {
  const low = rankEstimate([600, 600, 600, 600, 600], [50, 50, 50, 50, 50], 300, sw, 3, 3, data, settings);
  const high = rankEstimate([1100, 1100, 1100, 1100, 1100], [50, 50, 50, 50, 50], 600, sw, 5, 5, data, settings);
  assert.ok(high.score > low.score && high.pSS > low.pSS, 'higher stats and stars raise the score and P(SS)');
  const noTrainee = rankEstimate([600, 600, 600, 600, 600], [50, 50, 50, 50, 50], 300, null, 3, 0, data, settings);
  assert.equal(low.uniquePts, 510, 'a 3★ trainee at unique Lv3');
  assert.equal(low.score - noTrainee.score, 510, 'innate purchases are already in the budget and add no free rating');
  assert.equal(rankEstimate([600, 600, 600, 600, 600], [50, 50, 50, 50, 50], 300, sw, 5, 6, data, settings).uniquePts, 1020);
  assert.equal(rankEstimate([600, 600, 600, 600, 600], [50, 50, 50, 50, 50], 300, sw, 5, 6, data, settings).skillPts, skillPointsOf(300, sw, 5, 6), 'the search scores skill points the way the rank reports them');
  assert.equal(skillPointsOf(300, sw, 5, 6), 1320);
  assert.equal(skillPointsOf(300, null, 5, 6), 300);
  assert.equal(rankEstimate([600, 600, 600, 600, 600], [50, 50, 50, 50, 50], 300, sw, 2, 2, data, settings).uniquePts, 240, 'a 2★ trainee scores 120 per level');
  assert.equal(low.ssMin, must(data.ranks.find((r) => r.name === 'SS')).min);
});

test('the star count is clamped to the trainee: a count below her rarity cannot lower her unique skill', () => {
  assert.equal(clampStars(sw, 1), 3, 'Special Week is a 3★ uma');
  assert.equal(clampStars(sw, 9), 5);
  assert.equal(clampStars(sw, NaN), 3);
  assert.equal(clampStars(null, 1), 1);
  const urara = must(data.characters.find((c) => c.name === 'Haru Urara'));
  assert.equal(clampStars(urara, 1), 1, 'a 1★ uma can be 1★');
  const at = (traineeStars: number) => planRun({ ...empty, traineeCardId: sw.cardId, traineeStars }, settings, {}, data, { search: false });
  const p1 = at(1), p3 = at(3), p5 = at(5);
  assert.equal(p1.rank.uniqueLevel, p3.rank.uniqueLevel);
  assert.equal(p1.rank.score, p3.rank.score, 'a stale 1★ scores like 3★');
  assert.ok(p3.rank.uniqueLevel <= 4 && p3.rank.uniquePts <= 680, 'a 3★ trainee cannot exceed unique Lv4');
  assert.ok(p5.rank.uniquePts > p3.rank.uniquePts && p5.rank.uniqueLevel <= 6, 'a 5★ trainee scores more unique points, up to Lv6');
});

test('the dirt fan thresholds follow the character, so an aptitude override on the legacy screen cannot switch them', () => {
  // Aptitude overrides do not change which fan thresholds the character uses.
  const strict = { ...settings, winThreshold: 0.95 };
  const p = planRun({ ...empty, traineeCardId: sw.cardId, traineeStars: 3, aptOverrides: { turf: 'G', dirt: 'A' } }, strict, {}, data, { search: false });
  const fans = p.ctx.fansBefore!;
  assert.equal(p.rank.uniqueLevel, uniqueSkillLevel(3, sw.aptitudes, fans, strict), 'the plan uses her own table');
  const lowFans = (slot: number) => slot < 54 ? 50000 : slot < 71 ? 65000 : 90000;
  assert.equal(uniqueSkillLevel(3, p.apt, lowFans, strict), 3.5, 'an overridden dirt table would use lower thresholds');
  assert.equal(uniqueSkillLevel(3, sw.aptitudes, lowFans, strict), 1, 'her own turf table does not pass these checks');
});

test('a total-turn override at or below the reference race count is rejected and cannot divide by zero', () => {
  assert.equal(parseSetting('totalTurnsOverride', '28'), undefined);
  assert.equal(parseSetting('totalTurnsOverride', '20'), undefined);
  assert.equal(parseSetting('totalTurnsOverride', '29'), 29);
  for (const T of [28, 20, 0, -5]) {
    const bad = { ...settings, totalTurnsOverride: T };
    assert.ok(Number.isFinite(raceScale(28, data.model, bad)) && Number.isFinite(raceScale(20, data.model, bad)), `T=${T} falls back to the fitted value`);
    const plan = planRun(empty, bad, {}, data);
    assert.ok(plan.finalMean.every(Number.isFinite) && Number.isFinite(plan.rank.score), `T=${T} keeps the plan finite`);
  }
  assert.ok(Math.abs(raceScale(23, data.model, { ...settings, totalTurnsOverride: 78 }) - 55 / 50) < 1e-9);
});

test('the scenario completion reward is a source for I Wanna Win with You and On the Way to Our Dream, one outcome roll', () => {
  const spec = SCENARIO_COMPLETION_SKILLS[3]!;
  assert.equal(must(data.skillById.get(spec.gold)).name, 'I Wanna Win with You');
  assert.equal(must(data.skillById.get(spec.white)).name, 'On the Way to Our Dream');
  const target = resolveTarget(spec.white, data)!;
  assert.equal(target.gold?.id, spec.gold);
  const plan = planRun({ ...empty, targets: [target.id].map((id) => ({ id, role: 'preferred' as const, stars: 2, priority: 0 })) }, { ...settings, scenarioSongsRate: 0.8 }, {}, data);
  const srcs = plan.deckResult.coverage.get(target.id)!.filter((s) => s.kind === 'scenario');
  assert.equal(srcs.length, 2);
  assert.ok(Math.abs(must(srcs.find((s) => s.gold)).pObtain - 0.8) < 1e-9 && Math.abs(must(srcs.find((s) => !s.gold)).pObtain - 0.2) < 1e-9);
  const o = combineSources(srcs);
  assert.ok(Math.abs(o.pAny - 1) < 1e-9 && Math.abs(o.pGold - 0.8) < 1e-9, 'the two branches are exclusive, so one of them always happens');
  assert.ok((plan.deckResult.sparks.get(target.id) ?? 0) > 0.3, `spark chance ${plan.deckResult.sparks.get(target.id)}`);
  assert.ok([...plan.wl, ...plan.wlRest].some((w) => w.skillId === spec.gold || w.skillId === spec.white), 'listed as a target given without a choice');
});

test("predicted stats are clamped to the scenario caps plus the blue sparks' start uncaps", () => {
  const caps = SCENARIO_STAT_CAPS[3]!;
  const heavy: RunInput = { ...empty, traineeCardId: sw.cardId, parentSparks: [Array(3).fill({ stat: 'stamina', stars: 3 }), Array(3).fill({ stat: 'stamina', stars: 3 })] };
  const plan = planRun(heavy, settings, {}, data, { search: false });
  assert.deepEqual(plan.issues, []);
  assert.ok(plan.statCaps, 'the plan reports stat caps');
  assert.deepEqual(plan.statCaps!.uncap, [0, 96, 0, 0, 0], 'six 3★ stamina sparks raise only the stamina cap by 16 each');
  plan.finalMean.forEach((v, i) => { assert.ok(v <= caps[i]! + plan.statCaps!.uncap[i]! + 1e-9, `stat ${i} ${v} within cap`); assert.ok(v <= plan.rawFinalMean[i]! + 1e-9); });
  assert.equal(plan.statCaps!.capped.some(Boolean), plan.rawFinalMean.some((v, i) => displayedStat(v) > caps[i]! + plan.statCaps!.uncap[i]!));
  const light = planRun({ ...empty, traineeCardId: sw.cardId }, settings, {}, data, { search: false });
  assert.ok(light.finalMean[0]! < light.rawFinalMean[0]!, 'above-1200 outcomes are reduced even without inheritance');
  assert.ok(Math.abs(light.finalMean[1]! - light.rawFinalMean[1]!) < .01, 'far below the threshold the conversion leaves the mean unchanged');
});

test('worst-case target SP cost: each family once with prerequisite costs, missing costs mark it incomplete', () => {
  const corner = resolveTarget(200352, data)!; // Corner Recovery ○ / Swinging Maestro
  const plan = planRun({ ...empty, targets: [corner.id].map((id) => ({ id, role: 'preferred' as const, stars: 2, priority: 0 })), pinnedIds: [30028] }, settings, {}, data);
  const cost = targetSpCost([corner], new Map([[corner.id, plan.deckResult.coverage.get(corner.id)!]]));
  const goldCost = corner.gold!.cost!, whiteCost = corner.white!.cost!;
  assert.equal(cost.total, goldCost + whiteCost, 'buying the gold also requires buying the white form');
  assert.equal(targetSpCost([corner, corner], plan.deckResult.coverage).total, cost.total, 'a repeated target is bought once');
  assert.equal(cost.incomplete, false);
  assert.equal(plan.spCost.total, cost.total);
  assert.equal(targetSpCost([corner], new Map()).total, whiteCost, 'no source at all still buys the white form');
  assert.equal(targetSpCost([{ ...corner, white: { ...corner.white!, cost: null }, gold: null }], new Map()).incomplete, true);
});

test('prioritized skills: the list derives from the goal (required, preferred by priority, extras by weight); the user arranges only the extras; every form of a family ranks together', () => {
  const focus = resolveTarget(byName('Focus').id, data)!, groundwork = resolveTarget(201601, data)!, corner = resolveTarget(200352, data)!;
  const lane = byName('Lane Legerdemain').id, maverick = byName('Maverick ○').id;
  const cands = [entry(lane, 3), targetEntry(focus, 'preferred', 9, focus.gold!.id), targetEntry(focus, 'preferred', 8.5, focus.white!.id), targetEntry(groundwork, 'required', 1), entry(maverick, 5), targetEntry(corner, 'preferred', 9.9)];
  const goal = goalWithTargets(DEFAULT_GOAL, [{ id: groundwork.id, role: 'required', stars: 2, priority: 0 }, { id: focus.id, role: 'preferred', stars: 2, priority: 0 }, { id: corner.id, role: 'preferred', stars: 2, priority: 1 }]);
  const derived = deriveOrder(cands, goal);
  assert.deepEqual(derived.map((w) => w.key), [groundwork.id, focus.gold!.id, focus.white!.id, corner.id, maverick, lane], 'required, then preferred by priority with the gold form first, then extras by weight');
  const swapped = goalWithTargets(DEFAULT_GOAL, [{ id: groundwork.id, role: 'required', stars: 2, priority: 0 }, { id: focus.id, role: 'preferred', stars: 2, priority: 2 }, { id: corner.id, role: 'preferred', stars: 2, priority: 1 }]);
  assert.deepEqual(deriveOrder(cands, swapped).map((w) => w.key).slice(1, 4), [corner.id, focus.gold!.id, focus.white!.id], 'a lower priority number comes first');
  const arranged = applyExtrasOrder(derived, [lane, focus.gold!.id], [maverick]);
  assert.deepEqual(arranged.map((w) => w.key), [groundwork.id, focus.gold!.id, focus.white!.id, corner.id, lane], 'targets keep their place; a placed extra comes first; a hidden one leaves');
  const pr = derivePriority([targetEntry(focus, 'preferred', 9, focus.gold!.id), entry(lane, 3)], [focus], data);
  for (const id of focus.familyIds) assert.ok(pr.includes(id) && pr.indexOf(id) < pr.indexOf(lane), 'every form of the target ranks together, above the extra');
  assert.deepEqual(new Set(derivePriority([entry(lane, 3)], [focus], data)), resolveTarget(lane, data)!.familyIds, 'a target absent from the list is not ranked; the extra is, in every form');
});

test('prioritized skills: required targets sharing an event are the contested ones, and every order of them is tried', () => {
  const focus = resolveTarget(byName('Focus').id, data)!, groundwork = resolveTarget(201601, data)!, corner = resolveTarget(200352, data)!;
  const ev = (key: string) => ({ key, label: key, option: '', optionIndex: 0 });
  const on = (w: WishlistEntry, ...keys: string[]) => ({ ...w, events: keys.map(ev) });
  const ordered = [on(targetEntry(groundwork, 'required', 1), 'a'), on(targetEntry(focus, 'required', 1), 'a', 'b'), on(targetEntry(corner, 'required', 1), 'c'), on(entry(byName('Lane Legerdemain').id, 3), 'a')];
  assert.deepEqual(contestedRequired(ordered).sort(), [groundwork.id, focus.id].sort(), 'an extra on the event does not make the target contested');
  assert.deepEqual(withRequiredOrder(ordered, [focus.id, groundwork.id]).map((w) => w.targetId ?? 0), [focus.id, groundwork.id, corner.id, 0], 'the named targets swap places, the others stay in place');
  const uncontestedFirst = [on(targetEntry(corner, 'required', 1), 'c'), on(targetEntry(groundwork, 'required', 1, groundwork.gold!.id), 'a'), on(targetEntry(groundwork, 'required', 1), 'a'), on(targetEntry(focus, 'required', 1), 'a')];
  assert.deepEqual(withRequiredOrder(uncontestedFirst, [focus.id, groundwork.id]).map((w) => w.key), [corner.id, focus.id, groundwork.gold!.id, groundwork.id],
    'an uncontested required target listed first keeps its place above the contested ones, and a family moves with every form');
  assert.equal(permutations([1, 2, 3]).length, 6);
  assert.deepEqual(permutations<number>([]), [[]]);
});

test('prioritized skills: a candidate whose every event a higher entry takes is hidden behind it, a target in that place stays as a conflict, and only the listed entries take events', () => {
  const ev = (key: string) => ({ key, label: key, option: '', optionIndex: 0 });
  const on = (skillId: number, weight: number, events: string[], isTarget = false) => ({ ...entry(skillId, weight), isTarget, events: events.map(ev) });
  const layout = layoutWishlist([on(1, 9, ['scenario']), on(2, 8, ['scenario']), on(3, 7, ['scenario', 'card-a']), on(4, 6, ['scenario'], true), on(5, 5, ['card-b'])]);
  assert.deepEqual(layout.live.map((w) => w.key), [1, 3, 4, 5], 'the second scenario option steers nothing and leaves the list');
  assert.deepEqual(layout.shadowed.map((s) => [s.entry.key, s.by]), [[2, [1]]]);
  assert.deepEqual(layout.steers.get(3), ['card-a'], 'an entry on a taken event and a free one takes only the free one');
  assert.deepEqual(layout.steers.get(4), [], 'a target on a taken event stays listed but takes nothing');
  assert.deepEqual(layout.events.map((e) => [e.key, e.winner, e.keys]), [['scenario', 1, [1, 2, 3, 4]], ['card-a', 3, [3]], ['card-b', 5, [5]]].filter((e) => (e[2] as number[]).length > 1), 'shared events list every candidate in order');
  const capped = layoutWishlist([on(1, 9, ['a']), on(2, 8, ['b']), on(3, 7, ['c']), on(4, 6, ['c'])], 2);
  assert.deepEqual(capped.live.map((w) => w.key), [1, 2, 3, 4], 'past the list length nothing takes an event, so a sibling there stays a candidate');
  assert.equal(capped.shadowed.length, 0);
  assert.equal(capped.steers.has(3), false);
  const plan = planRun(empty, settings, {}, data, { budget: 8 });
  const scenarioListed = plan.wl.filter((w) => w.events.some((e) => e.key.startsWith('scenario:')));
  assert.equal(scenarioListed.length, 1, 'one scenario option is listed');
  assert.ok(plan.wlLayout.shadowed.length >= 1 && plan.wlLayout.shadowed.every((s) => s.by.includes(scenarioListed[0]!.key) || s.entry.events.every((e) => !e.key.startsWith('scenario:'))), 'the other scenario options sit behind it');
  assert.ok(plan.wl.every((w) => w.isTarget || (plan.wlLayout.steers.get(w.key)?.length ?? 0) > 0), 'every listed non-target steers an event');
});

test("planRun: the goal's priorities decide a shared event; arranging the list does not; an extra never takes an event from a listed target", () => {
  const groundwork = resolveTarget(201601, data)!;
  const focus = resolveTarget(byName('Focus').id, data)!;
  const falcon = must(data.cards.find((c) => c.charName === 'Smart Falcon' && c.rarity === 'SSR' && c.type === 'power'));
  const targets = (groundworkPriority: number, focusPriority: number) => [{ id: groundwork.id, role: 'preferred' as const, stars: 2, priority: groundworkPriority }, { id: focus.id, role: 'preferred' as const, stars: 2, priority: focusPriority }];
  const a = planRun({ ...empty, targets: targets(0, 1), pinnedIds: [falcon.id] }, settings, {}, data);
  const b = planRun({ ...empty, targets: targets(1, 0), pinnedIds: [falcon.id] }, settings, {}, data);
  const c = planRun({ ...empty, targets: targets(0, 1), pinnedIds: [falcon.id], wishlistOrder: [focus.id, groundwork.id] }, settings, {}, data);
  const falconEvent = (p: typeof a) => p.deckResult.conflicts.find((e) => e.eventKey.startsWith(`${falcon.id}:chain`));
  assert.equal(falconEvent(a)?.taken.target, groundwork.id);
  assert.equal(falconEvent(b)?.taken.target, focus.id);
  assert.equal(falconEvent(c)?.taken.target, groundwork.id, 'the list order is not an input');
  assert.deepEqual(a.wl.slice(0, 1).map((w) => w.targetId), [groundwork.id]);
  assert.deepEqual(b.wl.slice(0, 1).map((w) => w.targetId), [focus.id]);
  // Lane Legerdemain shares the scenario event with Focus; placed first among the extras it still sits below the target
  const lane = byName('Lane Legerdemain');
  const fixed: RunInput = { ...empty, targets: [{ id: focus.id, role: 'preferred', stars: 2, priority: 0 }], traineeCardId: sw.cardId, wishlistOrder: [lane.id] };
  // A small budget: the scenario event and the list order do not depend on the best deck.
  const plan = planRun(fixed, settings, {}, data, { budget: 8 });
  assert.ok(plan.wl[0]!.targetId === focus.id, 'the target is first');
  assert.ok(!plan.deckResult.conflicts.some((e) => e.eventKey.startsWith('scenario:') && e.taken.skillId === lane.id), 'Lane Legerdemain cannot take the scenario event');
  assert.ok(plan.deckResult.coverage.get(focus.id)!.some((s) => s.kind === 'scenario'), 'Focus keeps the scenario event');
  assert.ok(plan.wlLayout.shadowed.some((s) => s.entry.key === lane.id), 'Lane Legerdemain is hidden behind Focus');
});

test('planRun: an empty input still builds a full deck with scenario options; the trainee, her lineage and the inventory shape the result', () => {
  // A small budget: the shape of the plan, not the best deck, is under test.
  const plan = planRun(empty, settings, {}, data, { budget: 8 });
  assert.equal(plan.trainee, null);
  assert.equal(plan.deckResult.deck.length, 6);
  assert.equal(plan.deckResult.deck.filter((d) => d.borrowed).length, 1);
  assert.ok(plan.wl.length > 0 && plan.wl.length <= 10, `wishlist has ${plan.wl.length} entries`);
  assert.equal(plan.ranking.length, data.cards.length);
  assert.ok(plan.rank.pSS >= 0 && plan.rank.pSS <= 1, 'P(SS) is a probability');
  const corner = resolveTarget(200352, data)!;
  const input: RunInput = { ...empty, traineeCardId: sw.cardId, traineeStars: 3, targets: [corner.id].map((id) => ({ id, role: 'preferred' as const, stars: 2, priority: 0 })), targetLineage: { [corner.id]: [3, 0, 0, 0, 0, 0] }, pinnedIds: [30052] };
  const withTrainee = planRun(input, settings, {}, data, { budget: 8 });
  assert.equal(withTrainee.trainee?.name, 'Special Week');
  assert.ok(withTrainee.deckResult.deck.some((d) => d.card.id === 30052), 'pinned Light Hello is in the deck');
  assert.ok(!withTrainee.deckResult.deck.some((d) => d.card.charId === sw.charId), "the trainee's own cards are excluded");
  assert.ok((withTrainee.existing.sources.get(corner.id) ?? []).some((s) => s.kind === 'lineage'), 'the lineage source is present for the target');
  // Hold the deck fixed: reoptimizing can trade this preferred spark for a stronger combined goal.
  const selection = withTrainee.deckResult.deck.map((d) => ({ id: d.card.id, lb: d.lb, borrowed: d.borrowed }));
  const withoutLineage = planRun({ ...input, targetLineage: {} }, settings, {}, data, { selection });
  assert.deepEqual(withoutLineage.deckResult.deck.map((d) => d.card.id), selection.map((d) => d.id));
  assert.ok((withTrainee.deckResult.sparks.get(corner.id) ?? 0) > (withoutLineage.deckResult.sparks.get(corner.id) ?? 0), 'lineage raises the spark chance for the same deck');
  const unowned = planRun({ ...empty, pinnedIds: [30052] }, settings, { '30052': null }, data, { budget: 8 });
  assert.ok(!unowned.deckResult.deck.some((d) => d.card.id === 30052 && !d.borrowed), 'an unowned pin is skipped');
  assert.ok(unowned.unowned.has(30052) && unowned.ranking.some((r) => r.card.id === 30052), 'still shown in the ranking: the model retains unowned cards for the UI visibility filter');
});

test('ignored cards are never suggested: not for an owned slot, not as the borrow, not even when pinned', () => {
  const input: RunInput = { ...structuredClone(empty), traineeCardId: sw.cardId, targets: [{ id: 200352, role: 'preferred', stars: 2, priority: 0 }] };
  const base = planRun(input, settings, {}, data, { search: false });
  const owned = must(base.deckResult.deck.find((e) => !e.borrowed), 'an owned deck card');
  const borrowed = must(base.deckResult.deck.find((e) => e.borrowed), 'the borrowed deck card');
  const ignoredIds = [owned.card.id, borrowed.card.id];
  const without = planRun({ ...input, ignoredIds }, settings, {}, data, { search: false });
  assert.deepEqual(without.ignoredIds, ignoredIds);
  assert.ok(without.deckResult.deck.every((e) => !ignoredIds.includes(e.card.id)), 'both ignored cards leave the deck');
  assert.equal(without.deckResult.deck.length, base.deckResult.deck.length, 'the deck is refilled');
  assert.ok(without.ranking.some((r) => r.card.id === owned.card.id), 'an ignored card is still ranked, so it can be un-ignored there');
  const pinnedToo = planRun({ ...input, ignoredIds, pinnedIds: [...input.pinnedIds, owned.card.id] }, settings, {}, data, { search: false });
  assert.ok(!pinnedToo.deckResult.deck.some((e) => e.card.id === owned.card.id), 'ignoring wins over a stale pin');
  assert.ok(!pinnedToo.pinnedIds.includes(owned.card.id) && !pinnedToo.deckResult.steps.some((s) => s.includes('pinned but not chosen')), 'an ignored pin is not reported as a pin the search dropped');
  const previous = base.deckResult.deck.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: e.borrowed }));
  const retained = planRun({ ...input, ignoredIds: [owned.card.id] }, settings, {}, data, { previous, search: false });
  assert.ok(!retained.deckResult.deck.some((e) => e.card.id === owned.card.id), 'a retained deck cannot keep an ignored card');
  const goalInput: RunInput = { ...input, goal: { ...input.goal, blueStats: ['speed'] } };
  assert.equal(isLegalRunSelection(previous, goalInput, settings, {}, data), true);
  assert.equal(isLegalRunSelection(previous, { ...goalInput, ignoredIds: [owned.card.id] }, settings, {}, data), false, 'a saved recommendation with an ignored card is discarded');
  assert.equal(isLegalRunSelection(previous, { ...goalInput, ignoredIds: [borrowed.card.id] }, settings, {}, data), false, 'the borrow cannot be an ignored card either');
  assert.equal(isLegalRunSelection(previous, { ...goalInput, ignoredIds: [99999999] }, settings, {}, data), true, 'an ignored id missing from the data changes nothing');
  // allowing ignored cards in the friend's slot keeps them out of the owned slots only
  const lenient = { ...goalInput, ignoredIds, borrowIgnored: true };
  assert.equal(isLegalRunSelection(previous, lenient, settings, {}, data), false, 'the owned ignored card still disqualifies the deck');
  assert.equal(isLegalRunSelection(previous, { ...lenient, ignoredIds: [borrowed.card.id] }, settings, {}, data), true, 'the borrow may be an ignored card');
  const borrowable = planRun({ ...input, ignoredIds, borrowIgnored: true }, settings, {}, data, { previous, search: false });
  assert.ok(!borrowable.deckResult.deck.some((e) => e.card.id === owned.card.id), 'the ignored owned card leaves the deck');
  assert.ok(borrowable.deckResult.deck.some((e) => e.card.id === borrowed.card.id && e.borrowed), 'the ignored borrow stays');
});

test('retained decks update estimates and limit breaks, but cannot bypass ownership, pins or trainee exclusion', () => {
  const input = { ...structuredClone(empty), traineeCardId: sw.cardId };
  const initial = planRun(input, settings, {}, data, { search: false });
  const previous = initial.deckResult.deck.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: e.borrowed }));
  const edited = { ...input, goal: { ...input.goal, pink: [{ aptitude: 'any' as const, stars: 3 }] } };
  const retained = planRun(edited, settings, {}, data, { previous, search: false });
  const explicit = planRun(edited, settings, {}, data, { selection: previous, search: false });
  assert.deepEqual(retained.deckResult.deck.map((e) => e.card.id), previous.map((e) => e.id));
  assert.deepEqual(retained.goalEstimate, explicit.goalEstimate, 'retention evaluates the latest goal');
  assert.notDeepEqual(retained.goalEstimate, initial.goalEstimate);
  const owned = must(previous.find((e) => !e.borrowed));
  const lower = planRun(input, settings, { [owned.id]: 0 }, data, { previous, search: false });
  assert.equal(lower.deckResult.deck.find((e) => e.card.id === owned.id && !e.borrowed)?.lb, 0);
  const unowned = planRun(input, settings, { [owned.id]: null }, data, { previous, search: false });
  assert.ok(!unowned.deckResult.deck.some((e) => e.card.id === owned.id && !e.borrowed), 'a card marked not owned leaves the owned slots');
  const pin = must(data.cards.find((c) => c.charId !== sw.charId && !previous.some((e) => e.id === c.id)));
  const pinned = planRun({ ...input, pinnedIds: [pin.id] }, settings, {}, data, { previous, search: false });
  assert.ok(pinned.deckResult.deck.some((e) => e.card.id === pin.id), 'a new pin joins the retained deck');
  const nextTrainee = must(data.characters.find((c) => previous.some((e) => must(data.cardById.get(e.id)).charId === c.charId)));
  const changed = planRun({ ...input, traineeCardId: nextTrainee.cardId }, settings, {}, data, { previous, search: false });
  assert.ok(changed.deckResult.deck.every((e) => e.card.charId !== nextTrainee.charId), "the new trainee's own character leaves the deck");
  const incomplete = planRun(input, settings, Object.fromEntries(data.cards.map((c) => [c.id, null])), data, { previous, search: false });
  assert.ok(incomplete.issues.some((s) => s.includes('Incomplete deck')), 'an empty inventory reports an incomplete deck');
  assert.ok(incomplete.deckResult.deck.every((e) => e.borrowed), 'only the borrowed card remains');
});

test('partial input still builds for new white targets when a full goal search cannot run', () => {
  const initial = planRun(empty, settings, {}, data, { search: false });
  const previous = initial.deckResult.deck.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: e.borrowed }));
  const target = resolveTarget(200352, data)!;
  const input = { ...empty, targets: [{ id: target.id, role: 'required' as const, stars: 2, priority: 0 as const }] };
  const partial = planRun(input, settings, {}, data, { previous, search: false });
  const expected = planRun(input, settings, {}, data, { search: false });
  assert.deepEqual(partial.deckResult.deck.map((e) => e.card.id), expected.deckResult.deck.map((e) => e.card.id));
  assert.ok(partial.deckResult.sparks.get(target.id)! > 0, 'white target coverage remains useful without a trainee');
});

test('contested required targets use shared outcome probability instead of multiplied marginals', () => {
  const a = 201601, b = 200432;
  const selection = [30028, 30052, 20031, 20005, 30017, 30078].map((id, i) => ({ id, lb: 4, borrowed: i === 5 }));
  const cards = selection.map(({ id }, i) => ({ ...data.cardById.get(id)!, hintSkills: [], eventSkills: i ? [] : [a, b],
    chainEvents: [], recreationEvents: [], specialEvents: [], randomEvents: i ? [] : [{ kind: 'random' as const, index: 1, choices: [
      { outcomes: [[{ t: 'sk', d: a }], [{ t: 'sk', d: b }]] },
      { outcomes: [[{ t: 'sk', d: b }], [{ t: 'sk', d: b }], [{ t: 'sk', d: b }], [], []] },
      { outcomes: [[]] },
    ] }] }));
  const trainee = { ...sw, innateSkills: [], awakeningSkills: [], eventSkills: [a], events: [
    { kind: 'story' as const, index: 1, choices: [{ outcomes: [[{ t: 'sk', d: a }]] }] },
  ] };
  const fixture = { ...data, cards, cardById: new Map(cards.map((c) => [c.id, c])), scenarioEvents: [], charByCardId: new Map([[trainee.cardId, trainee]]) };
  const p = planRun({ ...empty, traineeCardId: trainee.cardId, targets: [a, b].map((id) => ({ id, role: 'required', stars: 1, priority: 0 })) },
    { ...settings, randomEventRate: 1, charStoryEventRate: .1 }, {}, fixture, { selection, search: false });
  // A-first: P(A)=.55, P(B)=.5, but both require the independent .1 story and the .5 B reward.
  // B-first: P(A)=.1, P(B)=.6, so both sparks occur with .1*.6*.2*.2 = .0024, above .002.
  assert.equal(p.wl[0]!.targetId, b, 'B-first has the better true joint chance despite the smaller product of marginals');
  assert.ok(Math.abs(p.goalEstimate.allAvailable - .06) < 1e-12);
});
