import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from './helpers.ts';
import { loadData } from '../src/data.ts';
import { defaultPins, defaultState, migrate, sanitizeInventory, STATE_VERSION, type AppState } from '../src/state.ts';
import { effectiveLb } from '../src/model/run.ts';
import type { Inventory, Rarity } from '../src/types.ts';
import { importInventory } from '../src/inventory.ts';
import { defaultParentSparks, gainsOfParentSparks } from '../src/model/inherit.ts';
import { ADVANCED_SETTING_GROUPS, DEFAULT_SETTINGS, MAIN_PAGE_SETTINGS, parseSetting, sanitizeSettings, SETTING_HELP, type Settings } from '../src/settings.ts';

const data = loadData();

test('new Legacy sides start empty', () => {
  assert.deepEqual(migrate({}, data).run.parentSparks, [[null, null, null], [null, null, null]]);
  const side = [{ stat: 'speed', stars: 1 }, { stat: 'stamina', stars: 1 }, { stat: 'power', stars: 1 }];
  assert.deepEqual(migrate({ current: { version: 6, run: { parentSparks: [side, side] } } }, data).run.parentSparks, [side, side], 'the former defaults remain valid saved entries');
});

test('malformed legacy stat entries do not shift later stats during migration', () => {
  for (const bad of ['bad', null, undefined, {}, NaN, Infinity, -1]) {
    const gains = migrate({ current: { version: 5, run: { parentGains: [[12, bad, 5, 0, 0], [0, 0, 0, 0, 21]] } } }, data);
    assert.deepEqual(gains.run.parentSparks.map(gainsOfParentSparks), [[12, 0, 5, 0, 0], [0, 0, 0, 0, 21]]);
    const stars = [[2, bad, 1, 0, 0], [0, 0, 0, 0, 3]];
    for (const saved of [{ state: { parentStars: stars } }, { current: { version: 4, run: { parentStars: stars } } }]) {
      assert.deepEqual(migrate(saved, data).run.parentSparks.map(gainsOfParentSparks), [[12, 0, 5, 0, 0], [0, 0, 0, 0, 21]]);
    }
    assert.deepEqual(migrate({ state: { blueStars: [2, bad, 1, 0, 0] } }, data).run.parentSparks.map(gainsOfParentSparks), [[12, 0, 5, 0, 0], [0, 0, 0, 0, 0]]);
  }
});

test('saved aptitude overrides keep valid keys and grades only', () => {
  const raw = { turf: 'Z', dirt: 'S', sprint: 'B', mile: 2, medium: null, long: 'a', front: 'G', luck: 'A' };
  assert.deepEqual(migrate({ current: { version: 6, run: { aptOverrides: raw } } }, data).run.aptOverrides, { dirt: 'A', sprint: 'B', front: 'G' });
  for (const grade of ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G']) {
    const keys = ['turf', 'dirt', 'sprint', 'mile', 'medium', 'long', 'front', 'pace', 'late', 'end'];
    const aptOverrides = Object.fromEntries(keys.map((key) => [key, grade]));
    assert.deepEqual(migrate({ state: { aptOverrides } }, data).run.aptOverrides, Object.fromEntries(keys.map((key) => [key, grade === 'S' ? 'A' : grade])));
  }
});

test('nothing saved, or garbage in every slot, gives the defaults with Light Hello pinned', () => {
  const s = migrate({}, data);
  assert.equal(s.version, STATE_VERSION);
  assert.deepEqual(s.run.pinnedIds, defaultPins(data));
  assert.equal(data.cardById.get(s.run.pinnedIds[0]!)?.charName, 'Light Hello');
  assert.deepEqual(s.settings, DEFAULT_SETTINGS);
  assert.deepEqual(s.inventory, {});
  assert.deepEqual(s.ui, { sortKey: 'score', theme: 'system', showUnowned: true, inputsHidden: false });
  assert.deepEqual(migrate({ current: 'nope', state: 42, settings: [1], inventory: 'x', theme: 'neon' }, data), s);
});

