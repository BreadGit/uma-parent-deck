import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { effectiveLb } from '../src/model/run.ts';
import { defaultState, hasNewerSave, isStorageUnavailable, loadState, removeUnreadableSave, replaceNewerSave, saveRecommendation, saveState, STATE_KEY, STATE_VERSION, storedIfChanged, UNREADABLE_KEY, unreadableSave } from '../src/state.ts';

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
    assert.equal(isStorageUnavailable(), true);
    assert.equal(loaded.ui.theme, 'dark');
    assert.deepEqual(JSON.parse(saved.get(STATE_KEY)!), original);
    blocked = true;
    assert.deepEqual(loadState(data, { 30028: 3 }).inventory, { 30028: 3 });
    assert.equal(saveState(loaded), false);
    blocked = full = false;
    assert.equal(saveState(loaded), true);
    assert.equal(isStorageUnavailable(), false);
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

test('an unreadable save is moved aside when the page loads and stays until removed', () => {
  const data = loadData();
  for (const unreadable of ['{invalid: audit probe', 'null', '{"version":"24"}', '{"version":24.5,"run":{}}']) {
    const saved = new Map([[STATE_KEY, unreadable]]);
    withStorage(saved, () => {
      const loaded = loadState(data, { 30028: 3 });
      assert.deepEqual(loaded.inventory, {}, 'a browser with an unreadable save is not fresh, so the bundled inventory is not loaded');
      assert.equal(unreadableSave(), unreadable);
      assert.deepEqual(JSON.parse(saved.get(STATE_KEY)!), loaded);
      loaded.ui.theme = 'dark';
      assert.equal(saveState(loaded), true);
      assert.equal(unreadableSave(), unreadable, 'the copy survives edits');
      removeUnreadableSave();
      loadState(data, {});
      assert.equal(unreadableSave(), null, 'a reload finds nothing unreadable');
    });
  }
  const fresh = new Map<string, string>();
  withStorage(fresh, () => {
    assert.deepEqual(loadState(data, { 30028: 3 }).inventory, { 30028: 3 }, 'a fresh browser starts from the bundled inventory');
    assert.equal(fresh.has(UNREADABLE_KEY), false);
  });
});

test('an unreadable save without room for a copy stays in place', () => {
  const data = loadData(), unreadable = '{invalid: audit probe';
  const saved = new Map([[STATE_KEY, unreadable]]);
  withStorage(saved, () => {
    loadState(data, {});
    assert.equal(unreadableSave(), null);
    assert.equal(saved.get(STATE_KEY), unreadable);
  }, true);
});

test('a browser with only legacy blobs starts from the bundled inventory, and the old LB4 default owns the rest', () => {
  const data = loadData();
  withStorage(new Map([['uma-parent-deck.settings', JSON.stringify({ version: 3 })]]), () => {
    const loaded = loadState(data, { 30028: 3 });
    const shown = data.cards.filter((card) => effectiveLb(loaded.inventory, card, { R: null, SR: null, SSR: null }) !== (card.id === 30028 ? 3 : 4));
    assert.deepEqual(shown.map((card) => card.id), []);
  });
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
    assert.equal(hasNewerSave(), true);
    assert.deepEqual(loaded.inventory, { 30028: 2 }, 'the choices this version understands are shown');
    loaded.ui.theme = 'dark';
    assert.equal(saveState(loaded), false);
    assert.equal(saved.get(STATE_KEY), raw, 'ordinary edits leave the newer save intact');
    assert.equal(isStorageUnavailable(), false, 'a newer save is not reported as unavailable storage');
    assert.equal(replaceNewerSave(loaded), true, 'the user can choose to replace it');
    assert.equal(hasNewerSave(), false);
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
    assert.equal(hasNewerSave(), true);
    const other = defaultState(data);
    other.settings.focus = 'balanced';
    saved.set(STATE_KEY, JSON.stringify(other));
    assert.equal(storedIfChanged(data)?.settings.focus, 'balanced');
    assert.equal(hasNewerSave(), false);
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
    saved.set(STATE_KEY, '{broken save');
    assert.equal(storedIfChanged(data), null, 'an unreadable save is not taken over');
    page.ui.sortKey = 'speed';
    assert.equal(saveState(page), true);
    assert.equal(storedIfChanged(data), null, "this page's own write is not another tab's change");
    const recommendation = { build: 'x', key: 'k', selection: [], summary: {} } as unknown as Parameters<typeof saveRecommendation>[1];
    saved.set(STATE_KEY, JSON.stringify(other));
    saveRecommendation(page, recommendation);
    assert.equal(JSON.parse(saved.get(STATE_KEY)!).settings.focus, 'balanced', 'the optional cache does not overwrite a save not taken over yet');
  });
});
