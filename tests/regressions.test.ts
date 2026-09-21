import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from './helpers.ts';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings.ts';
import { defaultState, migrate, resetRun, DEFAULT_RUN } from '../src/state.ts';
import { importInventory } from '../src/inventory.ts';
import { planRun, targetSpCost } from '../src/model/run.ts';
import { buildSchedule, expectedFansBefore, goalRaces, scheduleSummary, traineeAptitudes } from '../src/model/races.ts';
import { combineSources, eventSources, pruneConflicts, purchasedOwnership, resolveTarget, sparkChance, type SkillSource } from '../src/model/sparks.ts';
import { defaultParentSparks, gainsOfParentSparks, withParentGain } from '../src/model/inherit.ts';
import { evaluate, makeCtx, traineeCoverage } from '../src/model/deck.ts';
import type { Inventory } from '../src/types.ts';

const data = loadData();
const input = () => ({ ...structuredClone(DEFAULT_RUN), traineeCardId: 100101, pinnedIds: [30052] });
const settings = () => structuredClone(DEFAULT_SETTINGS);
const file = (value: unknown) => new File([JSON.stringify(value)], 'inventory.json', { type: 'application/json' });

test('card event sources follow changes to the same settings object, including nested arrays', () => {
  const s = settings(), creek = must(data.cardById.get(30016), `data.cardById.get(30016)`);
  const chance = () => must(eventSources(creek, s, data).find((src) => src.skillId === 200351), `eventSources(creek, s, data).find((src) => src.skillId === 200351)`).pObtain;
  assert.equal(chance(), 0.12);
  s.chainRatesSSR[2] = 1;
  assert.equal(chance(), 1);
  s.chainRatesSSR = [0, 0, 0];
  assert.equal(chance(), 0);
});

test('new states and resets do not share mutable run or settings defaults', () => {
  const a = defaultState(data), b = defaultState(data);
  a.run.targets.push({ id: 201601, role: 'preferred', stars: 2, priority: 0 });
  a.run.parentSparks[0]![0] = { stat: 'guts', stars: 3 };
  a.settings.chainRatesSSR[0] = 0;
  assert.deepEqual(b.run.targets, []);
  assert.deepEqual(b.run.parentSparks, [defaultParentSparks(), defaultParentSparks()]);
  assert.equal(b.settings.chainRatesSSR[0], 0.69);
  a.settings.focus = 'sprint'; a.settings.winThreshold = 0.5; a.settings.affinity = 175;
  const reset = resetRun(a, data);
  assert.deepEqual(reset.run.targets, []);
  assert.deepEqual(reset.run.parentSparks[0], defaultParentSparks());
  // Reset all returns the run-level settings to their defaults and keeps the advanced ones
  assert.equal(reset.settings.focus, DEFAULT_SETTINGS.focus);
  assert.equal(reset.settings.winThreshold, DEFAULT_SETTINGS.winThreshold);
  assert.equal(reset.settings.affinity, 175);
  assert.deepEqual(reset.inventory, a.inventory, 'Reset all keeps the inventory');
});

test('migrated states and sanitized settings own their mutable values', () => {
  const a = migrate({ current: { version: 5, run: {}, settings: {} } }, data);
  const b = migrate({ current: { version: 5, run: {}, settings: {} } }, data);
  assert.notEqual(a.run.targets, b.run.targets);
  assert.notEqual(a.settings.chainRatesSSR, b.settings.chainRatesSSR);
  assert.notEqual(a.settings.defaultLb, DEFAULT_SETTINGS.defaultLb);
  const saved = { chainRatesSSR: [0.5, 0.3, 0.1] };
  assert.notEqual(sanitizeSettings(saved).chainRatesSSR, saved.chainRatesSSR);
});

test('every trainee agenda has at most one selected race per slot', () => {
  for (const ch of data.characters) {
    const schedule = buildSchedule(data.races, traineeAptitudes(ch, {}), 0.8, new Map(), new Map(), goalRaces(ch));
    const selected = schedule.filter((s) => s.selected);
    assert.equal(selected.length, new Set(selected.map((s) => s.slot)).size, ch.name);
  }
});