test('older run shapes migrate: v1 single pin, combined blue stars and {n, stars} lineage; v2 stars per parent; malformed fields fall back', () => {
  const v1 = { targets: [200352], pinnedId: 30028, blueStars: [9, 9, 3, 0, 0], targetLineage: { '200352': { n: 3, stars: 3 } }, sortKey: 'stats' };
  const s1 = migrate({ state: v1 }, data);
  assert.deepEqual(s1.run.pinnedIds, [30028]);
  assert.deepEqual(s1.run.parentSparks, [Array(3).fill({ stat: 'speed', stars: 1 + 2 }), defaultParentSparks()], 'parent 1 fills first with three 3★ Speed sparks; the rest would need four umas on parent 2, so that side is the default');
  assert.deepEqual(s1.run.targetLineage['200352'], [3, 3, 0, 3, 0, 0], 'three 3★ copies: both parents and a grandparent on parent 1\'s side');
  assert.equal(s1.ui.sortKey, 'stats');
  const v2 = { targets: [200352, 'x'], pinnedIds: [30052, 30028], parentStars: [[1, 2, 3, 0, 0], [0, 0, 0, 4, 5]], targetLineage: { '200352': { k1: 1, k2: 0, p1: 3, p2: 0 } }, raceOverrides: { 1011: true, a: true, b: 'no' }, traineeStars: 'five' };
  const s2 = migrate({ state: v2 }, data);
  assert.deepEqual(s2.run.targets, [{ id: 200352, role: 'preferred', stars: 2, priority: 0 }]);
  assert.deepEqual(s2.run.pinnedIds, [30052, 30028]);
  assert.deepEqual(s2.run.parentSparks, [[{ stat: 'speed', stars: 1 }, { stat: 'stamina', stars: 2 }, { stat: 'power', stars: 3 }], defaultParentSparks()], 'v2 stars per stat become one uma each; 4★ Guts and 5★ Wit pack into four sparks, so that side is the default');
  assert.deepEqual(s2.run.targetLineage, { '200352': [3, 0, 0, 0, 0, 0] });
  const v22 = { targets: [200352], targetLineage: { '200352': { k1: 2, k2: 1, p1: 5, p2: 3 }, '201601': [0, 2, 0, 0, 0, 1], '200012': [1, 2, 3], '200022': [0, 0, 0, 0, 0, 4] } };
  assert.deepEqual(migrate({ state: v22 }, data).run.targetLineage, { '200352': [3, 2, 0, 3, 0, 0], '201601': [0, 2, 0, 0, 0, 1] }, 'per-side totals place their copies; six-uma entries are kept and malformed ones dropped');
  assert.deepEqual(s2.run.raceOverrides, { 1011: true }, 'race overrides are keyed by calendar ID; other keys are dropped');
  assert.equal(s2.run.traineeStars, 3);
  const sw = must(data.characters.find((c) => c.name === 'Special Week'));
  assert.equal(migrate({ state: { traineeCardId: sw.cardId, traineeStars: 1 } }, data).run.traineeStars, 3, 'a star count below the trainee\'s rarity is raised to it');
  assert.equal(migrate({ state: { traineeCardId: sw.cardId, traineeStars: 7 } }, data).run.traineeStars, 5);
});

test('ignored cards migrate as a numeric list, drop anything also pinned, and default to none', () => {
  const current = { version: STATE_VERSION, run: { pinnedIds: [30052, 30028], ignoredIds: [30028, 30001, 'x', null, 30160] }, settings: {}, inventory: {}, ui: {} };
  const s = migrate({ current }, data);
  assert.deepEqual(s.run.pinnedIds, [30052, 30028]);
  assert.deepEqual(s.run.ignoredIds, [30001, 30160], 'the pin wins when a card is in both lists; malformed entries are dropped');
  assert.deepEqual(migrate({ current: { ...current, run: { ignoredIds: 'all' } } }, data).run.ignoredIds, []);
  assert.equal(migrate({ current: { ...current, run: { borrowIgnored: true } } }, data).run.borrowIgnored, true);
  assert.equal(migrate({ current: { ...current, run: { borrowIgnored: 'yes' } } }, data).run.borrowIgnored, false);
  assert.deepEqual(migrate({ current: { version: 21, run: { pinnedIds: [30052] } } }, data).run.ignoredIds, [], 'saves from before the field ignore nothing');
  assert.deepEqual(migrate({ state: { pinnedId: 30028, ignoredIds: [30001] } }, data).run.ignoredIds, [30001]);
  assert.deepEqual(migrate({ current: s }, data), s, 'the current shape round-trips');
});

