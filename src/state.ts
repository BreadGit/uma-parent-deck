// The app's persisted state: one object under one localStorage key, with one migration path from every shape
// this tool has ever saved. Nothing else reads or writes localStorage.
import { parseRecommendation, type SavedRecommendation } from './recommendation.ts';
import { STATS, APTITUDE_KEYS, APT_GRADES, isPlainObject, type Data, type Grade, type Inventory } from './types.ts';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from './settings.ts';
import type { RunInput } from './model/run.ts';
import { DEFAULT_GOAL, emptyPinkLineage, savedTargetId, sanitizeGoal, sanitizeTargets, sanitizePinkLineage } from './model/goal-input.ts';
import type { SharedChoices } from './share.ts';
import { lineageFromSides, lineageFromTotals, sanitizeLineage, type Lineage } from './model/sparks.ts';
import { LINEAGE_SLOTS, MAX_PARENT_STARS, STARS_PER_SPARK_MAX } from './model/rules.ts';
import { defaultParentSparks, gainOfSparks, parentSparksFromGains, sanitizeParentSparks, sparksFromStars, type ParentSparks } from './model/inherit.ts';
import { clampStars } from './model/trainee.ts';
import { defaultMissionState, type MissionState } from './model/missions.ts';

export type Theme = 'system' | 'light' | 'dark';
export interface UiState { sortKey: string; theme: Theme; showUnowned: boolean; /** The input column is hidden so the results take the full width. */ inputsHidden: boolean }
export interface AppState { version: number; run: RunInput; settings: Settings; inventory: Inventory; ui: UiState; missions: MissionState; recommendation?: SavedRecommendation }

export const STATE_VERSION = 24;
export const STATE_KEY = 'uma-parent-deck.v4'; // the key name stays; the version field inside tells the shapes apart
/** Keys used before the single-object store; read once by migrate(), never written again. */
const LEGACY_KEYS = { state: 'uma-parent-deck.state', settings: 'uma-parent-deck.settings', inventory: 'uma-parent-deck.inventory', theme: 'uma-parent-deck.theme' };

export const DEFAULT_RUN: RunInput = {
  goal: structuredClone(DEFAULT_GOAL), pinkLineage: emptyPinkLineage(),
  targets: [], targetLineage: {}, wishlistOrder: [], wishlistExcluded: [], traineeCardId: null, traineeStars: 3,
  aptOverrides: {}, raceOverrides: {}, pinnedIds: [], borrowFromAll: false, ignoredIds: [], borrowIgnored: false, parentSparks: [defaultParentSparks(), defaultParentSparks()],
};
export const DEFAULT_UI: UiState = { sortKey: 'score', theme: 'system', showUnowned: true, inputsHidden: false };

/** Light Hello is mandatory in Our Grand Concert, so she starts pinned (SSR if present, else R). */
export function defaultPins(data: Data): number[] {
  const lh = data.cards.filter((c) => c.charName === 'Light Hello').map((c) => c.id).sort((a, b) => b - a)[0];
  return lh ? [lh] : [];
}
export function defaultState(data: Data): AppState {
  return { version: STATE_VERSION, run: { ...structuredClone(DEFAULT_RUN), pinnedIds: defaultPins(data) }, settings: structuredClone(DEFAULT_SETTINGS), inventory: {}, ui: { ...DEFAULT_UI }, missions: defaultMissionState() };
}

function migrateMissions(raw: unknown): MissionState {
  const state = defaultMissionState();
  if (!isPlainObject(raw)) return state;
  const ids = (value: unknown) => [...new Set(numList(value).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const lines = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((line): line is string => typeof line === 'string' && !!line.trim()))] : [];
  state.eventIds = Array.isArray(raw.eventIds) ? ids(raw.eventIds) : null;
  state.customRaceIds = ids(raw.customRaceIds);
  state.completedCustomRaceIds = ids(raw.completedCustomRaceIds);
  state.completedMissionIds = lines(raw.completedMissionIds);
  state.pastedLines = lines(raw.pastedLines);
  state.traineeCardId = typeof raw.traineeCardId === 'number' && Number.isSafeInteger(raw.traineeCardId) && raw.traineeCardId > 0 ? raw.traineeCardId : null;
  return state;
}

