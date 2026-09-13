// Share formats are independent of saved-state versions and the installed game dataset.
import type { AppState } from './state.ts';
import type { RunInput } from './model/run.ts';
import type { Settings } from './settings.ts';
import type { AptKey, Grade, Stat } from './types.ts';

export interface SharedChoices {
  run: Omit<RunInput, 'raceOverrides'>;
  settings: Pick<Settings, 'focus' | 'winThreshold'>;
}

// These tables and defaults are part of formats 1 and 2. Never reorder or derive them from live data.
const STATS: readonly Stat[] = ['speed', 'stamina', 'power', 'guts', 'wit'];
const APTITUDES: readonly AptKey[] = ['turf', 'dirt', 'sprint', 'mile', 'medium', 'long', 'front', 'pace', 'late', 'end'];
const GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const FOCUSES: readonly Settings['focus'][] = ['balanced', 'stamina', 'sprint'];
const DEFAULTS: SharedChoices = {
  run: {
    traineeCardId: null, traineeStars: 3,
    goal: { blueStats: ['speed', 'stamina', 'power', 'guts', 'wit'], blueStars: 2, pink: [{ aptitude: 'any', stars: 1 }] },
    targets: [], targetLineage: {}, parentSparks: [[null, null, null], [null, null, null]],
    pinkLineage: [null, null, null, null, null, null], aptOverrides: {}, pinnedIds: [], borrowFromAll: false,
    wishlistOrder: [], wishlistExcluded: [],
  },
  settings: { focus: 'stamina', winThreshold: 0.8 },
};
const MAX_CODE_LENGTH = 16000;
const MAX_JSON_BYTES = 100000;

export class ShareCodeError extends Error {
  readonly reason: 'invalid' | 'version' | 'size';
  constructor(reason: ShareCodeError['reason'] = 'invalid') { super(`Share code: ${reason}`); this.reason = reason; }
}
const invalid = (): never => { throw new ShareCodeError(); };
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : invalid();
const tuple = (v: unknown, length: number): unknown[] => { const a = list(v); return a.length === length ? a : invalid(); };
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : invalid();
const id = (v: unknown) => integer(v, 1);
const stars = (v: unknown) => integer(v, 1, 3);
const choice = <T>(v: unknown, options: readonly T[]): T => options[integer(v, 0, options.length - 1)]!;
const unique = <T>(values: T[], key: (v: T) => unknown = (v) => v): T[] =>
  new Set(values.map(key)).size === values.length ? values : invalid();
