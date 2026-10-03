import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { artworkPath, badgeCards, referencePath } from '../src/scanner/assets.ts';
import type { ScanCard } from '../src/scanner/recognize.ts';

/**
 * The scanner's card catalog, read from data/cards.json. Whether each SR and SSR card has its matching reference is
 * decided here, once, from the files in public/; `npm run check:data` fails when one is missing.
 */
export function scannerCards(root: string): ScanCard[] {
  return JSON.parse(readFileSync(resolve(root, 'data/cards.json'), 'utf8'))
    .map(({ id, name, charName, rarity, type }: ScanCard) => ({ id, name, charName, rarity, type,
      hasReference: rarity !== 'R' && existsSync(resolve(root, 'public', referencePath(id))) }));
}

/** Keep the standalone scanner independent of the planner's calculation data. */
export function scannerCatalog(bundleArtwork = false): Plugin {
  const id = '\0virtual:scanner-catalog';
  let root: string;
  return {
    name: 'scanner-catalog',
    configResolved(config) { root = config.root; },
    resolveId(source) { if (source === 'virtual:scanner-catalog') return id; },
    load(source) {
      if (source !== id) return;
      this.addWatchFile(resolve(root, 'data/cards.json'));
      return `export const cards = ${JSON.stringify(scannerCards(root))};`;
    },
    generateBundle() {
      if (!bundleArtwork) return;
      // The standalone build has no public directory, so emit the page's icon with the artwork.
      this.emitFile({ type: 'asset', fileName: 'favicon.svg', source: readFileSync(resolve(root, 'public/favicon.svg')) });
      const catalog = scannerCards(root), badges = new Set(badgeCards(catalog));
      const files = [...catalog.filter(c => c.rarity !== 'R' || badges.has(c)).map(c => artworkPath(c.id)),
        ...catalog.filter(c => c.hasReference).map(c => referencePath(c.id))];
      const missing = files.filter(fileName => !existsSync(resolve(root, 'public', fileName)));
      for (const fileName of files) {
        if (!missing.includes(fileName)) this.emitFile({ type: 'asset', fileName, source: readFileSync(resolve(root, 'public', fileName)) });
      }
      if (missing.length) this.warn(`scanner artwork missing from public/: ${missing.join(', ')}`);
    },
  };
}
