// The app's shared context: the loaded data, the persisted store, transient view state, and the memoized run plan.
// Panels mutate the store through update(), which persists and re-renders.
import { BUILD_VERSION } from 'virtual:build-version';
import { planningKey } from '../recommendation.ts';
import { loadData } from '../data.ts';
import { loadState, saveState, saveRecommendation, type AppState } from '../state.ts';
import { planRun, isLegalRunSelection, type RunPlan, type DeckSelection } from '../model/run.ts';
import type { PlanWorkerRequest, PlanWorkerResponse } from './plan-worker.ts';
import defaultInventory from '../../inventory.json' with { type: 'json' };

export const data = loadData();
export const store: AppState = loadState(data, defaultInventory);
let inputKey = planningKey(store.run, store.settings, store.inventory);
export let stateRevision = 0;

/** State that is not persisted: search boxes, open panels, slider previews. */
export const view = {
  query: '',
  targetEditorId: null as number | null,
  goalTemplateId: '',
  traineeQuery: '',
  cardQuery: '',
  showAdvanced: false,
  showSparks: false,
  showPinkSparks: false,
  expandedRankingCards: [] as number[],
};

let renderer: () => void = () => {};
export function onRender(fn: () => void) { renderer = fn; }
/** Re-render after a view-only change. */
export function refresh() { renderer(); }
/** Apply a change to the persisted state, save it and re-render. */
export function update(fn: (s: AppState) => void) {
  fn(store);
  stateRevision++;
  const nextKey = planningKey(store.run, store.settings, store.inventory);
  if (nextKey !== inputKey) delete store.recommendation;
  inputKey = nextKey;
  saveState(store);
  renderer();
}

let cache: { key: string; value: RunPlan } | null = null;
export const searchState = { pending: false, error: '' };
let worker: Worker | null = null, requestId = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let previous: DeckSelection | undefined;
export function retrySearch() {
  delete store.recommendation;
  saveState(store);
  cache = null;
  renderer();
}
/** Keep the displayed cards while updating their estimates and searching after a pause in editing. */
export function plan(): RunPlan {
  const key = inputKey;
  if (cache?.key === key) return cache.value;
  clearTimeout(timer);
  worker?.terminate(); worker = null;
  const id = ++requestId;
  const saved = store.recommendation;
  const restored = saved?.build === BUILD_VERSION && saved.key === key
    && isLegalRunSelection(saved.selection, store.run, store.settings, store.inventory, data) ? saved : undefined;
  if (!restored) delete store.recommendation;
  const value = planRun(store.run, store.settings, store.inventory, data,
    restored ? { selection: restored.selection, summary: restored.summary, search: false } : { previous, search: false });
  previous = value.deckResult.deck.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: e.borrowed }));
  cache = { key, value };
  searchState.error = '';
  searchState.pending = !restored && !!value.trainee && !value.issues.length && store.run.goal.blueStats.length > 0;
  if (searchState.pending) timer = setTimeout(() => {
    const fail = () => {
      if (id !== requestId || cache?.key !== key) return;
      searchState.pending = false;
      searchState.error = 'Deck search could not finish.';
      worker?.terminate(); worker = null;
      renderer();
    };
    try {
      worker = new Worker(new URL('./plan-worker.ts', import.meta.url), { type: 'module' });
      worker.onerror = fail;
      worker.onmessage = (event: MessageEvent<PlanWorkerResponse>) => {
        if (id !== requestId || event.data.id !== id || cache?.key !== key) return;
        if (event.data.error) { fail(); return; }
        // Publish once, after both search stages, so intermediate results do not move the editor.
        if (!event.data.complete || !event.data.selection) return;
        cache.value = planRun(store.run, store.settings, store.inventory, data,
          { selection: event.data.selection, summary: event.data.summary, search: false });
        previous = event.data.selection;
        searchState.pending = false;
        worker?.terminate(); worker = null;
        if (event.data.summary && isLegalRunSelection(event.data.selection, store.run, store.settings, store.inventory, data)) {
          saveRecommendation(store, { build: BUILD_VERSION, key, selection: event.data.selection, summary: event.data.summary });
        }
        renderer();
      };
      worker.postMessage({ id, run: store.run, settings: store.settings, inventory: store.inventory, previous } satisfies PlanWorkerRequest);
    } catch { fail(); }
  }, 400);
  return value;
}
