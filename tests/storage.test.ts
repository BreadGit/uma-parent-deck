import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { defaultState, loadState, newerSave, removeUnreadableSave, replaceNewerSave, saveRecommendation, saveState, STATE_KEY, STATE_VERSION, storageUnavailable, storedIfChanged, uncopiedUnreadable, UNREADABLE_KEY, unreadableSave } from '../src/state.ts';

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

/** A Map-backed localStorage for one test; `full` rejects writes to new keys, as a browser out of quota would. */
function withStorage(saved: Map<string, string>, run: () => void, full = false) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (full && !saved.has(key)) throw new DOMException('Full', 'QuotaExceededError');
      saved.set(key, value);
    },
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

test('an unreadable save without room for a copy stays in place until the user replaces it', () => {
  const data = loadData(), unreadable = '{invalid: audit probe';
  const saved = new Map([[STATE_KEY, unreadable]]);
  withStorage(saved, () => {
    const loaded = loadState(data, {});
    assert.equal(saved.has(UNREADABLE_KEY), false, 'there is no room for the copy');
    assert.equal(uncopiedUnreadable, unreadable);
    assert.equal(unreadableSave(), unreadable, 'the original is still offered as a download');
    loaded.ui.theme = 'dark';
    assert.equal(saveState(loaded), false);
    assert.equal(saved.get(STATE_KEY), unreadable, 'an ordinary edit does not overwrite the only copy');
    assert.equal(storageUnavailable, false, 'a kept unreadable save is not reported as unavailable storage');
    removeUnreadableSave();
    assert.equal(unreadableSave(), null);
    assert.equal(saveState(loaded), true, 'replacing it lets the page save again');
    assert.equal(JSON.parse(saved.get(STATE_KEY)!).ui.theme, 'dark');
  }, true);
});

test('a save from a newer version is read but never replaced until the user chooses to', () => {
  const data = loadData();
  const future = { ...defaultState(data), version: STATE_VERSION + 1, futureField: 1 };
  future.run = { ...future.run, newRunField: 'kept' } as typeof future.run;
  future.inventory = { 30028: 2 };
  const raw = JSON.stringify(future);
  const saved = new Map([[STATE_KEY, raw]]);
  withStorage(saved, () => {
    const loaded = loadState(data, {});
    assert.equal(newerSave, true);
    assert.deepEqual(loaded.inventory, { 30028: 2 }, 'the choices this version understands are shown');
    loaded.ui.theme = 'dark';
    assert.equal(saveState(loaded), false);
    assert.equal(saved.get(STATE_KEY), raw, 'ordinary edits leave the newer save intact');
    assert.equal(storageUnavailable, false, 'a newer save is not reported as unavailable storage');
    assert.equal(replaceNewerSave(loaded), true, 'the user can choose to replace it');
    assert.equal(newerSave, false);
    assert.equal(JSON.parse(saved.get(STATE_KEY)!).version, STATE_VERSION);
    assert.equal(JSON.parse(saved.get(STATE_KEY)!).ui.theme, 'dark');
  });
});

test('a page blocked by a newer save saves again once another tab replaces it with a supported save', () => {
  const data = loadData();
  const future = { ...defaultState(data), version: STATE_VERSION + 1 };
  const saved = new Map([[STATE_KEY, JSON.stringify(future)]]);
  withStorage(saved, () => {
    const page = loadState(data, {});
    assert.equal(newerSave, true);
    const other = defaultState(data);
    other.settings.focus = 'balanced';
    saved.set(STATE_KEY, JSON.stringify(other));
    assert.equal(storedIfChanged(data)?.settings.focus, 'balanced');
    assert.equal(newerSave, false);
    page.ui.sortKey = 'speed';
    assert.equal(saveState(page), true);
  });
});

test('a save another tab wrote is found before this page writes, even without its storage event', () => {
  const data = loadData();
  const saved = new Map([[STATE_KEY, JSON.stringify(defaultState(data))]]);
  withStorage(saved, () => {
    const page = loadState(data, {});
    assert.equal(storedIfChanged(data), null, 'nothing changed since loading');
    const other = defaultState(data);
    other.settings.focus = 'balanced';
    saved.set(STATE_KEY, JSON.stringify(other));
    const latest = storedIfChanged(data);
    assert.equal(latest?.settings.focus, 'balanced');
    assert.equal(storedIfChanged(data), null, 'a save is taken over once');
    page.ui.sortKey = 'speed';
    assert.equal(saveState(page), true);
    assert.equal(storedIfChanged(data), null, "this page's own write is not another tab's change");
    const recommendation = { build: 'x', key: 'k', selection: [], summary: {} } as unknown as Parameters<typeof saveRecommendation>[1];
    saved.set(STATE_KEY, JSON.stringify(other));
    saveRecommendation(page, recommendation);
    assert.equal(JSON.parse(saved.get(STATE_KEY)!).settings.focus, 'balanced', 'the optional cache does not overwrite a save not taken over yet');
  });
});
