import { defineConfig, type Plugin } from 'vite';
import pkg from './package.json' with { type: 'json' };
import { scannerCatalog } from './scripts/scanner-catalog.ts';
import { buildVersion, buildVersionFiles } from './scripts/build-version.ts';

function recommendationVersion(): Plugin {
  const id = '\0virtual:build-version';
  let root: string;
  return {
    name: 'recommendation-version',
    configResolved(config) { root = config.root; },
    resolveId(source) { if (source === 'virtual:build-version') return id; },
    load(source) { if (source === id) return `export const BUILD_VERSION = ${JSON.stringify(buildVersion(root))};`; },
    handleHotUpdate({ file, server }) {
      if (!buildVersionFiles(root).includes(file)) return;
      const module = server.moduleGraph.getModuleById(id);
      if (module) server.moduleGraph.invalidateModule(module);
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}

// Bundled game data is intentional; review size growth above 3,000 kB per chunk or sooner if loading slows.
export default defineConfig({ define: { __APP_VERSION__: JSON.stringify(pkg.version) }, plugins: [recommendationVersion(), scannerCatalog()], build: { chunkSizeWarningLimit: 3000, rollupOptions: { input: ['index.html', 'scanner.html', 'missions.html'] } } });