test('duplicate objective input cannot count race rewards twice', () => {
  const brian = must(data.charByCardId.get(101601), `data.charByCardId.get(101601)`);
  const goals = goalRaces(brian);
  const baseline = buildSchedule(data.races, brian.aptitudes, 0.8, new Map(), new Map(), goals);
  const duplicated = buildSchedule(data.races, brian.aptitudes, 0.8, new Map(), new Map(), [...goals, goals[0]!]);
  assert.deepEqual(scheduleSummary(duplicated), scheduleSummary(baseline));
  assert.equal(expectedFansBefore(duplicated, 72), expectedFansBefore(baseline, 72));
});

test('bundled career goals contain no repeated race objective at the same slot', () => {
  for (const ch of data.characters) {
    const keys = ch.goals.flatMap((g) => g.races.map((r) => `${g.slot}:${r.raceId}`));
    assert.equal(new Set(keys).size, keys.length, ch.name);
  }
});

test('gold purchase includes the white prerequisite and deduplicates target families', () => {
  const p = planRun({ ...input(), targets: [200352].map((id) => ({ id, role: 'preferred' as const, stars: 2, priority: 0 })), pinnedIds: [30052, 30016] }, settings(), {}, data, { search: false });
  const target = resolveTarget(200352, data)!;
  assert.equal(p.spCost.total, 340);
  assert.equal(targetSpCost([target, target], p.deckResult.coverage).total, 340);
  const missing = { ...target, white: { ...target.white!, cost: null } };
  assert.equal(targetSpCost([missing], p.deckResult.coverage).incomplete, true);
});

test('a normal hint permits buying its circle upgrade without inventing a circle hint', () => {
  const p = planRun({ ...input(), targets: [200012].map((id) => ({ id, role: 'preferred' as const, stars: 2, priority: 0 })) }, settings(), {}, data, { search: false });
  const hints = combineSources(p.deckResult.coverage.get(200012)!);
  assert.equal(hints.pCircle, 0);
  assert.equal(hints.pGold, 0);
  assert.ok(Math.abs(p.deckResult.sparks.get(200012)! - hints.pAny * 0.25) < 1e-9, `spark ${p.deckResult.sparks.get(200012)} != hint ${hints.pAny} * 0.25`);
  assert.equal(p.spCost.total, 200);
  assert.equal(p.spCost.items[0]!.skill!.name, 'Right-Handed ◎');
  assert.ok(!p.wl.some((w) => w.skillId === 200011), 'the event priority still asks for the available hint');
});

test('circle upgrades follow actual skill families, not the normal skill name or icon color', () => {
  const cases = [
    { id: 200352, circle: null, gold: 200351 }, // Corner Recovery ○: recovery skill, no ◎
    { id: 201562, circle: null, gold: 201561 }, // Lucky Seven: green skill, no ◎
    { id: 200012, circle: 200011, gold: 200014 }, // Right-Handed: green skill with ◎
    { id: 201032, circle: 201031, gold: 201033 }, // Mile Straightaways: speed skill with ◎
  ];
  for (const row of cases) {
    const target = resolveTarget(row.id, data)!;
    assert.equal(target.circle?.id ?? null, row.circle, target.name);
    assert.equal(target.gold?.id ?? null, row.gold, target.name);
    for (const id of target.familyIds) assert.equal(resolveTarget(id, data)!.circle?.id ?? null, row.circle, `family member ${id}`);
  }
});

