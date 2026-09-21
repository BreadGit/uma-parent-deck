// The app's shared context: the loaded data, the persisted store, transient view state, and the memoized run plan.
// Panels mutate the store through update(), which persists and re-renders; view-only changes go through refresh().
import { guard } from 'lit-html/directives/guard.js';
import type { TemplateResult } from 'lit-html';
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

/** The view fields that hold a search box's text. */
export type SearchField = 'requiredQuery' | 'preferredQuery' | 'traineeQuery' | 'cardQuery' | 'ignoreQuery';
/** State that is not persisted: search boxes, open panels, the highlighted suggestion, drag state. */
const viewState = {
  /** Each target group has its own search box. */
  requiredQuery: '',
  preferredQuery: '',
  targetEditorId: null as number | null,
  /** The target groups start open; one holding the selected target is shown open regardless. */
  targetGroupsOpen: { required: true, preferred: true },
  goalTemplateId: '',
  traineeQuery: '',
  cardQuery: '',
  ignoreQuery: '',
  activeSearch: null as SearchField | null,
  /** Each search keeps its own keyboard highlight; -1 is none. */
  suggestIndexes: { requiredQuery: -1, preferredQuery: -1, traineeQuery: -1, cardQuery: -1, ignoreQuery: -1 } as Record<SearchField, number>,
  showAdvanced: false,
  showSparks: false,
  showPinkSparks: false,
  showAgenda: false,
  showDetails: false,
  expandedRankingCards: [] as number[],
  /** Advanced settings whose last typed value was rejected, with the accepted range. */
  settingErrors: {} as Record<string, { value: string; message: string }>,
  /** The prioritized-skill row being dragged and the row under the pointer. */
  drag: { key: null as number | null, over: null as number | null },
  /** The skill candidates below the prioritized list are clamped to three lines unless expanded. */
  showAllCandidates: false,
  /** Observed after layout by app.ts: whether the clamped candidates hide any. */
  candidatesOverflow: false,
};
export type View = typeof viewState;

// Each panel is rendered inside trackedPanel(), which records the view fields it reads and their values, so the
// panel re-renders only when the plan, the persisted state, its extra dependencies or one of those fields changed.
// Adding a view field never needs a dependency list updated by hand.
interface PanelMemo { token: object; deps: unknown[]; values: Map<keyof View, unknown> }
const panels = new Map<string, PanelMemo>();
let renderingPanel: string | null = null;
export const view: View = new Proxy(viewState, {
  get(target, key) {
    const k = key as keyof View;
    if (renderingPanel) panels.get(renderingPanel)?.values.set(k, target[k]);
    return target[k];
  },
}) as View;

/**
 * lit commits a template's children before moving to the next sibling, so every view read during this panel's
 * render, including inside repeat() item templates, lands in its own memo. The guard token only changes when a
 * dependency or a recorded view value changed, so an unchanged panel is skipped without walking its bindings.
 */
export function trackedPanel(name: string, deps: unknown[], render: () => TemplateResult) {
  let memo = panels.get(name);
  const stale = !memo || memo.deps.length !== deps.length || memo.deps.some((d, i) => d !== deps[i])
    || [...memo.values].some(([k, v]) => viewState[k] !== v);
  if (stale) { memo = { token: {}, deps, values: new Map() }; panels.set(name, memo); }
  return guard([memo!.token], () => { renderingPanel = name; return render(); });
}
export function endPanelTracking() { renderingPanel = null; }

let renderer: () => void = () => {};
let updated: () => void = () => {};
export function onRender(fn: () => void) { renderer = fn; }
/** Observe successful user edits, excluding recommendation-cache writes and view-only changes. */
export function onUpdate(fn: () => void) { updated = fn; }
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
  updated();
  renderer();
}

/** The search key plus the user's arrangement of the extras, which changes the plan shown but not the search. */
const displayKey = () => `${inputKey}${JSON.stringify([store.run.wishlistOrder, store.run.wishlistExcluded])}`;
let cache: { searchKey: string; displayKey: string; value: RunPlan } | null = null;
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
/**
 * Keep the displayed cards while updating their estimates and searching after a pause in editing. An edit to the
 * extra prioritized skills re-evaluates the deck shown and leaves any running search alone.
 */
export function plan(): RunPlan {
  const key = inputKey, shown = displayKey();
  if (cache?.displayKey === shown) return cache.value;
  const sameSearch = cache?.searchKey === key;
  if (!sameSearch) { clearTimeout(timer); worker?.terminate(); worker = null; }
  const id = sameSearch ? requestId : ++requestId;
  const saved = store.recommendation;
  const restored = saved?.build === BUILD_VERSION && saved.key === key
    && isLegalRunSelection(saved.selection, store.run, store.settings, store.inventory, data) ? saved : undefined;
  if (!restored) delete store.recommendation;
  const value = planRun(store.run, store.settings, store.inventory, data,
    restored ? { selection: restored.selection, summary: restored.summary, search: false } : { previous, search: false });
  previous = value.deckResult.deck.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: e.borrowed }));
  cache = { searchKey: key, displayKey: shown, value };
  if (sameSearch) return value;
  searchState.error = '';
  searchState.pending = !restored && !!value.trainee && !value.issues.length && store.run.goal.blueStats.length > 0;
  if (searchState.pending) timer = setTimeout(() => {
    const fail = () => {
      if (id !== requestId || cache?.searchKey !== key) return;
      searchState.pending = false;
      searchState.error = 'Deck search could not finish.';
      worker?.terminate(); worker = null;
      renderer();
    };
    try {
      worker = new Worker(new URL('./plan-worker.ts', import.meta.url), { type: 'module' });
      worker.onerror = fail;
      worker.onmessage = (event: MessageEvent<PlanWorkerResponse>) => {
        const publish = () => {
          if (id !== requestId || event.data.id !== id || cache?.searchKey !== key) return;
          if (event.data.error) { fail(); return; }
          // Publish once, after both search stages, so intermediate results do not move the editor.
          if (!event.data.complete || !event.data.selection) return;
          cache.value = planRun(store.run, store.settings, store.inventory, data,
            { selection: event.data.selection, summary: event.data.summary, search: false });
          cache.displayKey = displayKey();
          previous = event.data.selection;
          searchState.pending = false;
          worker?.terminate(); worker = null;
          if (event.data.summary && isLegalRunSelection(event.data.selection, store.run, store.settings, store.inventory, data)) {
            saveRecommendation(store, { build: BUILD_VERSION, key, selection: event.data.selection, summary: event.data.summary });
          }
          renderer();
        };
        publish();
      };
      worker.postMessage({ id, run: store.run, settings: store.settings, inventory: store.inventory } satisfies PlanWorkerRequest);
    } catch { fail(); }
  }, 400);
  return value;
}
