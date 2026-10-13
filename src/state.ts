// The app's persisted state: one object under one localStorage key, with one migration path from every shape
// this tool has ever saved. Nothing else reads or writes localStorage.
import { parseRecommendation, type SavedRecommendation } from './recommendation.ts';
import { APTITUDE_KEYS, APT_GRADES, RARITIES, gameIdKey, gameIds, isCalendarId, isGameId, isPlainObject, perStat, type Data, type Grade, type Inventory, type StatValues } from './types.ts';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from './settings.ts';
import type { RunInput } from './model/run.ts';
import { DEFAULT_GOAL, emptyPinkLineage, savedTargetId, sanitizeGoal, sanitizeTargets, sanitizePinkLineage } from './model/goal-input.ts';
import type { SharedChoices } from './share.ts';
import { lineageFromSides, lineageFromTotals, sanitizeLineage, type Lineage } from './model/sparks.ts';
import { isLimitBreak, LINEAGE_SLOTS, MAX_PARENT_STARS, STARS_PER_SPARK_MAX } from './model/rules.ts';
import { defaultParentSparks, gainOfSparks, parentSparksFromGains, sanitizeParentSparks, sparksFromStars, type ParentSparks } from './model/inherit.ts';
import { clampStars } from './model/trainee.ts';
import { defaultMissionState, type MissionState } from './model/missions.ts';

export type Theme = 'system' | 'light' | 'dark';
export interface UiState { sortKey: string; theme: Theme; showUnowned: boolean; /** The input column is hidden so the results take the full width. */ inputsHidden: boolean }
export interface AppState { version: number; run: RunInput; settings: Settings; inventory: Inventory; ui: UiState; missions: MissionState; recommendation?: SavedRecommendation }

export const STATE_VERSION = 25;
export const STATE_KEY = 'uma-parent-deck.v4'; // the key name stays; the version field inside tells the shapes apart
/** A save that could not be read is copied here before the first edit replaces it, until the user removes the copy. */
export const UNREADABLE_KEY = `${STATE_KEY}.unreadable`;
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
  const lines = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((line): line is string => typeof line === 'string' && !!line.trim()))] : [];
  state.eventIds = Array.isArray(raw.eventIds) ? gameIds(raw.eventIds) : null;
  state.customRaceIds = gameIds(raw.customRaceIds);
  state.completedCustomRaceIds = gameIds(raw.completedCustomRaceIds);
  state.completedMissionIds = lines(raw.completedMissionIds);
  state.pastedLines = lines(raw.pastedLines);
  state.traineeCardId = isGameId(raw.traineeCardId) ? raw.traineeCardId : null;
  return state;
}

type Json = Record<string, unknown>;
/** Whether a parsed value has the single-object shape the state key has always held (version 4 onward). */
const isSave = (v: unknown): v is Json & { version: number } => isPlainObject(v) && Number.isSafeInteger(v.version) && (v.version as number) >= 4;
/** Stat arrays are positional. A malformed entry becomes zero without moving the entries after it. */
const savedStats = (raw: unknown): StatValues => perStat((_, i) => {
  const v: unknown = Array.isArray(raw) ? raw[i] : undefined;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
});