type Json = Record<string, unknown>;
const numList = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);
/** Stat arrays are positional. A malformed entry becomes zero without moving the entries after it. */
const statValues = (raw: unknown): number[] => STATS.map((_, i) => {
  const v: unknown = Array.isArray(raw) ? raw[i] : undefined;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
});

/** Older shapes of the run state and what they turn into. */
function migrateRun(raw: Json, data: Data, preserveIds = false): RunInput {
  const run: RunInput = { ...structuredClone(DEFAULT_RUN), pinnedIds: defaultPins(data) };
  for (const k of ['wishlistOrder', 'wishlistExcluded'] as const) if (k in raw) run[k] = numList(raw[k]);
  if (typeof raw.traineeCardId === 'number') run.traineeCardId = raw.traineeCardId;
  if (typeof raw.traineeStars === 'number') run.traineeStars = raw.traineeStars;
  // Legacy saves clamp to the trainee's rarity. Current saves keep the entered count; planRun applies today's rarity.
  run.traineeStars = clampStars(!preserveIds && run.traineeCardId != null ? data.charByCardId.get(run.traineeCardId) ?? null : null, run.traineeStars);
  if (typeof raw.borrowFromAll === 'boolean') run.borrowFromAll = raw.borrowFromAll;
  // aptitude overrides: S cannot show on the pre-run screen (only an inspiration event reaches it) and wins like A, so it becomes A
  if (isPlainObject(raw.aptOverrides)) for (const k of APTITUDE_KEYS) {
    const v = raw.aptOverrides[k];
    if (typeof v === 'string' && APT_GRADES.includes(v as Grade)) run.aptOverrides[k] = v === 'S' ? 'A' : v as Grade;
  }
  if (isPlainObject(raw.raceOverrides)) run.raceOverrides = Object.fromEntries(Object.entries(raw.raceOverrides).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>;
  // pins: a single pinnedId (v1) became pinnedIds (v2)
  if (Array.isArray(raw.pinnedIds)) run.pinnedIds = numList(raw.pinnedIds);
  else if (typeof raw.pinnedId === 'number') run.pinnedIds = [raw.pinnedId];
  // ignored cards: a card is pinned or ignored, never both; the pin wins
  if (Array.isArray(raw.ignoredIds)) run.ignoredIds = numList(raw.ignoredIds).filter((id) => !run.pinnedIds.includes(id));
  if (typeof raw.borrowIgnored === 'boolean') run.borrowIgnored = raw.borrowIgnored;
  // lineage: {n, stars} (v1) became per-side counts and star totals {k1, k2, p1, p2} (v2), then the stars on each
  // of the six umas (v23). Older totals place their copies the way the form does.
  run.targetLineage = {};
  if (isPlainObject(raw.targetLineage)) for (const [k, v] of Object.entries(raw.targetLineage)) {
    const l = migrateLineage(v);
    if (l) run.targetLineage[k] = l;
  }
  // blue sparks: one combined blueStars list (v1) became stars per parent (v2), then the start gain per parent as
  // the legacy screen shows it (v5), then the spark each of the side's three umas carries (v6). Gains decode into
  // sparks; a side the screen could not show becomes empty. Partial and empty sides are kept.
  const starsToGains = (p: number[]) => p.map((stars) => gainOfSparks(sparksFromStars(stars)));
  const sideFromGains = (gains: number[]): ParentSparks => parentSparksFromGains(gains) ?? defaultParentSparks();
  let gains: number[][] | null = null;
  if (Array.isArray(raw.parentSparks) && raw.parentSparks.length === 2) run.parentSparks = raw.parentSparks.map(sanitizeParentSparks);
  else if (Array.isArray(raw.parentGains) && raw.parentGains.length === 2) gains = raw.parentGains.map(statValues);
  else if (Array.isArray(raw.parentStars) && raw.parentStars.length === 2) gains = raw.parentStars.map(statValues).map(starsToGains);
  else if (Array.isArray(raw.blueStars)) {
    let left = MAX_PARENT_STARS;
    const all = statValues(raw.blueStars);
    const p1 = all.map((v) => { const take = Math.min(v, left); left -= take; return take; });
    gains = [starsToGains(p1), starsToGains(all.map((v, i) => Math.min(MAX_PARENT_STARS, v - p1[i]!)))];
  }
  if (gains) run.parentSparks = gains.map(sideFromGains);
  run.goal = sanitizeGoal(raw.goal);
  run.targets = sanitizeTargets(raw.targets, data, raw.goal, preserveIds);
  const lineage = run.targetLineage;
  run.targetLineage = {};
  for (const key of Object.keys(lineage)) {
    const id = savedTargetId(Number(key), data, preserveIds);
    if (id === null) continue;
    // Inactive targets retain their lineage. Prefer exact white keys over old gold/circle aliases.
    run.targetLineage[String(id)] ??= lineage[String(id)] ?? lineage[key]!;
  }
  run.pinkLineage = sanitizePinkLineage(raw.pinkLineage);
  return run;
}
function migrateLineage(v: unknown): Lineage | null {
  if (Array.isArray(v)) return sanitizeLineage(v);
  if (!isPlainObject(v)) return null;
  if (typeof v.k1 === 'number' && typeof v.k2 === 'number') return lineageFromSides(v.k1, typeof v.p1 === 'number' ? v.p1 : 0, v.k2, typeof v.p2 === 'number' ? v.p2 : 0);
  const n = typeof v.n === 'number' ? Math.min(LINEAGE_SLOTS, v.n) : 0;
  if (n <= 0) return null;
  return lineageFromTotals(n, n * (typeof v.stars === 'number' ? v.stars : STARS_PER_SPARK_MAX));
}

/** Older settings blobs carried their own version number. */
function migrateSettings(raw: Json): Settings {
  const version = typeof raw.version === 'number' ? raw.version : 1;
  const saved: Json = { ...raw };
  delete saved.version;
  const merged = sanitizeSettings(saved as Partial<Record<keyof Settings, unknown>>);
  if (version < 2) merged.defaultLb = { ...merged.defaultLb, SSR: 4 }; // default SSR LB changed from 0 to 4
  return merged;
}

/** Keep only well-formed inventory entries: numeric card id -> LB 0..4 or null. */
export function sanitizeInventory(raw: unknown): Inventory {
  const out: Inventory = {};
  if (!isPlainObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!/^\d+$/.test(k)) continue;
    if (v === null) out[k] = null;
    else if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4) out[k] = v;
  }
  return out;
}