test('v4 saves (stars per parent) and v5 saves (start gains) become v6 sparks per uma; sides the screen cannot show or left at +0 become the default; an S aptitude override becomes A', () => {
  const v4 = { version: 4, run: { parentStars: [[3, 3, 0, 0, 0], [0, 0, 0, 0, 0]], aptOverrides: { turf: 'S', dirt: 'B' } }, settings: {}, inventory: {}, ui: { sortKey: 'score', theme: 'light' } };
  const s = migrate({ current: v4 }, data);
  assert.equal(s.version, STATE_VERSION);
  assert.deepEqual(s.run.parentSparks, [[{ stat: 'speed', stars: 3 }, { stat: 'stamina', stars: 3 }, null], defaultParentSparks()], 'two sparks leave the third uma unentered; an untouched side is the default');
  assert.deepEqual(s.run.aptOverrides, { turf: 'A', dirt: 'B' }, 'S cannot show on the pre-run screen and wins like A');
  const v5 = { version: 5, run: { parentGains: [[26, 7, 0, 0, 0], [0, 0, 0, 12, 33]] } };
  assert.deepEqual(migrate({ current: v5 }, data).run.parentSparks, [defaultParentSparks(), [{ stat: 'guts', stars: 2 }, { stat: 'wit', stars: 3 }, { stat: 'wit', stars: 2 }]], '+7 is not a possible sum, so that side is the default; +33 is a 3★ and a 2★, strongest first');
  const over = { version: 5, run: { parentGains: [[63, 63, 0, 0, 0], [0, 0, 0, 0, 0]] } };
  assert.deepEqual(migrate({ current: over }, data).run.parentSparks, [defaultParentSparks(), defaultParentSparks()], 'six sparks on one side is impossible and is dropped rather than warned about');
});

test('v6 sparks per uma round-trip, a null slot survives, and a malformed slot resets its side only', () => {
  const side = [{ stat: 'guts', stars: 3 }, null, { stat: 'wit', stars: 1 }];
  const ok = migrate({ current: { version: 6, run: { parentSparks: [side, side] } } }, data);
  assert.deepEqual(ok.run.parentSparks, [side, side]);
  const bad = migrate({ current: { version: 6, run: { parentSparks: [side, [{ stat: 'luck', stars: 3 }, null, null]] } } }, data);
  assert.deepEqual(bad.run.parentSparks, [side, defaultParentSparks()]);
  const short = migrate({ current: { version: 6, run: { parentSparks: [[{ stat: 'guts', stars: 4 }, null, null], side.slice(0, 2)] } } }, data);
  assert.deepEqual(short.run.parentSparks, [defaultParentSparks(), defaultParentSparks()], 'stars past 3 and a side with two slots are malformed');
});

test('legacy settings blobs: version bumps apply and invalid values are dropped', () => {
  const s1 = migrate({ settings: { version: 1, defaultLb: { R: 4, SR: 4, SSR: 0 }, showUnowned: false, chainRatesSSR: [0.5, 0.5], hintBase: 0.1 } }, data);
  assert.deepEqual(s1.settings.inventoryOverrides, { R: 4, SR: 4, SSR: 4 }, 'v1 SSR default became 4, and without an inventory every card kept it');
  assert.equal(s1.ui.showUnowned, true, 'v2 -> unowned shown by default');
  assert.deepEqual(s1.settings.chainRatesSSR, DEFAULT_SETTINGS.chainRatesSSR, 'a two-entry list is rejected');
  assert.equal(s1.settings.hintBase, 0.1);
  const s3 = migrate({ settings: { version: 3, showUnowned: false, defaultLb: { R: 2, SR: 3, SSR: 1 } } }, data);
  assert.equal(s3.ui.showUnowned, false);
  assert.deepEqual(s3.settings.inventoryOverrides, { R: 2, SR: 3, SSR: 1 });
});

test('the current shape round-trips and wins over legacy keys', () => {
  const cur = migrate({}, data);
  cur.run.targets = [{ id: 201601, role: 'preferred', stars: 2, priority: 0 }]; cur.settings.winThreshold = 0.6; cur.inventory = { '30028': 2, '30052': null }; cur.ui = { sortKey: 'sp', theme: 'dark', showUnowned: false, inputsHidden: true };
  const back = migrate({ current: JSON.parse(JSON.stringify(cur)), state: { targets: [999] }, settings: { winThreshold: 0.1 }, inventory: { '1': 1 }, theme: 'light' }, data);
  assert.deepEqual(back, cur);
});

