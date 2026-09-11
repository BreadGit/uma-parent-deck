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

/** Source and data changes invalidate saved calculations without a manually maintained version. */
export function buildVersion(root: string): string {
  const hash = createHash('sha256');
  for (const file of buildVersionFiles(root)) hash.update(relative(root, file)).update('\0').update(readFileSync(file)).update('\0');
  return hash.digest('hex');
}
