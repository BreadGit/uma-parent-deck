// The app's shared context: the loaded data, the persisted store, transient view state, and the memoized run plan.
// Panels mutate the store through update(), which persists and re-renders.
import { loadData } from '../data.ts';
import { loadState, saveState, type AppState } from '../state.ts';
import { planRun, type RunPlan, type DeckSelection } from '../model/run.ts';
import { canReusePrioritySearch } from '../model/priority-search.ts';
import type { PlanWorkerRequest, PlanWorkerResponse } from './plan-worker.ts';
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

let cache: { key: string; inputsKey: string; order: number[]; value: RunPlan } | null = null;
export const searchState = { pending: false, error: '' };
let worker: Worker | null = null, requestId = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let previous: DeckSelection | undefined;
export function retrySearch() { cache = null; renderer(); }
/** Keep the displayed cards while updating their estimates and searching after a pause in editing. */
export function plan(): RunPlan {
  const key = JSON.stringify([store.run, store.settings, store.inventory]);
  if (cache?.key === key) return cache.value;
  const { wishlistOrder, ...otherRunInputs } = store.run;
  const inputsKey = JSON.stringify([otherRunInputs, store.settings, store.inventory]);
  // A compatible reorder keeps the request generation; its response uses the latest order below.
  if (cache?.inputsKey === inputsKey && !searchState.error && canReusePrioritySearch(cache.order, wishlistOrder, store.run.targets, data)) {
    const selection = cache.value.deckResult.deck.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: e.borrowed }));
    const value = planRun(store.run, store.settings, store.inventory, data,
      { selection, summary: cache.value.search ?? undefined, search: false });
    cache = { key, inputsKey, order: [...wishlistOrder], value };
    return value;
  }
  clearTimeout(timer);
  worker?.terminate(); worker = null;
  const id = ++requestId;
  const value = planRun(store.run, store.settings, store.inventory, data, { previous, search: false });
  previous = value.deckResult.deck.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: e.borrowed }));
  cache = { key, inputsKey, order: [...wishlistOrder], value };
  searchState.error = '';
  searchState.pending = !!value.trainee && !value.issues.length && store.run.goal.blueStats.length > 0;
  if (searchState.pending) timer = setTimeout(() => {
    const fail = () => {
      if (id !== requestId || cache?.inputsKey !== inputsKey) return;
      searchState.pending = false;
      searchState.error = 'Deck search could not finish.';
      worker?.terminate(); worker = null;
      renderer();
    };
    try {
      worker = new Worker(new URL('./plan-worker.ts', import.meta.url), { type: 'module' });
      worker.onerror = fail;
      worker.onmessage = (event: MessageEvent<PlanWorkerResponse>) => {
        if (id !== requestId || event.data.id !== id || cache?.inputsKey !== inputsKey) return;
        if (event.data.error) { fail(); return; }
        // Publish once, after both search stages, so intermediate results do not move the editor.
        if (!event.data.complete || !event.data.selection) return;
        cache.value = planRun(store.run, store.settings, store.inventory, data,
          { selection: event.data.selection, summary: event.data.summary, search: false });
        previous = event.data.selection;
        searchState.pending = false;
        worker?.terminate(); worker = null;
        renderer();
      };
      worker.postMessage({ id, run: store.run, settings: store.settings, inventory: store.inventory, previous } satisfies PlanWorkerRequest);
    } catch { fail(); }
  }, 400);
  return value;
}
