import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { applyUserOrder, derivePriority, planRun, type RunInput } from '../src/model/run.ts';
import { statsAtStars } from '../src/model/trainee.ts';
import { rankEstimate } from '../src/model/rank.ts';
import { resolveTarget } from '../src/model/sparks.ts';
import type { WishlistEntry } from '../src/model/deck.ts';

const data = loadData();
const settings = { ...DEFAULT_SETTINGS };
const byName = (n: string) => data.skills.find((s) => s.name === n && !s.unreleasedEn)!;
const empty: RunInput = { targets: [], targetLineage: {}, wishlistOrder: [], wishlistExcluded: [], traineeCardId: null, traineeStars: 3, aptOverrides: {}, raceOverrides: {}, pinnedIds: [], parentGains: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]] };
const entry = (skillId: number, weight: number, key = skillId): WishlistEntry => ({ key, skillId, name: String(skillId), form: null, gated: true, isTarget: false, reason: '', weight });

test('star tables: exact star counts use the listed table, others interpolate and clamp', () => {
  const ch = data.characters.find((c) => c.fourStarStats && c.fiveStarStats && c.rarity === 3)!;
  assert.deepEqual(statsAtStars(ch, 3), ch.baseStats);
  assert.deepEqual(statsAtStars(ch, 4), ch.fourStarStats);
  assert.deepEqual(statsAtStars(ch, 5), ch.fiveStarStats);
  assert.deepEqual(statsAtStars(ch, 1), ch.baseStats, 'below the base rarity clamps to the base table');
  const only = { ...ch, fourStarStats: null, fiveStarStats: null };
  assert.deepEqual(statsAtStars(only, 5), ch.baseStats, 'one known table is used for every star count');
});

test('rank estimate: the unique skill and a share of the innate skills count, and P(SS) rises with score', () => {
  const sw = data.characters.find((c) => c.name === 'Special Week')!;
  const low = rankEstimate([600, 600, 600, 600, 600], [50, 50, 50, 50, 50], 300, sw, data, settings);
  const high = rankEstimate([1100, 1100, 1100, 1100, 1100], [50, 50, 50, 50, 50], 600, sw, data, settings);
  assert.ok(high.score > low.score && high.pSS > low.pSS);
  const noTrainee = rankEstimate([600, 600, 600, 600, 600], [50, 50, 50, 50, 50], 300, null, data, settings);
  assert.ok(low.score - noTrainee.score >= 510, 'the trainee adds at least her unique skill');
  assert.equal(low.ssMin, data.ranks.find((r) => r.name === 'SS')!.min);
});

test("user order applies to a whole skill family, so a form flip keeps the entry's place", () => {
  const focus = resolveTarget(byName('Focus').id, data)!;
  const concentration = focus.gold!.id;
  const cands = [entry(byName('Groundwork').id, 5), entry(focus.white!.id, 4), entry(byName('Lane Legerdemain').id, 3)];
  // the user dragged Concentration (the gold form) first; the deck changed and the list now offers Focus (the white form)
  const ordered = applyUserOrder(cands, [concentration, byName('Groundwork').id], [], data);
  assert.deepEqual(ordered.map((w) => w.skillId), [focus.white!.id, byName('Groundwork').id, byName('Lane Legerdemain').id]);
  const excluded = applyUserOrder(cands, [], [byName('Groundwork').id], data);
  assert.ok(!excluded.some((w) => w.skillId === byName('Groundwork').id));
  assert.deepEqual(excluded.map((w) => w.weight), [4, 3], 'no order: by weight');
});

