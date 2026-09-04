// Drives the dev server page with headless Chromium: enable unowned cards, add targets, pick a trainee, screenshot.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const url = process.env.URL ?? 'http://localhost:5173/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForSelector('h1');
await page.evaluate(() => localStorage.clear());
await page.reload();

// A range input must stay mounted while it is dragged. Replacing it on each input event
// breaks pointer capture and prevents the thumb from reaching the pointer.
const threshold = page.locator('input[data-setting="winThreshold"]');
const thresholdBox = await threshold.boundingBox();
await page.evaluate(() => {
  const app = document.querySelector('#app');
  globalThis.__rangeSlider = document.querySelector('input[data-setting="winThreshold"]');
  globalThis.__rangeMutations = 0;
  globalThis.__rangeObserver = new MutationObserver((records) => {
    globalThis.__rangeMutations += records.reduce((count, record) => count + record.addedNodes.length + record.removedNodes.length, 0);
  });
  globalThis.__rangeObserver.observe(app, { childList: true });
});
await page.mouse.move(thresholdBox.x + thresholdBox.width * 0.8, thresholdBox.y + thresholdBox.height / 2);
await page.mouse.down();
await page.mouse.move(thresholdBox.x + thresholdBox.width * 0.2, thresholdBox.y + thresholdBox.height / 2, { steps: 12 });
const duringDrag = await page.evaluate(() => ({
  connected: globalThis.__rangeSlider.isConnected,
  mutations: globalThis.__rangeMutations,
  value: Number(document.querySelector('input[data-setting="winThreshold"]').value),
}));
await page.mouse.up();
assert.equal(duringDrag.connected, true, 'range input was replaced during drag');
assert.equal(duringDrag.mutations, 0, 'app rerendered during drag');
assert.ok(duringDrag.value <= 0.3, `drag toward 20% stopped at ${duringDrag.value * 100}%`);
await page.waitForFunction(() => [...document.querySelectorAll('h2')].some((h) => h.textContent.includes(`threshold ${Math.round(Number(document.querySelector('input[data-setting="winThreshold"]').value) * 100)}%`)));
await page.evaluate(() => globalThis.__rangeObserver.disconnect());
await page.$eval('input[data-setting="winThreshold"]', (el) => {
  el.value = '0.8';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});

await page.selectOption('select[data-default-lb="SSR"]', '4');
const traineeVal = await page.$eval('select[data-select="trainee"]', (s) => [...s.options].find((o) => o.text.includes('Special Week [Special Dreamer]'))?.value);
await page.selectOption('select[data-select="trainee"]', traineeVal);
for (const q of ['Corner Recovery', 'Groundwork', 'Pace Strategy']) {
  await page.fill('#target-search', q);
  await page.waitForSelector('li[data-action="add-target"]');
  await page.click('li[data-action="add-target"]');
}
await page.waitForTimeout(300);
const summary = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.chip')].map((c) => c.textContent.trim()),
  deck: [...document.querySelectorAll('.deck .slot .name')].map((n) => n.textContent.trim()),
  stats: [...document.querySelectorAll('.stat .v')].map((n) => n.textContent.trim()),
  pSS: document.querySelector('.kv .v.ok, .kv .v.warn')?.textContent,
  wishlist: [...document.querySelectorAll('ol li')].slice(0, 10).map((n) => n.textContent.trim().slice(0, 80)),
  races: document.querySelector('h2:has(+ .scroll)')?.textContent,
  rankingRows: document.querySelectorAll('section.panel:last-child tbody tr').length,
  top3: [...document.querySelectorAll('section.panel:last-child tbody tr')].slice(0, 3).map((r) => r.children[1].textContent.trim().split('\n')[0]),
}));
console.log(JSON.stringify(summary, null, 1));
await page.screenshot({ path: 'docs/screenshot.png', fullPage: true });
// exercise a race override, an LB change, a "not owned" mark and a blue spark slider
await page.click('input[data-race]');
await page.selectOption('select[data-lb="30028"]', '2');
await page.selectOption('select[data-lb="30052"]', 'none');
await page.waitForTimeout(200);
const afterUnown = await page.evaluate(() => [...document.querySelectorAll('.deck .slot .name')].map((n) => n.textContent.trim()));
console.log('deck after marking Light Hello SSR not owned:', afterUnown);
await page.$eval('input[data-blue="0"]', (el) => { el.value = '18'; el.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(200);
console.log('blue stars after setting speed to 18:', await page.evaluate(() => [...document.querySelectorAll('input[data-blue]')].map((e) => e.value)));
console.log('errors:', errors);
await browser.close();
process.exit(errors.length ? 1 : 0);