const ids = (v: unknown) => unique(list(v).map(id));
const sortedEntries = <T>(v: Record<string, T>) => Object.entries(v).sort(([a], [b]) => Number(a) - Number(b));
const canonical = (v: unknown): string => JSON.stringify(v, (_, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);

/** Explicitly select the share scope. New RunInput fields require a decision here and in the format. */
export function sharedChoices(state: AppState): SharedChoices {
  const r = state.run;
  return structuredClone({
    run: { traineeCardId: r.traineeCardId, traineeStars: r.traineeStars, goal: r.goal, targets: r.targets,
      targetLineage: r.targetLineage, parentSparks: r.parentSparks, pinkLineage: r.pinkLineage,
      aptOverrides: r.aptOverrides, pinnedIds: r.pinnedIds, borrowFromAll: r.borrowFromAll,
      wishlistOrder: r.wishlistOrder, wishlistExcluded: r.wishlistExcluded },
    settings: { focus: state.settings.focus, winThreshold: state.settings.winThreshold },
  });
}

// Format 2 slots are documented in docs/sharing.md. Numeric IDs are always the game IDs, never data indexes.
function pack({ run: r, settings: s }: SharedChoices): unknown[] {
  return [r.traineeCardId, r.traineeStars,
    [r.goal.blueStats.reduce((mask, stat) => mask | 1 << STATS.indexOf(stat), 0), r.goal.blueStars,
      r.goal.pink.map((p) => [p.aptitude === 'any' ? 0 : APTITUDES.indexOf(p.aptitude) + 1, p.stars])],
    r.targets.map((t) => [t.id, t.role === 'required' ? 0 : 1, t.stars, t.priority]),
    sortedEntries(r.targetLineage).map(([key, l]) => [Number(key), l.k1, l.k2, l.p1, l.p2]),
    r.parentSparks.map((side) => side.map((p) => p === null ? 0 : STATS.indexOf(p.stat) * 3 + p.stars)),
    r.pinkLineage.map((p) => p === null ? 0 : [APTITUDES.indexOf(p.aptitude), p.stars, p.inferred ? 1 : 0]),
    APTITUDES.flatMap((apt, i) => r.aptOverrides[apt] === undefined ? [] : [[i, GRADES.indexOf(r.aptOverrides[apt]!)]]),
    r.pinnedIds, r.borrowFromAll ? 1 : 0, r.wishlistOrder, r.wishlistExcluded, FOCUSES.indexOf(s.focus), s.winThreshold];
}
const PACKED_DEFAULTS = pack(DEFAULTS);

function unpack(raw: unknown): SharedChoices {
  const entries = list(raw);
  if (entries.length > PACKED_DEFAULTS.length) invalid();
  const a = PACKED_DEFAULTS.map((fallback, i) => entries[i] === undefined || entries[i] === null ? structuredClone(fallback) : entries[i]);
  const goal = tuple(a[2], 3), mask = integer(goal[0], 0, 31);
  const pink = unique(list(goal[2]).map((v) => {
    const p = tuple(v, 2);
    return { aptitude: choice(p[0], ['any' as const, ...APTITUDES]), stars: stars(p[1]) };
  }), (p) => p.aptitude);
  if (!pink.length || (pink.length > 1 && pink.some((p) => p.aptitude === 'any'))) invalid();
  const targets = unique(list(a[3]).map((v) => {
    const t = tuple(v, 4);
    return { id: id(t[0]), role: choice(t[1], ['required', 'preferred'] as const), stars: stars(t[2]), priority: integer(t[3]) };
  }), (t) => t.id);
  const lineage = unique(list(a[4]).map((v) => {
    const l = tuple(v, 5), k1 = integer(l[1], 0, 3), k2 = integer(l[2], 0, 3);
    // Older partial saves can have copies with an unentered star total. Sharing preserves that input.
    return { id: id(l[0]), value: { k1, k2, p1: integer(l[3], 0, 9), p2: integer(l[4], 0, 9) } };
  }), (l) => l.id);
  const parentSparks = tuple(a[5], 2).map((v) => tuple(v, 3).map((v) => {
    const n = integer(v, 0, 15);
    return n === 0 ? null : { stat: STATS[Math.floor((n - 1) / 3)]!, stars: (n - 1) % 3 + 1 };
  }));
  const pinkLineage = tuple(a[6], 6).map((v) => {
    if (v === 0) return null;
    const p = tuple(v, 3);
    return { aptitude: choice(p[0], APTITUDES), stars: stars(p[1]), ...(integer(p[2], 0, 1) ? { inferred: true as const } : {}) };
  });
  const overrides = unique(list(a[7]).map((v) => {
    const p = tuple(v, 2); return { aptitude: choice(p[0], APTITUDES), grade: choice(p[1], GRADES) };
  }), (p) => p.aptitude);
  const threshold = a[13];
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) invalid();
  return {
    run: {
      traineeCardId: a[0] === null ? null : id(a[0]), traineeStars: integer(a[1], 1, 5),
      goal: { blueStats: STATS.filter((_, i) => mask & 1 << i), blueStars: stars(goal[1]), pink }, targets,
      targetLineage: Object.fromEntries(lineage.map((l) => [l.id, l.value])), parentSparks, pinkLineage,
      aptOverrides: Object.fromEntries(overrides.map((p) => [p.aptitude, p.grade])), pinnedIds: ids(a[8]),
      borrowFromAll: !!integer(a[9], 0, 1), wishlistOrder: ids(a[10]), wishlistExcluded: ids(a[11]),
    },
    settings: { focus: choice(a[12], FOCUSES), winThreshold: threshold as number },
  };
}