test('ranking visibility moves from saved settings to UI state without losing the saved choice', () => {
  for (const showUnowned of [false, true]) {
    const saved = defaultState(data);
    const old = { ...saved, version: 16, ui: { sortKey: 'speed', theme: 'dark' }, settings: { ...saved.settings, showUnowned } };
    const restored = migrate({ current: old }, data);
    assert.equal(restored.ui.showUnowned, showUnowned);
    assert.equal('showUnowned' in restored.settings, false);
    assert.deepEqual(restored.run, saved.run);
    assert.deepEqual(migrate({ current: restored }, data), restored);
    assert.equal(migrate({ current: { ...old, ui: { ...old.ui, showUnowned: !showUnowned } } }, data).ui.showUnowned, !showUnowned);
  }
});

test('the hidden input column is remembered, and a save without the flag or with a malformed one shows the column', () => {
  const saved = defaultState(data);
  assert.equal(migrate({ current: { ...saved, ui: { ...saved.ui, inputsHidden: true } } }, data).ui.inputsHidden, true);
  const { inputsHidden: _omitted, ...withoutFlag } = saved.ui;
  assert.equal(migrate({ current: { ...saved, version: 22, ui: withoutFlag } }, data).ui.inputsHidden, false);
  assert.equal(migrate({ current: { ...saved, ui: { ...saved.ui, inputsHidden: 'yes' } } }, data).ui.inputsHidden, false);
  assert.equal(migrate({ state: { sortKey: 'sp' }, theme: 'dark' }, data).ui.inputsHidden, false, 'legacy keys never hid the column');
});

test('validation: inventory entries are numeric ids with LB 0..4 or null; every setting is parsed against its spec and retired keys are dropped', () => {
  assert.deepEqual(sanitizeInventory({ '30028': 4, '30052': null, '1': 7, abc: 2, '2': '3', '3': 2.5 }), { '30028': 4, '30052': null });
  assert.equal(parseSetting('winThreshold', '0.7'), 0.7);
  assert.equal(parseSetting('winThreshold', '1.5'), undefined);
  assert.equal(parseSetting('winThreshold', 'abc'), undefined);
  assert.deepEqual(parseSetting('chainRatesSSR', '0.5, 0.3 0.1'), [0.5, 0.3, 0.1]);
  assert.equal(parseSetting('chainRatesSSR', '0.5, 0.3'), undefined, 'wrong length');
  assert.equal(parseSetting('totalTurnsOverride', ''), null);
  assert.equal(parseSetting('totalTurnsOverride', '70'), 70);
  assert.equal(parseSetting('focus', 'sprint'), 'sprint');
  assert.equal(parseSetting('focus', 'fast'), undefined);
  assert.equal(parseSetting('inventoryOverrides', '4'), undefined);
  assert.equal(parseSetting('scenarioId', '5'), undefined, 'only the supported scenario');
  assert.equal(parseSetting('scenarioId', '3'), 3);
  assert.equal(sanitizeSettings({ scenarioId: '3' }).scenarioId, 3, 'a string is not the number the model compares with');
  assert.equal(sanitizeSettings({ focus: 3 }).focus, 'stamina');
  assert.deepEqual(sanitizeSettings({ affinity: -1, hintScale: 2, bigRewardRate: 0.3 } as Record<string, unknown>), { ...DEFAULT_SETTINGS, hintScale: 2 }, 'out-of-range and retired keys are dropped');
});

