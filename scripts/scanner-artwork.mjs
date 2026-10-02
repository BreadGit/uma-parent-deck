import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const modified = file => fs.stat(file).then(s => s.mtimeMs, () => null);

/**
 * Use the same canvas resampling as the scanner, once at generation time instead of on every device.
 * A reference newer than its source is kept; `force` regenerates them all after a change to the encoding below.
 */
export async function buildScannerArtwork(root, { force = false } = {}) {
  const cards = JSON.parse(await fs.readFile(path.join(root, 'data/cards.json'), 'utf8')).filter(c => c.rarity !== 'R');
  const destination = path.join(root, 'public/assets/supports/scanner');
  await fs.mkdir(destination, { recursive: true });
  const jobs = [], missing = [];
  for (const card of cards) {
    const source = path.join(root, 'data/raw/scanner-artwork', `${card.id}.png`), output = path.join(destination, `${card.id}.webp`);
    const [sourceTime, outputTime] = await Promise.all([modified(source), modified(output)]);
    if (sourceTime === null) missing.push(card.id);
    else if (force || outputTime === null || outputTime < sourceTime) jobs.push({ source, output });
  }
  if (missing.length) console.warn(`scanner references skipped, source artwork missing: ${missing.join(', ')}`);
  if (jobs.length) {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.route('**/*', route => route.abort());
      for (const { source, output } of jobs) {
        const encoded = await page.evaluate(async encoded => {
          const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = 128; canvas.height = Math.round(image.height * canvas.width / image.width);
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL('image/webp', .95).split(',')[1];
        }, (await fs.readFile(source)).toString('base64'));
        await fs.writeFile(output, Buffer.from(encoded, 'base64'));
      }
    } finally { await browser.close(); }
  }
  console.log(`scanner references: generated ${jobs.length}, up to date ${cards.length - jobs.length - missing.length}, missing source ${missing.length}`);
  return { generated: jobs.length, missing };
}

if (process.argv[1] && await fs.realpath(path.resolve(process.argv[1])).catch(() => null) === new URL(import.meta.url).pathname) {
  if (process.argv.includes('--help')) {
    console.log('Generate compact scanner references from data/raw/scanner-artwork into public/assets/supports/scanner.\nSkips references newer than their source; --force regenerates every one.\nRuns offline using Playwright Chromium; install it with npx playwright install chromium if needed.');
  } else await buildScannerArtwork(path.resolve(new URL('..', import.meta.url).pathname), { force: process.argv.includes('--force') });
}
