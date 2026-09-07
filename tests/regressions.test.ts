import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings.ts';
import { defaultState, migrate, resetRun } from '../src/state.ts';

const data = loadData();

test('new states and resets do not share mutable run or settings defaults', () => {
  const a = defaultState(data), b = defaultState(data);
  a.run.targets.push(201601);
  a.run.parentGains[0]![0] = 63;
  a.settings.chainRatesSSR[0] = 0;
  assert.deepEqual(b.run.targets, []);
  assert.deepEqual(b.run.parentGains, [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]]);
  assert.equal(b.settings.chainRatesSSR[0], 0.69);
  const reset = resetRun(a, data);
  assert.deepEqual(reset.run.targets, []);
  assert.equal(reset.run.parentGains[0]![0], 0);
  assert.equal(reset.settings, a.settings);
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
