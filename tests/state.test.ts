import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { defaultPins, migrate, sanitizeInventory, STATE_VERSION } from '../src/state.ts';
import { DEFAULT_SETTINGS, parseSetting, sanitizeSettings } from '../src/settings.ts';

const data = loadData();

test('nothing saved gives the defaults with Light Hello pinned', () => {
  const s = migrate({}, data);
  assert.equal(s.version, STATE_VERSION);
  assert.deepEqual(s.run.pinnedIds, defaultPins(data));
  assert.equal(data.cardById.get(s.run.pinnedIds[0]!)?.charName, 'Light Hello');
  assert.deepEqual(s.settings, DEFAULT_SETTINGS);
  assert.deepEqual(s.inventory, {});
  assert.deepEqual(s.ui, { sortKey: 'score', theme: 'system' });
});

test('v1 run state: single pin, combined blue stars and {n, stars} lineage migrate', () => {
  const v1 = { targets: [200352], pinnedId: 30028, blueStars: [9, 9, 3, 0, 0], targetLineage: { '200352': { n: 3, stars: 3 } }, sortKey: 'stats' };
  const s = migrate({ state: v1 }, data);
  assert.deepEqual(s.run.pinnedIds, [30028]);
  assert.deepEqual(s.run.parentGains, [[63, 0, 0, 0, 0], [0, 63, 21, 0, 0]], 'parent 1 fills first, the rest goes to parent 2, stars become start gains');
  assert.deepEqual(s.run.targetLineage['200352'], { k1: 2, k2: 1, p1: 6, p2: 3 });
  assert.equal(s.ui.sortKey, 'stats');
});

test('v2 run state passes through and malformed fields fall back', () => {
  const v2 = { targets: [200352, 'x'], pinnedIds: [30052, 30028], parentStars: [[1, 2, 3, 0, 0], [0, 0, 0, 4, 5]], targetLineage: { '200352': { k1: 1, k2: 0, p1: 3, p2: 0 } }, raceOverrides: { a: true, b: 'no' }, traineeStars: 'five' };
  const s = migrate({ state: v2 }, data);
  assert.deepEqual(s.run.targets, [200352]);
  assert.deepEqual(s.run.pinnedIds, [30052, 30028]);
  assert.deepEqual(s.run.parentGains, [[5, 12, 21, 0, 0], [0, 0, 0, 26, 33]], 'v2 stars per stat pack into sparks: 4★ is 3★+1★ (+26), 5★ is 3★+2★ (+33)');
  assert.deepEqual(s.run.targetLineage, { '200352': { k1: 1, k2: 0, p1: 3, p2: 0 } });
  assert.deepEqual(s.run.raceOverrides, { a: true });
  assert.equal(s.run.traineeStars, 3);
});

test('legacy settings blobs: version bumps apply and invalid values are dropped', () => {
  const s1 = migrate({ settings: { version: 1, defaultLb: { R: 4, SR: 4, SSR: 0 }, showUnowned: false, ssStarOdds: [0.5, 0.5], hintBase: 0.1 } }, data);
  assert.equal(s1.settings.defaultLb.SSR, 4, 'v1 -> SSR default LB becomes 4');
  assert.equal(s1.settings.showUnowned, true, 'v2 -> unowned shown by default');
  assert.deepEqual(s1.settings.ssStarOdds, DEFAULT_SETTINGS.ssStarOdds, 'a two-entry list is rejected');
  assert.equal(s1.settings.hintBase, 0.1);
  const s3 = migrate({ settings: { version: 3, showUnowned: false, defaultLb: { R: 2, SR: 3, SSR: 1 } } }, data);
  assert.equal(s3.settings.showUnowned, false);
  assert.deepEqual(s3.settings.defaultLb, { R: 2, SR: 3, SSR: 1 });
});

test('v4 saves (stars per parent) become v5 start gains; v5 gains that the screen cannot show are dropped', () => {
  const v4 = { version: 4, run: { parentStars: [[9, 3, 0, 0, 0], [0, 0, 0, 0, 0]] }, settings: {}, inventory: {}, ui: { sortKey: 'score', theme: 'light' } };
  const s = migrate({ current: v4 }, data);
  assert.equal(s.version, 5);
  assert.deepEqual(s.run.parentGains, [[63, 21, 0, 0, 0], [0, 0, 0, 0, 0]]);
  const v5 = { version: 5, run: { parentGains: [[26, 7, 0, 0, 0], [0, 0, 0, 0, 63]] } };
  assert.deepEqual(migrate({ current: v5 }, data).run.parentGains, [[26, 0, 0, 0, 0], [0, 0, 0, 0, 63]], '+7 is not a possible sum');
});

test('the current shape round-trips and wins over legacy keys', () => {
  const cur = migrate({}, data);
  cur.run.targets = [201601]; cur.settings.winThreshold = 0.6; cur.inventory = { '30028': 2, '30052': null }; cur.ui = { sortKey: 'sp', theme: 'dark' };
  const back = migrate({ current: JSON.parse(JSON.stringify(cur)), state: { targets: [999] }, settings: { winThreshold: 0.1 }, inventory: { '1': 1 }, theme: 'light' }, data);
  assert.deepEqual(back, cur);
});

test('garbage in every slot gives the defaults', () => {
  const s = migrate({ current: 'nope', state: 42, settings: [1], inventory: 'x', theme: 'neon' }, data);
  assert.deepEqual(s, migrate({}, data));
});

test('inventory entries must be numeric ids with LB 0..4 or null', () => {
  assert.deepEqual(sanitizeInventory({ '30028': 4, '30052': null, '1': 7, abc: 2, '2': '3', '3': 2.5 }), { '30028': 4, '30052': null });
});

test('parseSetting enforces each spec', () => {
  assert.equal(parseSetting('winThreshold', '0.7'), 0.7);
  assert.equal(parseSetting('winThreshold', '1.5'), undefined);
  assert.equal(parseSetting('winThreshold', 'abc'), undefined);
  assert.deepEqual(parseSetting('chainRatesSSR', '0.5, 0.3 0.1'), [0.5, 0.3, 0.1]);
  assert.equal(parseSetting('chainRatesSSR', '0.5, 0.3'), undefined, 'wrong length');
  assert.equal(parseSetting('totalTurnsOverride', ''), null);
  assert.equal(parseSetting('totalTurnsOverride', '70'), 70);
  assert.equal(parseSetting('focus', 'sprint'), 'sprint');
  assert.equal(parseSetting('focus', 'fast'), undefined);
  assert.equal(parseSetting('showUnowned', false), false);
  assert.equal(parseSetting('defaultLb', '4'), undefined);
  assert.deepEqual(sanitizeSettings({ affinity: -1, hintScale: 2 }), { ...DEFAULT_SETTINGS, hintScale: 2 });
});
