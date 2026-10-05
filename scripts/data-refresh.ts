import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export interface Release { at: string; source: string }
/** Reads docs/umamusume/release-calendar.json, rejecting entries the schedule cannot use. */
export function releasesFrom(calendar: unknown): Release[] {
  const releases = (calendar as { releases?: unknown } | null)?.releases;
  if (!Array.isArray(releases)) throw new Error('The release calendar needs a releases array.');
  for (const release of releases as Partial<Release>[]) {
    if (typeof release?.source !== 'string' || !/^https:\/\//.test(release.source) || typeof release.at !== 'string'
      || !/(?:Z|[+-]\d{2}:\d{2})$/.test(release.at) || !Number.isFinite(Date.parse(release.at))) {
      throw new Error(`Each confirmed release needs an ISO timestamp with timezone and an HTTPS source: ${JSON.stringify(release)}`);
    }
  }
  return releases as Release[];
}
// The window lasts one interval of the daily schedule in .github/workflows/update-data.yml, so one run checks each release.
export const RELEASE_WINDOW_HOURS = [4, 28] as const;
export function refreshDue(now: Date, releases: Release[]): boolean {
  const [from, until] = RELEASE_WINDOW_HOURS;
  return now.getUTCDay() === 1 || releases.some(release => {
    const hours = (now.getTime() - Date.parse(release.at)) / 3_600_000;
    return hours >= from && hours < until;
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
