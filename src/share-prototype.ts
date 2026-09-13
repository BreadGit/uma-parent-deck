// Prototype format. Keep the positional field order stable until this experiment is replaced.
import { DEFAULT_RUN, STATE_VERSION, migrate, type AppState } from './state.ts';
import { DEFAULT_SETTINGS } from './settings.ts';
import type { Data } from './types.ts';

const FIELDS = ['traineeCardId', 'traineeStars', 'goal', 'targets', 'targetLineage', 'parentSparks',
  'pinkLineage', 'aptOverrides', 'pinnedIds', 'borrowFromAll', 'wishlistOrder', 'wishlistExcluded'] as const;
const defaults = [...FIELDS.map((key) => DEFAULT_RUN[key]), DEFAULT_SETTINGS.focus, DEFAULT_SETTINGS.winThreshold];
const values = (state: AppState): unknown[] => [...FIELDS.map((key) => state.run[key]), state.settings.focus, state.settings.winThreshold];
const canonical = (value: unknown): string => JSON.stringify(value, (_, v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

/** Self-contained code, with defaults omitted and the shorter of plain or raw-deflate bytes. */
export async function encodeShare(state: AppState): Promise<string> {
  const entries = values(state).map((value, i) => canonical(value) === canonical(defaults[i]) ? null : value);
  while (entries.at(-1) === null) entries.pop();
  const bytes = new TextEncoder().encode(JSON.stringify([STATE_VERSION, ...entries]));
  const compressed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  return compressed.length < bytes.length ? `1d${base64(compressed)}` : `1j${base64(bytes)}`;
}

/** Decode completely before changing any saved choices. Inventory and unrelated settings stay local. */
export async function decodeShare(code: string, current: AppState, data: Data): Promise<AppState> {
  if (!/^1[dj][A-Za-z0-9_-]+$/.test(code) || code.length > 16000) throw new Error('Invalid code');
  const bytes = Uint8Array.from(atob(code.slice(2).replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
  const source = new Blob([bytes]).stream();
  const stream = code[1] === 'd' ? source.pipeThrough(new DecompressionStream('deflate-raw')) : source;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 100000) { await reader.cancel(); throw new Error('Code too large'); }
    chunks.push(value);
  }
  const raw: unknown = JSON.parse(await new Blob(chunks as BlobPart[]).text());
  if (!Array.isArray(raw) || raw[0] !== STATE_VERSION || raw.length > defaults.length + 1) throw new Error('Unsupported code');
  const decoded = defaults.map((value, i) => raw[i + 1] ?? structuredClone(value));
  const run = { ...current.run, ...Object.fromEntries(FIELDS.map((key, i) => [key, decoded[i]])) };
  const settings = { ...current.settings, focus: decoded[FIELDS.length], winThreshold: decoded[FIELDS.length + 1] };
  const sanitized = migrate({ current: { version: STATE_VERSION, run, settings } }, data);
  if (canonical(values(sanitized)) !== canonical(decoded)) throw new Error('Invalid choices');
  return { ...current, run: { ...current.run, ...Object.fromEntries(FIELDS.map((key) => [key, sanitized.run[key]])) },
    settings: { ...current.settings, focus: sanitized.settings.focus, winThreshold: sanitized.settings.winThreshold } };
}