test('inherited hints use only real upgrades for spark predictions and purchase costs', () => {
  const cases = [
    { id: 200352, rate: 0.2, purchases: [200352], cost: 170 },
    { id: 201562, rate: 0.2, purchases: [201562], cost: 110 },
    { id: 200012, rate: 0.25, purchases: [200012, 200011], cost: 200 },
    { id: 201032, rate: 0.25, purchases: [201032, 201031], cost: 210 },
  ];
  for (const row of cases) {
    const target = resolveTarget(row.id, data)!;
    const ctx = makeCtx({ data, settings: settings(), trainee: null, races: 20, totalTurns: data.model.races.totalTurns,
      lineage: new Map([[target.id, [3, 0, 0, 0, 0, 0]]]) });
    const result = evaluate(traineeCoverage([target], ctx), [target], ctx);
    const sources = result.map.get(target.id)!;
    assert.deepEqual(sources.map((s) => [s.kind, s.skillId]), [['lineage', target.id]]);
    const hints = combineSources(sources);
    assert.equal(hints.pGold, 0);
    assert.equal(hints.pCircle, 0, 'inheritance gives the base hint');
    const pHint = 1 - (1 - 0.09 * 2.5) ** 2; // one 3★ spark, affinity 150, two inspiration events
    assert.ok(Math.abs(hints.pWhite - pHint) < 1e-9, `${hints.pWhite} != ${pHint}`);
    assert.ok(Math.abs(result.sparks.get(target.id)! - pHint * row.rate * 1.1) < 1e-9, target.name);
    const cost = targetSpCost([target], result.map);
    assert.deepEqual(cost.items[0]!.purchases.map((s) => s.id), row.purchases, target.name);
    assert.equal(cost.total, row.cost, target.name);
  }
});

test('purchases preserve gold and unavailable outcomes while only upgrading released circle forms', () => {
  const right = resolveTarget(200012, data)!;
  const hints = { pGold: 0.2, pCircle: 0.1, pWhite: 0.5, pAny: 0.8 };
  const bought = purchasedOwnership(right, hints);
  assert.deepEqual(bought, { pGold: 0.2, pCircle: 0.6, pWhite: 0, pAny: 0.8 });
  assert.equal(hints.pWhite, 0.5, 'purchasing does not change the hint coverage');
  assert.ok(Math.abs(sparkChance(bought, settings()) - 0.23) < 1e-9);
  const unreleased = { ...right, circle: { ...right.circle!, unreleasedEn: true } };
  assert.deepEqual(purchasedOwnership(unreleased, hints), hints);
  const absent = { pGold: 0, pCircle: 0, pWhite: 0, pAny: 0 };
  assert.deepEqual(purchasedOwnership(right, absent), absent, 'an upgrade cannot create an acquisition source');
  const gold = resolveTarget(200352, data)!;
  assert.deepEqual(purchasedOwnership(gold, hints), hints, 'gold still needs its own hint');
});

test('a gold skill above a circle upgrade includes both prerequisite purchases', () => {
  const right = resolveTarget(200012, data)!;
  const source: SkillSource = { kind: 'awakening', skillId: right.gold!.id, gold: true, circle: false, pObtain: 1, isChoice: false, detail: 'Awakening skill' };
  const cost = targetSpCost([right], new Map([[right.id, [source]]]));
  assert.equal(cost.total, 330);
  assert.deepEqual(cost.items[0]!.purchases.map((s) => s.id), [right.white!.id, right.circle!.id, right.gold!.id]);
});

test('event choice scoring accounts for a purchasable circle upgrade', () => {
  const right = resolveTarget(200012, data)!;
  const sources: SkillSource[] = [
    { kind: 'chain', skillId: right.gold!.id, gold: true, circle: false, pObtain: 0.5, isChoice: true, detail: 'Half chance of gold', event: { key: 'fixture:choice', label: 'Choice', option: 'Gold roll', optionIndex: 0 } },
    { kind: 'chain', skillId: right.white!.id, gold: false, circle: false, pObtain: 1, isChoice: true, detail: 'Guaranteed white hint', event: { key: 'fixture:choice', label: 'Choice', option: 'White hint', optionIndex: 1 } },
  ];
  const result = pruneConflicts(new Map([[right.id, sources]]), [right.id], [], settings(), [right]);
  assert.deepEqual(result.map.get(right.id), [sources[1]], 'a certain purchasable circle yields 25%, above the 20% expected from the gold roll');
});

