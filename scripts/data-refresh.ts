import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export interface Release { at: string; source: string }
export function refreshDue(now: Date, releases: Release[]): boolean {
  for (const release of releases) {
    if (!/^https:\/\//.test(release.source) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(release.at) || !Number.isFinite(Date.parse(release.at))) {
      throw new Error('Each confirmed release needs an ISO timestamp with timezone and an HTTPS source.');
    }
  }
  return now.getUTCDay() === 1 || releases.some(release => {
    const hours = (now.getTime() - Date.parse(release.at)) / 3_600_000;
    return hours >= 4 && hours <= 52;
  });
}

// The complete data snapshot includes source caches, generated artwork and fitted extracts.
export const REFRESH_PATHS = ['data', 'public/assets', 'docs/umamusume/loopacord-card-data.csv',
  'docs/umamusume/fujikiseki-card-table.csv', 'docs/umamusume/fujikiseki-card-table.json'];
export function contentForComparison(path: string, bytes: Buffer): Buffer | string {
  if (path === 'data/raw/manifest.json') return ''; // The full manifest also changes for unused upstream sources.
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
