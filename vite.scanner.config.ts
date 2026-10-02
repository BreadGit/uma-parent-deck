import { defineConfig } from 'vite';
import { scannerCatalog } from './scripts/scanner-catalog.ts';

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [scannerCatalog(true)],
  build: { outDir: 'dist-scanner', rollupOptions: { input: 'scanner.html' } },
});