test('borrow gain uses the final five owned cards as its baseline', () => {
  // A small budget: the gain identity holds for whichever deck the search settles on.
  const p = planRun({ ...input(), targets: [200352, 201601, 200472].map((id) => ({ id, role: 'preferred' as const, stars: 2, priority: 0 })) }, settings(), {}, data, { budget: 8 });
  const owned = traineeCoverage(p.targets, p.ctx);
  for (const entry of p.deckResult.deck.filter((c) => !c.borrowed)) {
    owned.chars.add(entry.card.charId);
    owned.cards.push(entry.card);
    for (const [id, sources] of entry.mine) owned.sources.set(id, [...(owned.sources.get(id) ?? []), ...sources]);
  }
  const sum = (v: Map<number, number>) => [...v.values()].reduce((a, b) => a + b, 0);
  const gain = sum(p.deckResult.sparks) - sum(evaluate(owned, p.targets, p.ctx).sparks);
  assert.ok(Math.abs(p.deckResult.borrow!.gain - gain) < 1e-9, `${p.deckResult.borrow!.gain} != ${gain}`);
});

test('inventory import rejects invalid structure and invalid entries atomically', async () => {
  for (const value of [null, [], 'text', 4, { garbage: 'data' }, { 30052: false }, { 30052: '' }, { 30052: 5 }, { 30052: 2.5 }, { 30052: null, garbage: 1 }]) {
    await assert.rejects(importInventory(file(value)), Error, JSON.stringify(value));
  }
  assert.deepEqual(await importInventory(file({ 30052: 'none', 30028: '2', 20009: -1 })), { 30052: null, 30028: 2, 20009: null });
  assert.deepEqual(await importInventory(file({})), {}, 'an explicit empty inventory means defaults');
});

test('plans with fewer than five usable owned characters are explicitly incomplete', () => {
  const candidates = [30052, 30028, 30016, 30083, 20009];
  for (let n = 0; n <= 5; n++) {
    const inventory: Inventory = Object.fromEntries(data.cards.map((c) => [c.id, null]));
    candidates.slice(0, n).forEach((id) => { inventory[id] = 4; });
    const p = planRun(input(), settings(), inventory, data, { budget: 8 });
    assert.equal(p.issues.length > 0, n < 5, `${n} owned cards`);
    if (n === 5) assert.equal(p.deckResult.deck.length, 6);
  }
});

test('the plan shows the start gains the sparks make, and a full side never raises an issue', () => {
  const p = planRun({ ...input(), parentSparks: [[{ stat: 'speed', stars: 1 }, { stat: 'stamina', stars: 2 }, { stat: 'power', stars: 3 }], [{ stat: 'guts', stars: 3 }, { stat: 'guts', stars: 3 }, { stat: 'wit', stars: 2 }]] }, settings(), {}, data, { search: false });
  assert.deepEqual(p.parentGains, [[5, 12, 21, 0, 0], [0, 0, 0, 42, 12]]);
  assert.deepEqual(p.issues, []);
});

test('a start gain picked over a full side takes umas from the other stats, fewest stars first, and the old budget rules are gone', () => {
  const side = withParentGain([{ stat: 'speed', stars: 1 }, { stat: 'stamina', stars: 1 }, { stat: 'power', stars: 1 }], 0, 63);
  assert.deepEqual(gainsOfParentSparks(side), [63, 0, 0, 0, 0], 'three 3★ Speed sparks replace all entered 1★ sparks');
  const back = withParentGain(side, 1, 5);
  assert.deepEqual(gainsOfParentSparks(back), [42, 5, 0, 0, 0], 'a 1★ Stamina spark takes the last Speed slot');
  assert.deepEqual(gainsOfParentSparks(withParentGain(back, 0, 0)), [0, 5, 0, 0, 0], '+0 frees the stat and keeps the others');
});