/**
 * Build the current state from whatever was saved: the v4 object, or the three legacy blobs (run state, settings,
 * inventory) plus the theme key. Anything malformed falls back to its default.
 */
export function migrate(saved: { current?: unknown; state?: unknown; settings?: unknown; inventory?: unknown; theme?: unknown }, data: Data): AppState {
  const base = defaultState(data);
  if (isPlainObject(saved.current) && typeof saved.current.version === 'number' && saved.current.version >= 4) {
    const c = saved.current;
    const recommendation = c.version === STATE_VERSION ? parseRecommendation(c.recommendation) : undefined;
    return {
      ...(recommendation ? { recommendation } : {}),
      version: STATE_VERSION,
      run: isPlainObject(c.run) ? migrateRun(c.run, data, typeof c.version === 'number' && c.version >= 21) : base.run,
      settings: isPlainObject(c.settings) ? sanitizeSettings(c.settings as Partial<Record<keyof Settings, unknown>>) : base.settings,
      inventory: sanitizeInventory(c.inventory),
      missions: migrateMissions(c.missions),
      ui: { sortKey: isPlainObject(c.ui) && typeof c.ui.sortKey === 'string' ? c.ui.sortKey : DEFAULT_UI.sortKey, theme: isPlainObject(c.ui) && isTheme(c.ui.theme) ? c.ui.theme : DEFAULT_UI.theme,
        showUnowned: isPlainObject(c.ui) && typeof c.ui.showUnowned === 'boolean' ? c.ui.showUnowned
          : isPlainObject(c.settings) && typeof c.settings.showUnowned === 'boolean' ? c.settings.showUnowned : DEFAULT_UI.showUnowned,
        inputsHidden: isPlainObject(c.ui) && typeof c.ui.inputsHidden === 'boolean' ? c.ui.inputsHidden : DEFAULT_UI.inputsHidden },
    };
  }
  return {
    version: STATE_VERSION,
    run: isPlainObject(saved.state) ? migrateRun(saved.state, data) : base.run,
    settings: isPlainObject(saved.settings) ? migrateSettings(saved.settings) : base.settings,
    inventory: sanitizeInventory(saved.inventory),
    missions: base.missions,
    ui: { sortKey: isPlainObject(saved.state) && typeof saved.state.sortKey === 'string' ? saved.state.sortKey : DEFAULT_UI.sortKey, theme: isTheme(saved.theme) ? saved.theme : DEFAULT_UI.theme,
      showUnowned: isPlainObject(saved.settings) && typeof saved.settings.version === 'number' && saved.settings.version >= 3
        && typeof saved.settings.showUnowned === 'boolean' ? saved.settings.showUnowned : DEFAULT_UI.showUnowned,
      inputsHidden: DEFAULT_UI.inputsHidden },
  };
}
const isTheme = (v: unknown): v is Theme => v === 'system' || v === 'light' || v === 'dark';