/** Canonical scope key, also used to avoid encoding on inventory, theme, and advanced-setting changes. */
export const shareKey = (choices: SharedChoices): string => JSON.stringify(pack(choices));

function decodePrototype(raw: unknown): SharedChoices {
  const a = list(raw);
  if (a[0] !== 20) throw new ShareCodeError('version');
  const fields = ['traineeCardId', 'traineeStars', 'goal', 'targets', 'targetLineage', 'parentSparks',
    'pinkLineage', 'aptOverrides', 'pinnedIds', 'borrowFromAll', 'wishlistOrder', 'wishlistExcluded'] as const;
  if (a.length > 15) invalid();
  const run = { ...structuredClone(DEFAULTS.run), ...Object.fromEntries(fields.map((key, i) => [key, a[i + 1] ?? structuredClone(DEFAULTS.run[key])])) };
  const original = { run, settings: { focus: a[13] ?? DEFAULTS.settings.focus, winThreshold: a[14] ?? DEFAULTS.settings.winThreshold } } as SharedChoices;
  const decoded = unpack(pack(original));
  if (canonical(decoded) !== canonical(original)) invalid();
  return decoded;
}

const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

export async function encodeShare(choices: SharedChoices): Promise<string> {
  const packed = pack(choices);
  // Verify the public encoder never emits choices the decoder would silently alter or reject.
  if (canonical(unpack(packed)) !== canonical(choices)) invalid();
  const entries = packed.map((value, i) => canonical(value) === canonical(PACKED_DEFAULTS[i]) ? null : value);
  while (entries.at(-1) === null) entries.pop();
  const bytes = new TextEncoder().encode(JSON.stringify(entries));
  if (bytes.length > MAX_JSON_BYTES) throw new ShareCodeError('size');
  const compressed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const code = compressed.length < bytes.length ? `2d${base64(compressed)}` : `2j${base64(bytes)}`;
  if (code.length > MAX_CODE_LENGTH) throw new ShareCodeError('size');
  return code;
}

/** Validate the complete payload without depending on today's game data or mutating application state. */
export async function decodeShare(code: string): Promise<SharedChoices> {
  try {
    if (code.length > MAX_CODE_LENGTH) throw new ShareCodeError('size');
    if (!/^[0-9][dj][A-Za-z0-9_-]+$/.test(code)) invalid();
    if (code[0] !== '1' && code[0] !== '2') throw new ShareCodeError('version');
    const bytes = Uint8Array.from(atob(code.slice(2).replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
    if (base64(bytes) !== code.slice(2)) invalid();
    const source = new Blob([bytes]).stream();
    const stream = code[1] === 'd' ? source.pipeThrough(new DecompressionStream('deflate-raw')) : source;
    const reader = stream.getReader();
    const chunks: BlobPart[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_JSON_BYTES) { await reader.cancel(); throw new ShareCodeError('size'); }
        chunks.push(value as Uint8Array<ArrayBuffer>);
      }
    } finally { reader.releaseLock(); }
    const raw: unknown = JSON.parse(await new Blob(chunks).text());
    return code[0] === '1' ? decodePrototype(raw) : unpack(raw);
  } catch (error) { throw error instanceof ShareCodeError ? error : new ShareCodeError(); }
}

export function shareCodeFromInput(value: string): string {
  const input = value.trim();
  if (!/^https?:\/\//i.test(input)) return input;
  try { return new URL(input).searchParams.get('run') ?? ''; } catch { throw new ShareCodeError(); }
}

export function shareUrl(href: string, code: string | null): string {
  const url = new URL(href);
  if (code === null) url.searchParams.delete('run'); else url.searchParams.set('run', code);
  return url.href;
}
