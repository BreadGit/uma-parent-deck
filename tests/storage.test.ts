import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { defaultState, loadState, saveState, STATE_KEY, storageUnavailable } from '../src/state.ts';

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
