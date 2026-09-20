import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export function buildVersionFiles(root: string): string[] {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
  return [...walk(join(root, 'src')),
    ...readdirSync(join(root, 'data')).filter((name) => name.endsWith('.json')).map((name) => join(root, 'data', name)),
    ...['inventory.json', 'package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'scripts/build-version.ts'].map((name) => join(root, name)),
  ].sort();
}

/** Vite serves the virtual module here, so a running dev server can say which checkout it serves. */
export const BUILD_VERSION_PATH = '/@id/__x00__virtual:build-version';

/** The hash in a dev server's response for `BUILD_VERSION_PATH`, or null when the response is not that module (a preview build has none). */
export function parseBuildVersion(source: string): string | null {
  return /export const BUILD_VERSION = "([0-9a-f]{64})"/.exec(source)?.[1] ?? null;
}

/** Source and data changes invalidate saved calculations without a manually maintained version. */
export function buildVersion(root: string): string {
  const hash = createHash('sha256');
  for (const file of buildVersionFiles(root)) hash.update(relative(root, file)).update('\0').update(readFileSync(file)).update('\0');
  return hash.digest('hex');
}
