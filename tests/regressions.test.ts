import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings.ts';
import { defaultState, migrate, resetRun } from '../src/state.ts';
import { buildSchedule, expectedFansBefore, goalRaces, scheduleSummary, traineeAptitudes } from '../src/model/races.ts';
import { eventSources } from '../src/model/sparks.ts';

const data = loadData();
const settings = () => structuredClone(DEFAULT_SETTINGS);

test('card event sources follow changes to the same settings object, including nested arrays', () => {
  const s = settings(), creek = data.cardById.get(30016)!;
  const chance = () => eventSources(creek, s, data).find((src) => src.skillId === 200351)!.pObtain;
  assert.equal(chance(), 0.12);
  s.chainRatesSSR[2] = 1;
  assert.equal(chance(), 1);
  s.chainRatesSSR = [0, 0, 0];
  assert.equal(chance(), 0);
});

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

test('every trainee agenda has at most one selected race per slot', () => {
  for (const ch of data.characters) {
    const schedule = buildSchedule(data.races, traineeAptitudes(ch, {}), 0.8, new Map(), new Map(), goalRaces(ch));
    const selected = schedule.filter((s) => s.selected);
    assert.equal(selected.length, new Set(selected.map((s) => s.slot)).size, ch.name);
  }
});

test('duplicate objective input cannot count race rewards twice', () => {
  const brian = data.charByCardId.get(101601)!;
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