/** Older shapes of the run state and what they turn into. */
function migrateRun(raw: Json, data: Data, preserveIds = false): RunInput {
  const run: RunInput = { ...structuredClone(DEFAULT_RUN), pinnedIds: defaultPins(data) };
  // IDs follow the rule share codes use, so every saved choice can be shared; unknown but valid IDs are kept.
  for (const k of ['wishlistOrder', 'wishlistExcluded'] as const) if (k in raw) run[k] = gameIds(raw[k]);
  if (isGameId(raw.traineeCardId)) run.traineeCardId = raw.traineeCardId;
  if (typeof raw.traineeStars === 'number') run.traineeStars = raw.traineeStars;
  // Legacy saves clamp to the trainee's rarity. Current saves keep the entered count; planRun applies today's rarity.
  run.traineeStars = clampStars(!preserveIds && run.traineeCardId != null ? data.charByCardId.get(run.traineeCardId) ?? null : null, run.traineeStars);
  if (typeof raw.borrowFromAll === 'boolean') run.borrowFromAll = raw.borrowFromAll;
  // aptitude overrides: S cannot show on the pre-run screen (only an inspiration event reaches it) and wins like A, so it becomes A
  if (isPlainObject(raw.aptOverrides)) for (const k of APTITUDE_KEYS) {
    const v = raw.aptOverrides[k];
    if (typeof v === 'string' && APT_GRADES.includes(v as Grade)) run.aptOverrides[k] = v === 'S' ? 'A' : v as Grade;
  }
  if (isPlainObject(raw.raceOverrides)) {
    run.raceOverrides = Object.fromEntries(Object.entries(raw.raceOverrides).filter(([k, v]) => isCalendarId(k) && typeof v === 'boolean')) as Record<string, boolean>;
  }
  // pins: a single pinnedId (v1) became pinnedIds (v2)
  if (Array.isArray(raw.pinnedIds)) run.pinnedIds = gameIds(raw.pinnedIds);
  else if (isGameId(raw.pinnedId)) run.pinnedIds = [raw.pinnedId];
  // ignored cards: a card is pinned or ignored, never both; the pin wins
  if (Array.isArray(raw.ignoredIds)) run.ignoredIds = gameIds(raw.ignoredIds).filter((id) => !run.pinnedIds.includes(id));
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
  const starsToGains = (stars: StatValues): StatValues => perStat((_, i) => gainOfSparks(sparksFromStars(stars[i])));
  const sideFromGains = (gains: StatValues): ParentSparks => parentSparksFromGains(gains) ?? defaultParentSparks();
  let gains: StatValues[] | null = null;
  if (Array.isArray(raw.parentSparks) && raw.parentSparks.length === 2) run.parentSparks = raw.parentSparks.map(sanitizeParentSparks);
  else if (Array.isArray(raw.parentGains) && raw.parentGains.length === 2) gains = raw.parentGains.map(savedStats);
  else if (Array.isArray(raw.parentStars) && raw.parentStars.length === 2) gains = raw.parentStars.map(savedStats).map(starsToGains);
  else if (Array.isArray(raw.blueStars)) {
    let left = MAX_PARENT_STARS;
    const all = savedStats(raw.blueStars);
    const p1 = perStat((_, i) => { const take = Math.min(all[i], left); left -= take; return take; });
    gains = [starsToGains(p1), starsToGains(perStat((_, i) => Math.min(MAX_PARENT_STARS, all[i] - p1[i])))];
  }
  if (gains) run.parentSparks = gains.map(sideFromGains);
  run.goal = sanitizeGoal(raw.goal);
  run.targets = sanitizeTargets(raw.targets, data, raw.goal, preserveIds);
  const lineage = run.targetLineage;
  run.targetLineage = {};
  for (const key of Object.keys(lineage)) {
    const canonical = gameIdKey(key);
    const id = canonical === null ? null : savedTargetId(Number(canonical), data, preserveIds);
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
  if (version < 2 && isPlainObject(saved.defaultLb)) saved.defaultLb = { ...saved.defaultLb, SSR: 4 }; // v2 changed the old SSR default
  return settingsOf(saved);
}
/**
 * Settings from any save. Rarity defaults (`defaultLb`, v24) became inventory overrides (v25). The old defaults were
 * always 4, so a changed level becomes that rarity's override and the rest take today's defaults, which use scanned
 * SR/SSR ownership. The inventory itself stays intact, so disabling an override restores it.
 */
function settingsOf(raw: Json): Settings {
  const { defaultLb, ...saved } = raw;
  if (saved.inventoryOverrides === undefined && isPlainObject(defaultLb) && RARITIES.every((r) => isLimitBreak(defaultLb[r]))) {
    saved.inventoryOverrides = Object.fromEntries(RARITIES.map((r) => [r, defaultLb[r] === 4 ? DEFAULT_SETTINGS.inventoryOverrides[r] : defaultLb[r]]));
  }
  return sanitizeSettings(saved);
}

/**
 * Keep only well-formed inventory entries: card ID -> a limit break or null. Keys take their canonical decimal form; an exact
 * key wins over a zero-padded alias of the same card, and the first alias wins over later ones.
 */
export function sanitizeInventory(raw: unknown): Inventory {
  const out: Inventory = {};
  if (!isPlainObject(raw)) return out;
  for (const [key, v] of Object.entries(raw)) {
    const k = gameIdKey(key);
    if (k === null || (k !== key && (k in raw || k in out))) continue;
    if (v === null) out[k] = null;
    else if (isLimitBreak(v)) out[k] = v;
  }
  return out;
}

/**
 * Build the current state from whatever was saved: the v4 object, or the three legacy blobs (run state, settings,
 * inventory) plus the theme key. Anything malformed falls back to its default.
 */
export function migrate(saved: { current?: unknown; state?: unknown; settings?: unknown; inventory?: unknown; theme?: unknown }, data: Data): AppState {
  const base = defaultState(data);
  if (isSave(saved.current)) {
    const c = saved.current;
    const recommendation = c.version === STATE_VERSION ? parseRecommendation(c.recommendation) : undefined;
    return {
      ...(recommendation ? { recommendation } : {}),
      version: STATE_VERSION,
      run: isPlainObject(c.run) ? migrateRun(c.run, data, c.version >= 21) : base.run,
      settings: isPlainObject(c.settings) ? settingsOf(c.settings) : base.settings,
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
/**
 * Set when the save comes from a newer version of the app, such as a tab left open across a release. This version reads
 * it as well as it can, but saving would drop the choices only the newer version understands, so nothing is written
 * until the user chooses to replace it.
 */
export let newerSave = false;
export function replaceNewerSave(state: AppState) {
  newerSave = false;
  return saveState(state);
}
const readStored = (key: string): string | null => {
  try { return localStorage.getItem(key); }
  catch { storageUnavailable = true; return null; }
};
const parseJson = (raw: string | null): unknown => { try { return raw ? JSON.parse(raw) : undefined; } catch { return undefined; } };
const readJson = (key: string): unknown => parseJson(readStored(key));

/**
 * An unreadable save that could not be copied aside because storage is read-only, full or holds an earlier copy.
 * The original is then the only copy, so nothing is written over it until the user replaces it.
 */
export let uncopiedUnreadable: string | null = null;
/** Keep the only copy of an unreadable save; an earlier copy the user has not removed yet is never replaced. */
function keepUnreadable(raw: string) {
  try {
    const copy = localStorage.getItem(UNREADABLE_KEY);
    if (copy === null) localStorage.setItem(UNREADABLE_KEY, raw);
    uncopiedUnreadable = copy === null || copy === raw ? null : raw;
  }
  catch { uncopiedUnreadable = raw; }
}
/** The save that could not be read, for the notice that offers it as a download. */
export const unreadableSave = (): string | null => uncopiedUnreadable ?? readStored(UNREADABLE_KEY);
export function removeUnreadableSave() {
  try { localStorage.removeItem(UNREADABLE_KEY); } catch { /* nothing to remove when storage is unavailable */ }
}
/** Replace the unreadable original without discarding an earlier retained copy. A failed write keeps it protected. */
export function replaceUnreadableSave(state: AppState) {
  const raw = uncopiedUnreadable;
  uncopiedUnreadable = null;
  if (saveState(state)) return true;
  uncopiedUnreadable = raw;
  return false;
}

/** The save as this page last read or wrote it. A write from another tab since then makes the stored text differ. */
let lastRaw: string | null = null;

/**
 * Load from localStorage, migrating older keys on the way. `fallbackInventory` is the repo's inventory.json, the
 * starting inventory of a fresh browser; a browser whose save could not be read is not fresh and does not get it.
 */
export function loadState(data: Data, fallbackInventory: Inventory): AppState {
  const raw = lastRaw = readStored(STATE_KEY);
  const current = parseJson(raw);
  uncopiedUnreadable = null;
  if (raw !== null && !isSave(current)) keepUnreadable(raw);
  newerSave = isSave(current) && current.version > STATE_VERSION;
  const state = migrate({ current, state: readJson(LEGACY_KEYS.state), settings: readJson(LEGACY_KEYS.settings), inventory: readJson(LEGACY_KEYS.inventory), theme: readStored(LEGACY_KEYS.theme) }, data);
  if (raw === null && readJson(LEGACY_KEYS.inventory) === undefined) state.inventory = sanitizeInventory(fallbackInventory);
  // Retire historical family aliases once, before another data update can reinterpret the old save.
  // If storage is read-only or full, the migrated in-memory state still remains usable.
  if (isSave(current) && current.version < STATE_VERSION) {
    saveState(state);
  }
  return state;
}
export function saveState(state: AppState) {
  if (newerSave || uncopiedUnreadable !== null) return false;
  const serialized = JSON.stringify(state);
  try {
    localStorage.setItem(STATE_KEY, serialized);
    lastRaw = serialized;
    storageUnavailable = false;
    return true;
  } catch {
    storageUnavailable = true;
    return false;
  }
}

/**
 * The save another tab wrote since this page last read or wrote one, or null. Its storage event can arrive late, or
 * never reach a page restored from the back-forward cache, so an edit checks here before writing the whole state.
 * A save from a newer version sets `newerSave` instead of being taken over. An unreadable save is protected the
 * same way as on startup, and the choices already on this page stay in place.
 */
export function storedIfChanged(data: Data): AppState | null {
  const raw = readStored(STATE_KEY);
  if (raw === null || raw === lastRaw) return null;
  const current = parseJson(raw);
  lastRaw = raw;
  // Another tab wrote over an unreadable save it could not copy aside, so there is nothing left in place to protect.
  uncopiedUnreadable = null;
  newerSave = false;
  if (!isSave(current)) { keepUnreadable(raw); return null; }
  if (current.version > STATE_VERSION) { newerSave = true; return null; }
  return migrate({ current }, data);
}

/**
 * Keep open planner and mission tabs from overwriting each other's newer choices. `accept` takes over another tab's
 * save; `notice` refreshes warnings for a save this version cannot read.
 */
export function watchSavedState(data: Data, accept: (state: AppState) => void, notice: () => void) {
  const check = () => {
    const previousRaw = lastRaw;
    const saved = storedIfChanged(data);
    if (saved) accept(saved);
    else if (lastRaw !== previousRaw) notice();
  };
  window.addEventListener('storage', (event) => { if (event.key === STATE_KEY) check(); });
  window.addEventListener('pageshow', (event) => { if (event.persisted) check(); });
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
  // The cache is optional: it never writes the whole state over a save from another tab that this page has not taken over.
  if (readStored(STATE_KEY) !== lastRaw) return;
  if (!saveState(state)) {
    delete state.recommendation;
    // A large optional cache must not prevent saving the user's smaller choices.
    saveState(state);
  }
}
