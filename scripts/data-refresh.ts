import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

/** The official site's in-game notice feed, also shown at https://umamusume.com/news/. See docs/umamusume/refs/official-notices.md. */
export const NOTICE_FEED = {
  url: 'https://umamusume.com/api/ajax/pr_info_index?format=json',
  request: { announce_label: 0, limit: 50, offset: 0 },
} as const;
export interface Notice { title: string; postedAt: Date }
/** The notices in a feed response. Times in the feed are UTC, as the notice text states. */
export function noticesFrom(feed: unknown): Notice[] {
  const list = (feed as { information_list?: unknown } | null)?.information_list;
  if (!Array.isArray(list)) throw new Error('The notice feed has no information_list.');
  return list.map((notice: { title?: unknown; post_at?: unknown }) => {
    const postedAt = new Date(typeof notice.post_at === 'string' ? notice.post_at.replace(' ', 'T') + 'Z' : NaN);
    if (typeof notice.title !== 'string' || Number.isNaN(postedAt.getTime())) throw new Error(`Unexpected notice: ${JSON.stringify(notice)}`);
    return { title: notice.title, postedAt };
  });
}
/** Notices posted when content the snapshot covers goes live: cards, trainees, scenarios, events and their missions. */
export const RELEASE_TITLE = /\b(?:out now|is here|now available|latest updates)\b/i;
// The schedule in .github/workflows/update-data.yml runs about one and four hours after the daily 22:00 UTC
// release slot. The window also covers the next day's runs, so a release GameTora reflected late is retried.
export const RELEASE_WINDOW_HOURS = [0, 26] as const;
// The fallback for releases the feed misses: the first run on Monday, 23:xx UTC.
export const WEEKLY_CHECK = { utcDay: 1, utcHour: 23 } as const;
export function refreshDue(now: Date, notices: Notice[]): boolean {
  const [from, until] = RELEASE_WINDOW_HOURS;
  const weekly = now.getUTCDay() === WEEKLY_CHECK.utcDay && now.getUTCHours() === WEEKLY_CHECK.utcHour;
  return weekly || notices.some(notice => {
    const hours = (now.getTime() - notice.postedAt.getTime()) / 3_600_000;
    return RELEASE_TITLE.test(notice.title) && hours >= from && hours < until;
  });
}

// The complete data snapshot includes source caches, generated artwork and fitted extracts.
export const REFRESH_PATHS = ['data', 'public/assets', 'docs/umamusume/loopacord-card-data.csv',
  'docs/umamusume/fujikiseki-card-table.csv', 'docs/umamusume/fujikiseki-card-table.json'];
export function contentForComparison(path: string, bytes: Buffer): Buffer | string {
  if (path === 'data/raw/manifest.json') return ''; // The full manifest also changes for unused upstream sources.
  if (path === 'data/stat-model.json') {
    // BLAS builds differ in the last few digits after the same fit. Keep full precision in the published file.
    return JSON.stringify(JSON.parse(bytes.toString('utf8')), (_key, value) =>
      typeof value === 'number' ? Number(value.toFixed(9)) : value);
  }
  if (['data/meta.json', 'data/missions.json', 'data/raw/fetch-meta.json', 'data/raw/missions-fetch-meta.json'].includes(path)) {
    const { fetchedAt: _checkedAt, ...content } = JSON.parse(bytes.toString('utf8'));
    return JSON.stringify(content);
  }
  return bytes;
}
export async function snapshotDigest(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(path: string) {
    const entries = await readdir(path, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOTDIR') return null;
      throw error;
    });
    if (entries) {
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('page_') || entry.name.endsWith('.tmp')) continue;
        await visit(join(path, entry.name));
      }
    } else {
      const name = relative(root, path).split('\\').join('/');
      hash.update(name).update('\0').update(contentForComparison(name, await readFile(path))).update('\0');
    }
  }
  for (const path of REFRESH_PATHS) await visit(join(root, path));
  return hash.digest('hex');
}
