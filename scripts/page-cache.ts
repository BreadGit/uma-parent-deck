import { createHash } from 'node:crypto';
import { isPlainObject } from '../src/types.ts';
import { REWARD_ID_OFFSET } from './event-import.ts';

export type PageRevision = { input: string; payload: string };
/** The source row a page belongs to: a support card, or a character card for character and outfit pages. */
export type PageCard = { char_id?: number; support_id?: number; card_id?: number };
/** Per page kind, the static feed files listing the page's events, each with the card field that owns its rows there. */
const PAGE_EVENT_OWNERS: Record<string, Record<string, keyof PageCard>> = {
  support: { training_events__ssr: 'support_id', training_events__sr: 'support_id', training_events__friend: 'support_id',
    training_events__group: 'support_id', training_events__shared: 'char_id' },
  character: { training_events__char: 'char_id', training_events__char_card: 'card_id' },
  outfit: { training_events__char: 'char_id', training_events__char_card: 'card_id' },
  unique: {},
};
const REWARD_DICTIONARY = 'dict__evrew';
/** The static feed files a page's events are checked against. */
export const PAGE_SOURCE_FILES = [...new Set(Object.values(PAGE_EVENT_OWNERS).flatMap((owners) => Object.keys(owners))), REWARD_DICTIONARY];

/** Reward IDs of every choice, `[choice id, reward ids]`, in feed rows, including alternative event versions. */
function rewardIds(value: unknown, ids = new Set<number>()): Set<number> {
  if (!Array.isArray(value)) return ids;
  if (value.length === 2 && Number.isInteger(value[0]) && Array.isArray(value[1]) && value[1].length && value[1].every(Number.isInteger)) {
    for (const id of value[1]) ids.add(id);
  } else for (const item of value) rewardIds(item, ids);
  return ids;
}

/**
 * Builds the input a page cache entry is checked against from the static feed files: the page's card, its own event
 * rows and the reward dictionary entries those rows use. A feed change for another card keeps the page cached.
 */
export function pageInputs(files: Record<string, unknown[]>): (key: string, card: PageCard) => unknown {
  const rowsByOwner = new Map(PAGE_SOURCE_FILES.filter((file) => file !== REWARD_DICTIONARY).map((file) => {
    const rows = files[file];
    if (!Array.isArray(rows)) throw new Error(`Page source ${file} is missing`);
    return [file, new Map(rows.map((row) => [Array.isArray(row) ? row[0] : undefined, row]))];
  }));
  const dictionary = files[REWARD_DICTIONARY];
  if (!Array.isArray(dictionary)) throw new Error(`Page source ${REWARD_DICTIONARY} is missing`);
  return (key, card) => {
    const kind = key.slice(0, key.indexOf(':'));
    const owners = PAGE_EVENT_OWNERS[kind];
    if (!owners) throw new Error(`Unknown page cache key ${key}`);
    const events = Object.fromEntries(Object.entries(owners)
      .map(([file, field]) => [file, rowsByOwner.get(file)!.get(card[field]) ?? null]));
    const rewards = [...rewardIds(Object.values(events))].sort((a, b) => a - b).map((id) => [id, dictionary[id - REWARD_ID_OFFSET] ?? null]);
    return { card, events, rewards, ...(kind === 'unique' ? { textParser: 1 } : {}) };
  };
}
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

/** Validate before caching. An empty error response must never become a permanent cache hit. */
export function pageEvents(value: unknown, kind: 'support' | 'character', source: string): Record<string, unknown> {
  const data: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!isPlainObject(data)) throw new Error(`${source}: missing English event data`);
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
      if (!isPlainObject(event) || typeof event.n !== 'string' || !Array.isArray(event.c)) throw new Error(`${source}: invalid ${key} event`);
      for (const choice of event.c) {
        if (!isPlainObject(choice) || !Array.isArray(choice.r) || choice.r.some((reward) => !isPlainObject(reward) || typeof reward.t !== 'string')) {
          throw new Error(`${source}: invalid rewards in ${key}/${event.n}`);
        }
      }
    }
  }
  if (!groups.some((key) => Array.isArray(data[key]) && data[key].length)) throw new Error(`${source}: empty English event data`);
  return data;
}