test('saved IDs follow the share-code rule: invalid entries drop, duplicates keep their first place, unknown IDs stay', () => {
  const unknown = 99999999;
  const current = { version: STATE_VERSION, run: {
    traineeCardId: 1.5, pinnedIds: [1.5, -1, 0, 30052, unknown, 30052, '30028'], ignoredIds: [30001, 30001, 2 ** 60],
    wishlistOrder: [200012, NaN, 200012, unknown], wishlistExcluded: [-5, 200022],
    raceOverrides: { 1011: true, '01011': false, abc: true, '-3': false, 1012: 'yes', '79_2': false, '79_02': true },
    targetLineage: { '1e3': [3, 0, 0, 0, 0, 0], '0201601': [3, 0, 0, 0, 0, 0], 201601: [0, 2, 0, 0, 0, 1] },
  }, missions: { eventIds: [3, 3, 0], customRaceIds: [1011, 1.2], traineeCardId: -1 } };
  const s = migrate({ current }, data);
  assert.equal(s.run.traineeCardId, null);
  assert.deepEqual(s.run.pinnedIds, [30052, unknown]);
  assert.deepEqual(s.run.ignoredIds, [30001]);
  assert.deepEqual(s.run.wishlistOrder, [200012, unknown]);
  assert.deepEqual(s.run.wishlistExcluded, [200022]);
  assert.deepEqual(s.run.raceOverrides, { 1011: true, '79_2': false }, 'overrides keep calendar IDs, including a later year\'s running, and drop other keys');
  assert.deepEqual(s.run.targetLineage, { 201601: [0, 2, 0, 0, 0, 1] }, 'lineage keys follow the inventory key rule');
  assert.deepEqual([s.missions.eventIds, s.missions.customRaceIds, s.missions.traineeCardId], [[3], [1011], null]);
  assert.deepEqual(migrate({ current: { version: STATE_VERSION, run: { traineeCardId: 100101 } } }, data).run.traineeCardId, 100101);
});

test('inventory keys are card IDs as String(id) writes them, in saves and imports', async () => {
  assert.deepEqual(sanitizeInventory({ '030028': 2, '30028': 3, '30052': 1, '0': 1, '900719925474099999999': 4 }), { '30028': 3, '30052': 1 });
  const file = (value: unknown) => new File([JSON.stringify(value)], 'inventory.json', { type: 'application/json' });
  assert.deepEqual(await importInventory(file({ 30028: 2, 30052: 'none' })), { '30028': 2, '30052': null });
  for (const bad of [{ '030028': 2 }, { 0: 1 }, { '900719925474099999999': 4 }]) await assert.rejects(importInventory(file(bad)), Error, JSON.stringify(bad));
});

test('the advanced settings panel lays out every advanced setting exactly once', () => {
  const laidOut = ADVANCED_SETTING_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
  assert.equal(new Set(laidOut).size, laidOut.length, 'a setting appears in two groups');
  const advanced = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).filter((k) => !(MAIN_PAGE_SETTINGS as readonly string[]).includes(k) && k !== 'scenarioId');
  assert.deepEqual([...laidOut].sort(), [...advanced].sort());
  for (const key of laidOut) assert.ok(SETTING_HELP[key], `${key} has no help text`);
});

test('preferred priorities accept nonnegative safe integers and normalize invalid values', () => {
  for (const priority of [0, 1, 2, 123, Number.MAX_SAFE_INTEGER, -1, 1.5, Infinity, NaN, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
    const saved = migrate({ current: { version: 18, run: { targets: [{ id: 201601, role: 'preferred', stars: 3, priority }] } } }, data);
    const expected = typeof priority === 'number' && Number.isSafeInteger(priority) && priority >= 0 ? priority : 0;
    assert.equal(saved.run.targets[0]!.priority, expected);
    assert.equal(saved.run.targets[0]!.stars, 3);
    assert.deepEqual(migrate({ current: saved }, data), saved);
  }
});

test('current saves keep trainee star choices when current data has a higher rarity', () => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  saved.run.traineeStars = 1;
  assert.deepEqual(migrate({ current: saved }, data), saved);
});

test('setting specs: inventory overrides accept use-inventory or a whole LB from 0 to 4', () => {
  for (const inventoryOverrides of [{ R: 1.5, SR: null, SSR: 4 }, { R: 0, SR: 2, SSR: 5 }, { R: 4 }, { R: '4', SR: null, SSR: null }]) {
    assert.deepEqual(sanitizeSettings({ inventoryOverrides }).inventoryOverrides, DEFAULT_SETTINGS.inventoryOverrides);
  }
  for (const inventoryOverrides of [{ R: 0, SR: 2, SSR: 3 }, { R: null, SR: null, SSR: null }]) {
    assert.deepEqual(sanitizeSettings({ inventoryOverrides }).inventoryOverrides, inventoryOverrides);
  }
});

/**
 * Before v25 a card without an inventory entry was owned at its rarity's default. Every card keeps that ownership both
 * with the migrated overrides and with every rarity reading the inventory.
 */
