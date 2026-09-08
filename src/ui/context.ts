// The app's shared context: the loaded data, the persisted store, transient view state, and the memoized run plan.
// Panels mutate the store through update(), which persists and re-renders.
import { loadData } from '../data.ts';
import { loadState, saveState, type AppState } from '../state.ts';
import { planRun, type RunPlan } from '../model/run.ts';
import defaultInventory from '../../inventory.json' with { type: 'json' };

export const data = loadData();
export const store: AppState = loadState(data, defaultInventory);

/** State that is not persisted: search boxes, open panels, slider previews. */
export const view = {
  query: '',
  traineeQuery: '',
  cardQuery: '',
  showAdvanced: false,
  showSparks: false,
};

let renderer: () => void = () => {};
export function onRender(fn: () => void) { renderer = fn; }
/** Re-render after a view-only change. */
export function refresh() { renderer(); }
/** Apply a change to the persisted state, save it and re-render. */
export function update(fn: (s: AppState) => void) { fn(store); saveState(store); renderer(); }

let cache: { key: string; value: RunPlan } | null = null;
/** The current run plan, recomputed only when the run, settings or inventory changed. */
export function plan(): RunPlan {
  const key = JSON.stringify([store.run, store.settings, store.inventory]);
  if (cache && cache.key === key) return cache.value;
  const value = planRun(store.run, store.settings, store.inventory, data);
  cache = { key, value };
  return value;
}
