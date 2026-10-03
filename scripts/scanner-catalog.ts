import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { BADGE_TRIES } from '../src/scanner/images.ts';
import type { ScanCard } from '../src/scanner/recognize.ts';

/** Keep the standalone scanner independent of the planner's calculation data. */
export function scannerCatalog(bundleArtwork = false): Plugin {
  const id = '\0virtual:scanner-catalog';
  let root: string;
  const cards = (): ScanCard[] => JSON.parse(readFileSync(resolve(root, 'data/cards.json'), 'utf8'))
    .map(({ id, name, charName, rarity, type }: ScanCard) => ({ id, name, charName, rarity, type }));
  return {
    name: 'scanner-catalog',
    configResolved(config) { root = config.root; },
    resolveId(source) { if (source === 'virtual:scanner-catalog') return id; },
    load(source) {
      if (source !== id) return;
      this.addWatchFile(resolve(root, 'data/cards.json'));
      return `export const cards = ${JSON.stringify(cards())};`;
    },
    generateBundle() {
      if (!bundleArtwork) return;
      // The standalone build has no public directory, so emit the page's icon with the artwork.
      this.emitFile({ type: 'asset', fileName: 'favicon.svg', source: readFileSync(resolve(root, 'public/favicon.svg')) });
      // The page leaves out a card whose reference is missing (`loadReferences`), so the build skips a missing file
      // with a warning instead of failing. Of the R cards, only the badge candidates are loaded.
      const catalog = cards();
      const rBadges = new Set(catalog.filter(c => c.rarity === 'R').slice(0, BADGE_TRIES).map(c => c.id));
      const missing: string[] = [];
      const emit = (fileName: string) => {
        const path = resolve(root, 'public', fileName);
        if (existsSync(path)) this.emitFile({ type: 'asset', fileName, source: readFileSync(path) });
        else missing.push(fileName);
      };
      for (const card of catalog.filter(c => c.rarity !== 'R' || rBadges.has(c.id))) {
        emit(`assets/supports/${card.id}.png`);
        if (card.rarity !== 'R') emit(`assets/supports/scanner/${card.id}.webp`);
      }
      if (missing.length) this.warn(`scanner artwork missing, those cards cannot be matched: ${missing.join(', ')}`);
    },
  };
}
