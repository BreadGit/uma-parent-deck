import { createHash } from 'node:crypto';

export type PageRevision = { input: string; payload: string };
export const pageInput = (key: string, card: unknown, sources: Record<string, string>) =>
  ({ card, sources, ...(key.startsWith('unique:') ? { textParser: 1 } : {}) });
export const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const pageRevision = (input: unknown, payload: unknown): PageRevision => ({ input: fingerprint(input), payload: fingerprint(payload) });
export function pageCacheMatches(revision: PageRevision | undefined, input: unknown, payload: unknown): boolean {
  return !!revision && payload != null && revision.input === fingerprint(input) && revision.payload === fingerprint(payload);
}

/** The line GameTora prints above the effect for a card whose unique unlocks above the base level. */
export const UNLOCK_LINE = /^Unlocked at level \d+$/;

/** Inline formatting must not split an effect before its value or activation condition. */
export function uniqueEffectText(page: string): string {
  const text = page.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?(?:div|p|h[1-6]|br)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '');
  const after = text.split(/Unique Effect\s*\n/)[1] ?? '';
  const line = after.split('\n').map(l => l.trim()).find(l => l && !UNLOCK_LINE.test(l));
  if (!line) throw new Error('No unique effect description');
  return line.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate before caching. An empty error response must never become a permanent cache hit. */
export function pageEvents(value: unknown, kind: 'support' | 'character', source: string): Record<string, unknown> {
  const data: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!object(data)) throw new Error(`${source}: missing English event data`);
  const groups = kind === 'support' ? ['arrows', 'special', 'random', 'dates', 'dates_random']
    : ['wchoice', 'nochoice', 'version', 'outings', 'secret'];
  const allowed = new Set([...groups, ...(kind === 'character' ? ['nyear', 'dance'] : [])]);
  for (const [key, entries] of Object.entries(data)) {
    if (!allowed.has(key)) throw new Error(`${source}: unfamiliar event group ${key}`);
    if (key === 'nyear') {
      if (typeof entries !== 'string') throw new Error(`${source}: invalid New Year event reference`);
      continue;
    }
    if (key === 'dance') {
      if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string')) throw new Error(`${source}: invalid dance stat references`);
      continue;
    }
    if (!Array.isArray(entries)) throw new Error(`${source}: ${key} must be an event array`);
    for (const event of entries) {
      if (!object(event) || typeof event.n !== 'string' || !Array.isArray(event.c)) throw new Error(`${source}: invalid ${key} event`);
      for (const choice of event.c) {
        if (!object(choice) || !Array.isArray(choice.r) || choice.r.some((reward) => !object(reward) || typeof reward.t !== 'string')) {
          throw new Error(`${source}: invalid rewards in ${key}/${event.n}`);
        }
      }
    }
  }
  if (!groups.some((key) => Array.isArray(data[key]) && data[key].length)) throw new Error(`${source}: empty English event data`);
  return data;
}
