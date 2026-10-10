import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { defaultState, loadState, removeUnreadableSave, saveState, STATE_KEY, storageUnavailable, UNREADABLE_KEY, unreadableSave } from '../src/state.ts';

test('storage failures preserve in-memory edits and an existing save, then recover', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = loadData(), original = defaultState(data);
  original.inventory = { 30028: 2 };
  const saved = new Map([[STATE_KEY, JSON.stringify(original)]]);
  let blocked = false, full = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() {
    if (blocked) throw new DOMException('Blocked', 'SecurityError');
    return {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (full) throw new DOMException('Full', 'QuotaExceededError');
        saved.set(key, value);
      },
    };
  } });
  try {
    const loaded = loadState(data, {});
    assert.deepEqual(loaded.inventory, original.inventory);
    full = true;
    loaded.ui.theme = 'dark';
    assert.equal(saveState(loaded), false);
    assert.equal(storageUnavailable, true);
    assert.equal(loaded.ui.theme, 'dark');
    assert.deepEqual(JSON.parse(saved.get(STATE_KEY)!), original);
    blocked = true;
    assert.deepEqual(loadState(data, { 30028: 3 }).inventory, { 30028: 3 });
    assert.equal(saveState(loaded), false);
    blocked = full = false;
    assert.equal(saveState(loaded), true);
    assert.equal(storageUnavailable, false);
    assert.deepEqual(loadState(data, {}).ui, loaded.ui);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

/** A Map-backed localStorage for one test. */
function withStorage(saved: Map<string, string>, run: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  } });
  try { run(); } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

test('an unreadable save is copied aside before an edit replaces it, and the copy stays until removed', () => {
  const data = loadData();
  for (const unreadable of ['{invalid: audit probe', 'null', '{"version":"24"}', '{"version":24.5,"run":{}}']) {
    const saved = new Map([[STATE_KEY, unreadable]]);
    withStorage(saved, () => {
      const loaded = loadState(data, { 30028: 3 });
      assert.deepEqual(loaded.inventory, {}, 'a browser with an unreadable save is not fresh, so the bundled inventory is not loaded');
      assert.equal(unreadableSave(), unreadable);
      assert.equal(saved.get(STATE_KEY), unreadable, 'loading alone does not replace the original');
      loaded.ui.theme = 'dark';
      assert.equal(saveState(loaded), true);
      assert.equal(saved.get(UNREADABLE_KEY), unreadable, 'the copy survives the first edit');
      saved.set(STATE_KEY, '{also unreadable');
      loadState(data, {});
      assert.equal(saved.get(UNREADABLE_KEY), unreadable, 'a later unreadable save never replaces a copy the user has not removed');
      removeUnreadableSave();
      assert.equal(unreadableSave(), null);
    });
  }
  const fresh = new Map<string, string>();
  withStorage(fresh, () => {
    assert.deepEqual(loadState(data, { 30028: 3 }).inventory, { 30028: 3 }, 'a fresh browser starts from the bundled inventory');
    assert.equal(fresh.has(UNREADABLE_KEY), false);
  });
});
