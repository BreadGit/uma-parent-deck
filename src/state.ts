// The app's persisted state: one object under one localStorage key, with one migration path from every shape
// this tool has ever saved. Nothing else reads or writes localStorage.
import { STATS, type AptKey, type Data, type Grade, type Inventory } from './types.ts';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from './settings.ts';
import type { RunInput } from './model/run.ts';
import { DEFAULT_GOAL, emptyPinkLineage, goalFamily, sanitizeGoal, sanitizePinkLineage } from './model/goal-input.ts';
import type { Lineage } from './model/sparks.ts';
import { LINEAGE_MAX_PER_SIDE, MAX_PARENT_STARS, STARS_PER_SPARK_MAX } from './model/rules.ts';
import { defaultParentSparks, gainOfSparks, parentSparksFromGains, sanitizeParentSparks, sparksFromStars, type ParentSparks } from './model/inherit.ts';
import { clampStars } from './model/trainee.ts';

export type Theme = 'system' | 'light' | 'dark';
export interface UiState { sortKey: string; theme: Theme }
export interface AppState { version: number; run: RunInput; settings: Settings; inventory: Inventory; ui: UiState }

export const STATE_VERSION = 11;
export const STATE_KEY = 'uma-parent-deck.v4'; // the key name stays; the version field inside tells the shapes apart
/** Keys used before the single-object store; read once by migrate(), never written again. */
const LEGACY_KEYS = { state: 'uma-parent-deck.state', settings: 'uma-parent-deck.settings', inventory: 'uma-parent-deck.inventory', theme: 'uma-parent-deck.theme' };

export const DEFAULT_RUN: RunInput = {
  goal: structuredClone(DEFAULT_GOAL), pinkLineage: emptyPinkLineage(),
  targets: [], targetLineage: {}, wishlistOrder: [], wishlistExcluded: [], traineeCardId: null, traineeStars: 3,
  aptOverrides: {}, raceOverrides: {}, pinnedIds: [], borrowFromAll: false, parentSparks: [defaultParentSparks(), defaultParentSparks()],
};
export const DEFAULT_UI: UiState = { sortKey: 'score', theme: 'system' };

