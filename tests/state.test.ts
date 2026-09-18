import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from './helpers.ts';
import { loadData } from '../src/data.ts';
import { defaultPins, defaultState, migrate, sanitizeInventory, STATE_VERSION } from '../src/state.ts';
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
  assert.deepEqual(s1.run.targetLineage['200352'], { k1: 2, k2: 1, p1: 6, p2: 3 });
  assert.equal(s1.ui.sortKey, 'stats');
  const v2 = { targets: [200352, 'x'], pinnedIds: [30052, 30028], parentStars: [[1, 2, 3, 0, 0], [0, 0, 0, 4, 5]], targetLineage: { '200352': { k1: 1, k2: 0, p1: 3, p2: 0 } }, raceOverrides: { a: true, b: 'no' }, traineeStars: 'five' };
  const s2 = migrate({ state: v2 }, data);
  assert.deepEqual(s2.run.targets, [{ id: 200352, role: 'preferred', stars: 2, priority: 0 }]);
  assert.deepEqual(s2.run.pinnedIds, [30052, 30028]);
  assert.deepEqual(s2.run.parentSparks, [[{ stat: 'speed', stars: 1 }, { stat: 'stamina', stars: 2 }, { stat: 'power', stars: 3 }], defaultParentSparks()], 'v2 stars per stat become one uma each; 4★ Guts and 5★ Wit pack into four sparks, so that side is the default');
  assert.deepEqual(s2.run.targetLineage, { '200352': { k1: 1, k2: 0, p1: 3, p2: 0 } });
  assert.deepEqual(s2.run.raceOverrides, { a: true });
  assert.equal(s2.run.traineeStars, 3);
  const sw = must(data.characters.find((c) => c.name === 'Special Week'), `data.characters.find((c) => c.name === 'Special Week')`);
  assert.equal(migrate({ state: { traineeCardId: sw.cardId, traineeStars: 1 } }, data).run.traineeStars, 3, 'a star count below the trainee\'s rarity is raised to it');
  assert.equal(migrate({ state: { traineeCardId: sw.cardId, traineeStars: 7 } }, data).run.traineeStars, 5);
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
  assert.equal(s1.settings.defaultLb.SSR, 4, 'v1 -> SSR default LB becomes 4');
  assert.equal(s1.ui.showUnowned, true, 'v2 -> unowned shown by default');
  assert.deepEqual(s1.settings.chainRatesSSR, DEFAULT_SETTINGS.chainRatesSSR, 'a two-entry list is rejected');
  assert.equal(s1.settings.hintBase, 0.1);
  const s3 = migrate({ settings: { version: 3, showUnowned: false, defaultLb: { R: 2, SR: 3, SSR: 1 } } }, data);
  assert.equal(s3.ui.showUnowned, false);
  assert.deepEqual(s3.settings.defaultLb, { R: 2, SR: 3, SSR: 1 });
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
    assert.deepEqual(restored.inventory, saved.inventory);
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
  assert.equal(parseSetting('defaultLb', '4'), undefined);
  assert.equal(parseSetting('scenarioId', '5'), undefined, 'only the supported scenario');
  assert.equal(parseSetting('scenarioId', '3'), 3);
  assert.equal(sanitizeSettings({ scenarioId: '3' }).scenarioId, 3, 'a string is not the number the model compares with');
  assert.equal(sanitizeSettings({ focus: 3 }).focus, 'stamina');
  assert.deepEqual(sanitizeSettings({ affinity: -1, hintScale: 2, bigRewardRate: 0.3 } as Record<string, unknown>), { ...DEFAULT_SETTINGS, hintScale: 2 }, 'out-of-range and retired keys are dropped');
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