test('priority ranks targets by family id and non-target families as every form', () => {
  const focus = resolveTarget(byName('Focus').id, data)!;
  const allIveGot = resolveTarget(byName("All I've Got").id, data)!;
  const ordered = [entry(allIveGot.gold!.id, 5), entry(focus.gold!.id, 4)];
  const pr = derivePriority(ordered, [focus], data);
  // the non-target family comes first in every form, then the target as its family id
  for (const id of allIveGot.familyIds) assert.ok(pr.indexOf(id) < pr.indexOf(focus.id), `form ${id} outranks the target`);
  for (const id of focus.familyIds) assert.ok(pr.includes(id), 'the target is ranked in every form too');
  const missing = derivePriority([], [focus], data);
  assert.deepEqual(new Set(missing), focus.familyIds, 'targets absent from the list still get a rank');
});

test('planRun with nothing chosen still builds a full deck and lists scenario options', () => {
  const plan = planRun(empty, settings, {}, data);
  assert.equal(plan.trainee, null);
  assert.equal(plan.deckResult.deck.length, 6);
  assert.equal(plan.deckResult.deck.filter((d) => d.borrowed).length, 1);
  assert.ok(plan.wl.length > 0 && plan.wl.length <= 10);
  assert.ok(plan.ranking.length === data.cards.length);
  assert.ok(plan.rank.pSS >= 0 && plan.rank.pSS <= 1);
});

test('planRun: a target the trainee already has is covered, lineage feeds the spark chance, pins land in the deck', () => {
  const sw = data.characters.find((c) => c.name === 'Special Week')!;
  const corner = resolveTarget(200352, data)!;
  const input: RunInput = { ...empty, traineeCardId: sw.cardId, traineeStars: 3, targets: [corner.id], targetLineage: { [corner.id]: { k1: 1, k2: 0, p1: 3, p2: 0 } }, pinnedIds: [30052] };
  const plan = planRun(input, settings, {}, data);
  assert.equal(plan.trainee?.name, 'Special Week');
  assert.ok(plan.deckResult.deck.some((d) => d.card.id === 30052), 'pinned Light Hello is in the deck');
  assert.ok(!plan.deckResult.deck.some((d) => d.card.charId === sw.charId), "the trainee's own cards are excluded");
  assert.ok((plan.existing.sources.get(corner.id) ?? []).some((s) => s.kind === 'lineage'));
  const withoutLineage = planRun({ ...input, targetLineage: {} }, settings, {}, data);
  assert.ok((plan.deckResult.sparks.get(corner.id) ?? 0) > (withoutLineage.deckResult.sparks.get(corner.id) ?? 0), 'lineage raises the spark chance');
});

test('planRun: marking a card not owned removes it from the deck and keeps it dimmed in the ranking', () => {
  const plan = planRun({ ...empty, pinnedIds: [30052] }, settings, { '30052': null }, data);
  assert.ok(!plan.deckResult.deck.some((d) => d.card.id === 30052 && !d.borrowed), 'an unowned pin is skipped');
  assert.ok(plan.unowned.has(30052) && plan.ranking.some((r) => r.card.id === 30052), 'still shown in the ranking');
  const hidden = planRun(empty, { ...settings, showUnowned: false }, { '30052': null }, data);
  assert.ok(!hidden.ranking.some((r) => r.card.id === 30052));
});

test('planRun: the prioritized order decides which target wins a shared event', () => {
  const groundwork = resolveTarget(201601, data)!;
  const focus = resolveTarget(byName('Focus').id, data)!;
  const falcon = data.cards.find((c) => c.charName === 'Smart Falcon' && c.rarity === 'SSR' && c.type === 'power')!;
  const base: RunInput = { ...empty, targets: [groundwork.id, focus.id], pinnedIds: [falcon.id] };
  const a = planRun({ ...base, wishlistOrder: [groundwork.id, focus.id] }, settings, {}, data);
  const b = planRun({ ...base, wishlistOrder: [focus.id, groundwork.id] }, settings, {}, data);
  const falconEvent = (p: typeof a) => p.deckResult.conflicts.find((c) => c.eventKey.startsWith(`${falcon.id}:chain`));
  assert.equal(falconEvent(a)?.taken.target, groundwork.id);
  assert.equal(falconEvent(b)?.taken.target, focus.id);
});