function assertOldOwnership(state: AppState, inventory: Inventory, defaultLb: Record<Rarity, number>, what: string) {
  for (const overrides of [state.settings.inventoryOverrides, { R: null, SR: null, SSR: null }]) {
    for (const card of data.cards) {
      const saved = inventory[card.id];
      assert.equal(effectiveLb(state.inventory, card, overrides), saved === undefined ? defaultLb[card.rarity] : saved, `${what}: card ${card.id} with ${JSON.stringify(overrides)}`);
    }
  }
}
const first = (rarity: Rarity) => must(data.cards.find((card) => card.rarity === rarity), `an ${rarity} card`).id;

test('saves from before rarity overrides keep the ownership they showed', () => {
  const defaultLb = { R: 2, SR: 3, SSR: 1 };
  const inventory: Inventory = { [first('R')]: 0, [first('SR')]: null, [first('SSR')]: 1, 999999: 2 };
  const migrated = migrate({ current: { version: 24, settings: { defaultLb }, inventory } }, data);
  assertOldOwnership(migrated, inventory, defaultLb, 'custom defaults');
  assert.deepEqual(migrated.settings.inventoryOverrides, { R: null, SR: null, SSR: 1 }, 'only the SSR cards all sat at their default');
  assert.equal(migrated.inventory[999999], 2, 'entries for cards today\'s data lacks stay');
  assert.equal('defaultLb' in migrated.settings, false);
  assert.deepEqual(migrate({ current: migrated }, data), migrated);

  const untouched = migrate({ current: { version: 24, settings: {}, inventory: {} } }, data);
  assertOldOwnership(untouched, {}, { R: 4, SR: 4, SSR: 4 }, 'a save that never set an LB');
  assert.deepEqual(untouched.settings.inventoryOverrides, { R: 4, SR: 4, SSR: 4 }, 'cards added later are owned at LB4, as before');
});

test('legacy blobs without an inventory take the bundled inventory before their old defaults fill the rest', () => {
  const fallback: Inventory = { [first('SR')]: 1, [first('SSR')]: null };
  const legacy = migrate({ state: {}, settings: { version: 3, defaultLb: { R: 4, SR: 4, SSR: 4 } } }, data, fallback);
  assertOldOwnership(legacy, fallback, { R: 4, SR: 4, SSR: 4 }, 'legacy blobs');
  const fresh = migrate({}, data, fallback);
  assert.deepEqual(fresh.inventory, fallback);
  assert.deepEqual(fresh.settings.inventoryOverrides, DEFAULT_SETTINGS.inventoryOverrides, 'a fresh browser takes today\'s defaults');
});

test('setting specs: chain reach chances may not rise from one stage to the next', () => {
  assert.equal(parseSetting('chainRatesSSR', '1, 0, 1'), undefined, 'stage 3 needs stage 2');
  assert.equal(parseSetting('chainRatesSR', '0.3, 0.5'), undefined);
  assert.deepEqual(parseSetting('chainRatesSSR', '0.7, 0.4, 0.4'), [0.7, 0.4, 0.4], 'equal reaches are allowed');
  assert.deepEqual(sanitizeSettings({ chainRatesSSR: [0, 0.36, 0.12] }).chainRatesSSR, DEFAULT_SETTINGS.chainRatesSSR, 'an impossible saved list falls back to the default');
});

test('setting specs: each blue spark mean roll stays inside that star count\'s roll range', () => {
  assert.deepEqual(parseSetting('blueInspirationGainMean', '10, 16, 28'), [10, 16, 28]);
  assert.deepEqual(parseSetting('blueInspirationGainMean', '1, 1, 1'), [1, 1, 1]);
  assert.equal(parseSetting('blueInspirationGainMean', '10.5, 8.5, 14.5'), undefined, 'a 1★ spark rolls at most 10');
  assert.equal(parseSetting('blueInspirationGainMean', '5.5, 8.5, 29'), undefined);
  assert.equal(parseSetting('blueInspirationGainMean', '0, 8.5, 14.5'), undefined, 'every roll gives at least 1');
  assert.deepEqual(sanitizeSettings({ blueInspirationGainMean: [30, 30, 30] }).blueInspirationGainMean, DEFAULT_SETTINGS.blueInspirationGainMean);
});
