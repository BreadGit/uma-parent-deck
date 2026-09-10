// The app's shared context: the loaded data, the persisted store, transient view state, and the memoized run plan.
// Panels mutate the store through update(), which persists and re-renders.
import { loadData } from '../data.ts';
import { loadState, saveState, type AppState } from '../state.ts';
import { planRun, type RunPlan, type RunOptions } from '../model/run.ts';
import defaultInventory from '../../inventory.json' with { type: 'json' };

export const data = loadData();
export const store: AppState = loadState(data, defaultInventory);

/** State that is not persisted: search boxes, open panels, slider previews. */
export const view = {
  query: '',
  targetEditorId: null as number | null,
  traineeQuery: '',
  cardQuery: '',
  showAdvanced: false,
  showSparks: false,
  showPinkSparks: false,
};

let renderer: () => void = () => {};
export function onRender(fn: () => void) { renderer = fn; }
/** Re-render after a view-only change. */
export function refresh() { renderer(); }
/** Apply a change to the persisted state, save it and re-render. */
export function update(fn: (s: AppState) => void) { fn(store); saveState(store); renderer(); }

let cache: { key: string; value: RunPlan } | null = null;
export const searchState = { pending: false, error: '' };
let worker: Worker | null = null, requestId = 0;
export function retrySearch() { cache = null; renderer(); }
/** The current run plan, recomputed only when the run, settings or inventory changed. */
export function plan(): RunPlan {
  const key = JSON.stringify([store.run, store.settings, store.inventory]);
  if (cache && cache.key === key) return cache.value;
  if (searchState.pending) { worker?.terminate(); worker = null; }
  const id = ++requestId;
  const value = planRun(store.run, store.settings, store.inventory, data, { search: false });
  cache = { key, value };
  searchState.error = '';
  searchState.pending = !!value.trainee && !value.issues.length && store.run.goal.blueStats.length > 0;
  if (searchState.pending) {
    worker ??= new Worker(new URL('./plan-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<RunOptions & { id: number; error?: string }>) => {
      if (event.data.id !== requestId || cache?.key !== key) return;
      searchState.pending = false;
      searchState.error = event.data.error ?? '';
      if (!searchState.error) cache.value = planRun(store.run, store.settings, store.inventory, data, { ...event.data, search: false });
      renderer();
    };
    worker.onerror = () => {
      if (id !== requestId) return;
      searchState.pending = false;
      searchState.error = 'Deck search could not finish.';
      worker?.terminate(); worker = null;
      renderer();
    };
    worker.postMessage({ id, run: store.run, settings: store.settings, inventory: store.inventory });
  }
  return value;
}