export let storageUnavailable = false;
const readStored = (key: string): string | null => {
  try { return localStorage.getItem(key); }
  catch { storageUnavailable = true; return null; }
};
const readJson = (key: string): unknown => { try { const raw = readStored(key); return raw ? JSON.parse(raw) : undefined; } catch { return undefined; } };

/** Load from localStorage, migrating older keys on the way. `fallbackInventory` is the repo's inventory.json. */
export function loadState(data: Data, fallbackInventory: Inventory): AppState {
  const current = readJson(STATE_KEY);
  const state = migrate({ current, state: readJson(LEGACY_KEYS.state), settings: readJson(LEGACY_KEYS.settings), inventory: readJson(LEGACY_KEYS.inventory), theme: readStored(LEGACY_KEYS.theme) }, data);
  if (current === undefined && readJson(LEGACY_KEYS.inventory) === undefined) state.inventory = sanitizeInventory(fallbackInventory);
  // Retire historical family aliases once, before another data update can reinterpret the old save.
  // If storage is read-only or full, the migrated in-memory state still remains usable.
  if (isPlainObject(current) && typeof current.version === 'number' && current.version >= 4 && current.version < STATE_VERSION) {
    saveState(state);
  }
  return state;
}
export function saveState(state: AppState) {
  const serialized = JSON.stringify(state);
  try {
    localStorage.setItem(STATE_KEY, serialized);
    storageUnavailable = false;
    return true;
  } catch {
    storageUnavailable = true;
    return false;
  }
}

/** Keep open planner and mission tabs from overwriting each other's newer choices. */
export function watchSavedState(data: Data, accept: (state: AppState) => void) {
  window.addEventListener('storage', (event) => {
    if (event.key !== STATE_KEY || event.newValue === null) return;
    let current: unknown;
    try { current = JSON.parse(event.newValue); } catch { return; }
    if (isPlainObject(current) && typeof current.version === 'number' && current.version >= 4) accept(migrate({ current }, data));
  });
}

/** Replace only the shared inputs. Imported IDs stay intact even when today's data cannot resolve them. */
export function applySharedChoices(state: AppState, choices: SharedChoices) {
  const incoming = structuredClone(choices);
  state.run = { ...state.run, ...incoming.run };
  state.settings = { ...state.settings, ...incoming.settings };
  delete state.recommendation;
}
/** Start over: a fresh run and the run-level settings (training focus, win threshold) back at their defaults. */
export function resetRun(state: AppState, data: Data): AppState {
  const reset = {
    ...state,
    run: { ...structuredClone(DEFAULT_RUN), pinnedIds: defaultPins(data) },
    settings: { ...state.settings, focus: DEFAULT_SETTINGS.focus, winThreshold: DEFAULT_SETTINGS.winThreshold },
  };
  delete reset.recommendation;
  return reset;
}

/** Optional cached results must not prevent the current recommendation from appearing if storage is full. */
export function saveRecommendation(state: AppState, recommendation: SavedRecommendation) {
  state.recommendation = recommendation;
  if (!saveState(state)) {
    delete state.recommendation;
    // A large optional cache must not prevent saving the user's smaller choices.
    saveState(state);
  }
}
