import { defineConfig, type Plugin } from 'vite';
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

export default defineConfig({ plugins: [recommendationVersion()], build: { chunkSizeWarningLimit: 2000 } });
