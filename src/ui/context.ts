// The app's shared context: the loaded data, the persisted store, transient view state, and the memoized run plan.
// Panels mutate the store through update(), which persists and re-renders; view-only changes go through refresh().
import { guard } from 'lit-html/directives/guard.js';
import type { TemplateResult } from 'lit-html';
import { BUILD_VERSION } from 'virtual:build-version';
import { planningKey } from '../recommendation.ts';
import { loadData } from '../data.ts';
import { loadState, saveState, saveRecommendation, storedIfChanged, watchSavedState, type AppState } from '../state.ts';
import { planRun, isLegalRunSelection, type RunPlan, type DeckSelection } from '../model/run.ts';
import type { PlanWorkerRequest, PlanWorkerResponse } from './plan-worker.ts';
import defaultInventory from '../../inventory.json' with { type: 'json' };

export const data = loadData();
export const store: AppState = loadState(data, defaultInventory);
let inputKey = planningKey(store.run, store.settings, store.inventory);
export let stateRevision = 0;

/** The view fields that hold a search box's text. */
export type SearchField = 'requiredQuery' | 'preferredQuery' | 'traineeQuery' | 'cardQuery' | 'ignoreQuery' | 'missionTraineeQuery';
/**
 * State that is not persisted: search boxes, open panels, the highlighted suggestion, drag state, the deck search.
 * Panels memoize by the identity of each field they read, so object and list fields are readonly: replace them.
 */
const viewState = {
  /** Each target group has its own search box. */
  requiredQuery: '',
  preferredQuery: '',
  targetEditorId: null as number | null,
  /** The target groups start open; one holding the selected target is shown open regardless. */
  targetGroupsOpen: { required: true, preferred: true } as Readonly<Record<'required' | 'preferred', boolean>>,
  goalTemplateId: '',
  traineeQuery: '',
  cardQuery: '',
  ignoreQuery: '',
  missionTraineeQuery: '',
  missionPaste: '',
  missionRaceQuery: '',
  missionEventPick: '',
  missionImportNotice: '',
  activeSearch: null as SearchField | null,
  /** Each search keeps its own keyboard highlight; -1 is none. */
  suggestIndexes: { requiredQuery: -1, preferredQuery: -1, traineeQuery: -1, cardQuery: -1, ignoreQuery: -1, missionTraineeQuery: -1 } as Readonly<Record<SearchField, number>>,
  showAdvanced: false,
  showSparks: false,
  showPinkSparks: false,
  showAgenda: false,
  showDetails: false,
  expandedRankingCards: [] as readonly number[],
  /** Advanced settings whose last typed value was rejected, with the accepted range. */
  settingErrors: {} as Readonly<Record<string, Readonly<{ value: string; message: string }>>>,
  /** The prioritized-skill row being dragged and the row under the pointer. */
  drag: { key: null, over: null } as Readonly<{ key: number | null; over: number | null }>,
  /** The skill candidates below the prioritized list are clamped to three lines unless expanded. */
  showAllCandidates: false,
  /** Observed after layout by app.ts: whether the clamped candidates hide any. */
  candidatesOverflow: false,
  /** The white lineage editor takes each parent and grandparent instead of totals. */
  showLineageParents: false,
  /** The screenshot scanner is shown over the page; its module loads on first use. */
  scannerOpen: false,
  scannerLoading: false,
  /** A deck search is running; the deck shown keeps its checked estimates meanwhile. */
  searchPending: false,
  /** The last deck search failed; the warnings panel offers a retry. */
  searchFailed: false,
};
export type View = typeof viewState;

// Each panel is rendered inside trackedPanel(), which records the view fields it reads and their values, so the
// panel re-renders only when the plan, the persisted state or one of those fields changed. Adding a view field never
// needs a dependency list updated by hand.
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
/** Take over a save another tab wrote. The caller re-renders. */
function adopt(saved: AppState) {
  delete store.recommendation;
  Object.assign(store, saved);
  stateRevision++;
  inputKey = planningKey(store.run, store.settings, store.inventory);
}
/** Take over the latest save before writing the whole state, so another tab's change is not lost. */
function adoptLatest() {
  const latest = storedIfChanged(data);
  if (latest) adopt(latest);
}
watchSavedState(data, (saved) => {
  adopt(saved);
  updated();
  renderer();
}, () => renderer());
/** Re-render after a view-only change. */
export function refresh() { renderer(); }
/** Apply a change to the persisted state, save it and re-render. Returns whether the save was written. */
export function update(fn: (s: AppState) => void): boolean {
  adoptLatest();
  fn(store);
  stateRevision++;
  const nextKey = planningKey(store.run, store.settings, store.inventory);
  if (nextKey !== inputKey) delete store.recommendation;
  inputKey = nextKey;
  const saved = saveState(store);
  updated();
  renderer();
  return saved;
}

/** The search key plus the user's arrangement of the extras, which changes the plan shown but not the search. */
const displayKey = () => `${inputKey}${JSON.stringify([store.run.wishlistOrder, store.run.wishlistExcluded])}`;
let cache: { searchKey: string; displayKey: string; value: RunPlan } | null = null;
let worker: Worker | null = null, requestId = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let previous: DeckSelection | undefined;
export function retrySearch() {
  adoptLatest();
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
  view.searchFailed = false;
  view.searchPending = !restored && !!value.trainee && !value.issues.length && store.run.goal.blueStats.length > 0;
  if (view.searchPending) timer = setTimeout(() => {
    const current = () => id === requestId && cache?.searchKey === key;
    // Every way a search can fail settles it here, so the deck never stays pending; the deck shown keeps its estimates.
    const fail = (detail: string) => {
      if (!current()) return;
      console.warn('Deck search failed:', detail);
      view.searchPending = false;
      view.searchFailed = true;
      worker?.terminate(); worker = null;
      renderer();
    };
    try {
      worker = new Worker(new URL('./plan-worker.ts', import.meta.url), { type: 'module' });
      worker.onerror = (event) => fail(event.message ?? 'worker error');
      worker.onmessageerror = () => fail('unreadable worker message');
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (!current()) return;
        // Each search has its own worker, so a reply without this request's id is malformed rather than obsolete.
        const response = event.data as Partial<PlanWorkerResponse> | null;
        if (response?.id !== id || response.kind !== 'result' || !Array.isArray(response.selection)) {
          fail(response?.id === id && response.kind === 'error' ? response.message ?? 'worker error' : 'malformed worker response');
          return;
        }
        try {
          cache!.value = planRun(store.run, store.settings, store.inventory, data,
            { selection: response.selection, summary: response.summary, search: false });
          cache!.displayKey = displayKey();
          previous = response.selection;
          view.searchPending = false;
          worker?.terminate(); worker = null;
          if (response.summary && isLegalRunSelection(response.selection, store.run, store.settings, store.inventory, data)) {
            saveRecommendation(store, { build: BUILD_VERSION, key, selection: response.selection, summary: response.summary });
          }
          renderer();
        } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
      };
      worker.postMessage({ id, run: store.run, settings: store.settings, inventory: store.inventory } satisfies PlanWorkerRequest);
    } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
  }, 400);
  return value;
}
