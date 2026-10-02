import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

/** Use the same canvas resampling as the scanner, once at generation time instead of on every device. */
export async function buildScannerArtwork(root) {
  const cards = JSON.parse(await fs.readFile(path.join(root, 'data/cards.json'), 'utf8')).filter(c => c.rarity !== 'R');
  const destination = path.join(root, 'public/assets/supports/scanner');
  await fs.mkdir(destination, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    for (const card of cards) {
      const source = await fs.readFile(path.join(root, 'data/raw/scanner-artwork', `${card.id}.png`));
      const encoded = await page.evaluate(async encoded => {
        const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = Math.round(image.height * canvas.width / image.width);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/webp', .95).split(',')[1];
      }, source.toString('base64'));
      await fs.writeFile(path.join(destination, `${card.id}.webp`), Buffer.from(encoded, 'base64'));
    }
  } finally { await browser.close(); }
  console.log(`Generated ${cards.length} scanner references.`);
}

if (process.argv[1] && await fs.realpath(path.resolve(process.argv[1])).catch(() => null) === new URL(import.meta.url).pathname) {
  if (process.argv.includes('--help')) {
    console.log('Generate compact scanner references from data/raw/scanner-artwork into public/assets/supports/scanner.\nRuns offline using Playwright Chromium; install it with npx playwright install chromium if needed.');
  } else await buildScannerArtwork(path.resolve(new URL('..', import.meta.url).pathname));
}
