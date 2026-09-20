import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from './helpers.ts';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVersion, parseBuildVersion } from '../scripts/build-version.ts';
import { loadData } from '../src/data.ts';
import { defaultState, migrate, resetRun, saveRecommendation, STATE_VERSION } from '../src/state.ts';
import { parseRecommendation, planningKey } from '../src/recommendation.ts';
import { isLegalRunSelection, planRun, type GoalSearchSummary } from '../src/model/run.ts';

const data = loadData();
const state = defaultState(data);
state.run.traineeCardId = 100101;
const plan = planRun(state.run, state.settings, state.inventory, data, { search: false });
const selection = plan.deckResult.deck.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: e.borrowed }));
const summary: GoalSearchSummary = { evaluated: 1, screened: 0, exhaustive: false, unavailableWhiteIds: [],
  score: { count: 2, total: 2, comparison: .5, probability: .4, upperProbability: .4, preferred: 0, whiteIds: [], blue: true, pink: true, approximate: false, subsetApproximate: false } };
const keyOf = (s = state) => planningKey(s.run, s.settings, s.inventory);
const recommendation = { build: 'build-a', key: keyOf(), selection, summary };

test('recommendation fingerprints include every run, setting and inventory field and survive migration ordering', () => {
  assert.equal(keyOf(migrate({ current: state }, data)), keyOf());
  // The arrangement of the extra prioritized skills changes the plan shown, not the deck search, so it is not in the key.
  const displayOnly = new Set(['wishlistOrder', 'wishlistExcluded']);
  for (const section of ['run', 'settings', 'inventory'] as const) {
    for (const key of [...Object.keys(state[section]), 'future-field']) {
      const changed = structuredClone(state);
      Object.assign(changed[section], { [key]: 'changed' });
      if (section === 'run' && displayOnly.has(key)) assert.equal(keyOf(changed), keyOf(), `${section}.${key} is display-only`);
      else assert.notEqual(keyOf(changed), keyOf(), `${section}.${key}`);
    }
  }
  const changedUi = structuredClone(state);
  changedUi.ui.theme = 'dark'; changedUi.ui.sortKey = 'stats';
  changedUi.ui.showUnowned = false;
  assert.equal(keyOf(changedUi), keyOf());
  const reordered = { ...state, run: Object.fromEntries(Object.entries(state.run).reverse()) as typeof state.run };
  assert.equal(keyOf(reordered), keyOf());
});

test('only well-formed recommendations survive current-state migration, and reset discards them', () => {
  const saved = { ...state, recommendation };
  assert.deepEqual(migrate({ current: saved }, data), saved);
  assert.equal(migrate({ current: { ...saved, version: STATE_VERSION - 1 } }, data).recommendation, undefined);
  assert.equal(resetRun(saved, data).recommendation, undefined);
  assert.deepEqual(resetRun(saved, data).inventory, state.inventory);
  for (const raw of [null, {}, { ...recommendation, selection: [{ id: 1, lb: 99 }] },
    { ...recommendation, summary: {} }, { ...recommendation, summary: { ...summary, score: { ...summary.score, probability: NaN } } }]) {
    assert.equal(parseRecommendation(raw), undefined);
    const migrated = migrate({ current: { ...saved, recommendation: raw } }, data);
    assert.equal(migrated.recommendation, undefined);
    assert.deepEqual(migrated.run, state.run);
  }
});

test('restored decks obey current ownership, limit breaks, pins, borrowed slots and trainee exclusion', () => {
  const legal = (entries = selection, current = state) => isLegalRunSelection(entries, current.run, current.settings, current.inventory, data);
  assert.equal(legal(), true);
  const owned = must(selection.find((e) => !e.borrowed), `selection.find((e) => !e.borrowed)`);
  for (const value of [null, 0]) {
    const changed = structuredClone(state); changed.inventory[String(owned.id)] = value;
    assert.equal(legal(selection, changed), false);
  }
  assert.equal(legal(selection.slice(1)), false);
  assert.equal(legal(selection.map((e) => ({ ...e, borrowed: false }))), false);
  assert.equal(legal(selection.map((e) => ({ ...e, borrowed: true }))), false);
  assert.equal(legal(selection.map((e, i) => i ? e : { ...e, id: -1 })), false);
  assert.equal(legal(selection.map((e, i) => i === 1 ? selection[0]! : e)), false);
  const pin = must(data.cards.find((card) => !selection.some((e) => must(data.cardById.get(e.id), `data.cardById.get(${e.id})`).charId === card.charId) && card.charId !== plan.trainee!.charId), `data.cards.find((card) => !selection.some((e) => data.cardById.get(e.id).charId === car...`);
  const pinned = structuredClone(state); pinned.run.pinnedIds.push(pin.id);
  assert.equal(legal(selection, pinned), false);
  const changedTrainee = structuredClone(state);
  changedTrainee.run.traineeCardId = must(data.characters.find((c) => selection.some((e) => must(data.cardById.get(e.id), `data.cardById.get(${e.id})`).charId === c.charId)), `data.characters.find((c) => selection.some((e) => data.cardById.get(e.id).charId === c....`).cardId;
  assert.equal(legal(selection, changedTrainee), false);
});

test('cache storage failure keeps inputs usable and does not retain an unsaved recommendation', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem() { throw new Error('quota'); } } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else Reflect.deleteProperty(globalThis, 'localStorage'); });
  const current = structuredClone(state);
  saveRecommendation(current, recommendation);
  assert.deepEqual(current, state);
});

test('the recommendation build version changes automatically with source, data and dependency contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'uma-build-version-'));
  try {
    for (const dir of ['src', 'data', 'scripts']) mkdirSync(join(root, dir));
    const files = ['src/main.ts', 'data/cards.json', 'inventory.json', 'package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'scripts/build-version.ts'];
    for (const file of files) writeFileSync(join(root, file), 'initial');
    const initial = buildVersion(root);
    assert.equal(buildVersion(root), initial);
    for (const file of files) {
      writeFileSync(join(root, file), 'changed');
      assert.notEqual(buildVersion(root), initial, file);
      writeFileSync(join(root, file), 'initial');
      assert.equal(buildVersion(root), initial);
    }
    writeFileSync(join(root, 'src/new-model.ts'), 'new source');
    assert.notEqual(buildVersion(root), initial);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a dev server reports its build version through the virtual module and a preview build reports none', () => {
  const hash = 'a'.repeat(64);
  assert.equal(parseBuildVersion(`export const BUILD_VERSION = "${hash}";\n//# sourceMappingURL=data:application/json;base64,e30=`), hash);
  assert.equal(parseBuildVersion('<!doctype html>\n<html lang="en">'), null);
  assert.equal(parseBuildVersion(''), null);
  assert.equal(parseBuildVersion('export const BUILD_VERSION = "not-a-hash";'), null);
});
