import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { ScanCard } from '../src/scanner/recognize.ts';

/** Keep the standalone converter independent of the planner's calculation data. */
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
      const catalog = cards();
      const rBadge = catalog.find(c => c.rarity === 'R')?.id;
      for (const card of catalog.filter(c => c.rarity !== 'R' || c.id === rBadge)) {
        const fileName = `assets/supports/${card.id}.png`;
        this.emitFile({ type: 'asset', fileName, source: readFileSync(resolve(root, 'public', fileName)) });
        if (card.rarity !== 'R') {
          const artwork = `assets/supports/full/${card.id}.png`;
          this.emitFile({ type: 'asset', fileName: artwork, source: readFileSync(resolve(root, 'public', artwork)) });
        }
      }
    },
  };
}