/** Light Hello is mandatory in Our Grand Concert, so she starts pinned (SSR if present, else R). */
export function defaultPins(data: Data): number[] {
  const lh = data.cards.filter((c) => c.charName === 'Light Hello').map((c) => c.id).sort((a, b) => b - a)[0];
  return lh ? [lh] : [];
}
export function defaultState(data: Data): AppState {
  return { version: STATE_VERSION, run: { ...structuredClone(DEFAULT_RUN), pinnedIds: defaultPins(data) }, settings: structuredClone(DEFAULT_SETTINGS), inventory: {}, ui: { ...DEFAULT_UI } };
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const numList = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);
const APT_KEYS: AptKey[] = ['turf', 'dirt', 'sprint', 'mile', 'medium', 'long', 'front', 'pace', 'late', 'end'];
const APT_GRADES: Grade[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
/** Stat arrays are positional. A malformed entry becomes zero without moving the entries after it. */
const statValues = (raw: unknown): number[] => STATS.map((_, i) => {
  const v: unknown = Array.isArray(raw) ? raw[i] : undefined;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
});

/** Older shapes of the run state and what they turn into. */
function migrateRun(raw: Json, data: Data): RunInput {
  const run: RunInput = { ...structuredClone(DEFAULT_RUN), pinnedIds: defaultPins(data) };
  for (const k of ['targets', 'wishlistOrder', 'wishlistExcluded'] as const) if (k in raw) run[k] = numList(raw[k]);
  if (typeof raw.traineeCardId === 'number') run.traineeCardId = raw.traineeCardId;
  if (typeof raw.traineeStars === 'number') run.traineeStars = raw.traineeStars;
  // the star count belongs to the trainee: at least her rarity, at most five
  run.traineeStars = clampStars(run.traineeCardId != null ? data.charByCardId.get(run.traineeCardId) ?? null : null, run.traineeStars);
  if (typeof raw.borrowFromAll === 'boolean') run.borrowFromAll = raw.borrowFromAll;
  // aptitude overrides: S cannot show on the pre-run screen (only an inspiration event reaches it) and wins like A, so it becomes A
  if (isObj(raw.aptOverrides)) for (const k of APT_KEYS) {
    const v = raw.aptOverrides[k];
    if (typeof v === 'string' && APT_GRADES.includes(v as Grade)) run.aptOverrides[k] = v === 'S' ? 'A' : v as Grade;
  }
  if (isObj(raw.raceOverrides)) run.raceOverrides = Object.fromEntries(Object.entries(raw.raceOverrides).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>;
  // pins: a single pinnedId (v1) became pinnedIds (v2)
  if (Array.isArray(raw.pinnedIds)) run.pinnedIds = numList(raw.pinnedIds);
  else if (typeof raw.pinnedId === 'number') run.pinnedIds = [raw.pinnedId];
  // lineage: {n, stars} (v1) became per-side counts and star totals {k1, k2, p1, p2} (v2)
  run.targetLineage = {};
  if (isObj(raw.targetLineage)) for (const [k, v] of Object.entries(raw.targetLineage)) {
    if (!isObj(v)) continue;
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
  run.goal = sanitizeGoal(raw.goal, data, run.targets);
  // All white targets share one editor. Preserve old goal-only families in the merged target list.
  const ids = new Set([...run.goal.required.map((r) => r.id), ...run.goal.preferred]);
  run.targets = [...new Set([...run.targets.map((id) => goalFamily(id, data)).filter((id): id is number => id !== null && ids.has(id)), ...ids])];
  run.pinkLineage = sanitizePinkLineage(raw.pinkLineage);
  return run;
}
function migrateLineage(v: Json): Lineage | null {
  if (typeof v.k1 === 'number' && typeof v.k2 === 'number') return { k1: v.k1, k2: v.k2, p1: typeof v.p1 === 'number' ? v.p1 : 0, p2: typeof v.p2 === 'number' ? v.p2 : 0 };
  const n = typeof v.n === 'number' ? v.n : 0;
  if (n <= 0) return null;
  const stars = typeof v.stars === 'number' ? v.stars : STARS_PER_SPARK_MAX;
  const k1 = Math.min(LINEAGE_MAX_PER_SIDE, Math.ceil(n / 2)), k2 = Math.min(LINEAGE_MAX_PER_SIDE, n - k1);
  return { k1, k2, p1: Math.min(STARS_PER_SPARK_MAX * k1, typeof v.p1 === 'number' ? v.p1 : stars * k1), p2: Math.min(STARS_PER_SPARK_MAX * k2, typeof v.p2 === 'number' ? v.p2 : stars * k2) };
}

/** Older settings blobs carried their own version number. */
function migrateSettings(raw: Json): Settings {
  const version = typeof raw.version === 'number' ? raw.version : 1;
  const saved: Json = { ...raw };
  delete saved.version;
  const merged = sanitizeSettings(saved as Partial<Record<keyof Settings, unknown>>);
  if (version < 2) merged.defaultLb = { ...merged.defaultLb, SSR: 4 }; // default SSR LB changed from 0 to 4
  if (version < 3) merged.showUnowned = true;                            // now shown by default
  return merged;
}

/** Keep only well-formed inventory entries: numeric card id -> LB 0..4 or null. */
export function sanitizeInventory(raw: unknown): Inventory {
  const out: Inventory = {};
  if (!isObj(raw)) return out;
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
  if (isObj(saved.current) && typeof saved.current.version === 'number' && saved.current.version >= 4) {
    const c = saved.current;
    return {
      version: STATE_VERSION,
      run: isObj(c.run) ? migrateRun(c.run, data) : base.run,
      settings: isObj(c.settings) ? sanitizeSettings(c.settings as Partial<Record<keyof Settings, unknown>>) : base.settings,
      inventory: sanitizeInventory(c.inventory),
      ui: { sortKey: isObj(c.ui) && typeof c.ui.sortKey === 'string' ? c.ui.sortKey : DEFAULT_UI.sortKey, theme: isObj(c.ui) && isTheme(c.ui.theme) ? c.ui.theme : DEFAULT_UI.theme },
    };
  }
  return {
    version: STATE_VERSION,
    run: isObj(saved.state) ? migrateRun(saved.state, data) : base.run,
    settings: isObj(saved.settings) ? migrateSettings(saved.settings) : base.settings,
    inventory: sanitizeInventory(saved.inventory),
    ui: { sortKey: isObj(saved.state) && typeof saved.state.sortKey === 'string' ? saved.state.sortKey : DEFAULT_UI.sortKey, theme: isTheme(saved.theme) ? saved.theme : DEFAULT_UI.theme },
  };
}
const isTheme = (v: unknown): v is Theme => v === 'system' || v === 'light' || v === 'dark';

const readJson = (key: string): unknown => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : undefined; } catch { return undefined; } };

/** Load from localStorage, migrating older keys on the way. `fallbackInventory` is the repo's inventory.json. */
export function loadState(data: Data, fallbackInventory: Inventory): AppState {
  const state = migrate({ current: readJson(STATE_KEY), state: readJson(LEGACY_KEYS.state), settings: readJson(LEGACY_KEYS.settings), inventory: readJson(LEGACY_KEYS.inventory), theme: localStorage.getItem(LEGACY_KEYS.theme) }, data);
  if (readJson(STATE_KEY) === undefined && readJson(LEGACY_KEYS.inventory) === undefined) state.inventory = sanitizeInventory(fallbackInventory);
  return state;
}
export function saveState(state: AppState) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}
/** Forget the run choices only; settings and inventory stay. */
export function resetRun(state: AppState, data: Data): AppState {
  return { ...state, run: { ...structuredClone(DEFAULT_RUN), pinnedIds: defaultPins(data) } };
}
