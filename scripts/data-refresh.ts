import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { isPlainObject } from '../src/types.ts';

/** The record of the static feed files last downloaded, by key, with the manifest hash of each. */
export const RECORDED_HASHES = 'data/raw/hashes.json';
/** The recorded source files whose hash in GameTora's manifest differs from the version last downloaded. */
export function changedSources(manifest: unknown, recorded: unknown): string[] {
  if (!isPlainObject(manifest)) throw new Error('The GameTora manifest is not an object.');
  if (!isPlainObject(recorded) || !Object.keys(recorded).length) throw new Error(`${RECORDED_HASHES} records no source files.`);
  return Object.keys(recorded).filter(key => manifest[key] !== recorded[key]);
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
