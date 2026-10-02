import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { assertServesThisTree } from './browser-fields.mjs';

const base = process.env.URL ?? 'http://localhost:5173/';
const browser = await chromium.launch();
const page = await browser.newPage();
const file = new URL('fixtures/scanner/android.jpg', import.meta.url).pathname;
const workers = [], errors = [], referenceRequests = [];
page.on('worker', worker => workers.push(worker));
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => { if (request.url().includes('/assets/supports/scanner/')) referenceRequests.push(request.url()); });
async function holdScreenshot() {
  await page.evaluate(() => {
    const decode = Image.prototype.decode;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    window.screenshotPending = window.screenshotFinished = false;
    Image.prototype.decode = async function () {
      if (!this.src.startsWith('blob:')) return decode.call(this);
      window.screenshotPending = true;
      await gate;
      await decode.call(this);
      window.screenshotFinished = true;
    };
    window.releaseScreenshot = () => { Image.prototype.decode = decode; release(); };
  });
}
/** The JSON is built only while the preview is open, so open it before reading. */
async function previewJson() {
  const preview = page.locator('[data-preview]');
  if (!await preview.evaluate(details => details.open)) await preview.locator('summary').click();
  return JSON.parse(await page.locator('[data-json]').textContent());
}
async function start() {
  await page.locator('[data-files]').setInputFiles(file);
  await page.locator('[data-stop]').waitFor({ state: 'visible' });
}
async function scan(count) {
  await start();
  await page.locator('[data-stop]').waitFor({ state: 'hidden', timeout: 90000 });
  assert.deepEqual(await page.locator('[role="alert"]').allTextContents(), []);
  assert.equal(await page.locator('[data-row]').count(), count);
  assert.equal(await page.locator('[data-download]').isEnabled(), true);
  assert.equal((await previewJson())[30001], 1);
}
async function failed(count) {
  await page.getByRole('alert').waitFor({ timeout: 10000 });
  assert.match(await page.getByRole('alert').textContent(), /Recognition stopped/);
  await page.locator('[data-stop]').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-row]').count(), count, 'worker errors retain completed readings');
  assert.equal(await page.locator('[data-files]').isEnabled(), true, 'worker errors allow retry');
}
async function stop(count) {
  await page.locator('[data-stop]').click();
  assert.equal(await page.getByRole('status').textContent(), 'Stopped');
  assert.deepEqual(await page.locator('[role="alert"]').allTextContents(), []);
  assert.equal(await page.locator('[data-row]').count(), count, 'cancellation retains completed readings');
}
try {
  await page.goto(new URL('scanner.html', base).href);
  await assertServesThisTree(base);
  let mode = 'fail';
  await page.route(/\/(?:src\/scanner\/worker\.ts|assets\/worker-[^/]+\.js)(?:\?|$)/, route => {
    if (mode === 'fail') return route.fulfill({ contentType: 'text/javascript', body: "throw new Error('Simulated scanner worker failure')" });
    if (mode === 'hold') return route.fulfill({ contentType: 'text/javascript', body: 'self.initializing = new Promise(resolve => { self.onmessage = () => resolve(); });' });
    return route.continue();
  });
  // Keep decoding pending so a startup error cannot be rescued by a later scan handler.
  await holdScreenshot();
  await start();
  await failed(0);
  mode = 'normal';
  await page.evaluate(() => window.releaseScreenshot());
  const loadedReferences = referenceRequests.length;
  await scan(10);
  const initializedWorkers = workers.length;
  await scan(20);
  assert.equal(workers.length, initializedWorkers, 'completed scans reuse the initialized worker and its templates');
  assert.equal(referenceRequests.length, loadedReferences, 'retry and later scans reuse loaded references');

  // A worker can also fail after readiness while the next screenshot is being prepared.
  await holdScreenshot();
  await start();
  await page.waitForFunction(() => window.screenshotPending);
  const workerError = page.waitForEvent('pageerror', { predicate: error => error.message.includes('Simulated scanner worker failure') });
  await workers.at(-1).evaluate(() => setTimeout(() => { throw new Error('Simulated scanner worker failure'); }, 0));
  await workerError;
  await page.evaluate(() => window.releaseScreenshot());
  await failed(20);
  await scan(30);

  await holdScreenshot();
  await start();
  await page.waitForFunction(() => window.screenshotPending);
  await stop(30);
  await page.evaluate(() => window.releaseScreenshot());
  await page.waitForFunction(() => window.screenshotFinished);
  assert.equal(await page.locator('[data-row]').count(), 30, 'a cancelled decode cannot add late results');

  mode = 'hold';
  const initializing = page.waitForEvent('worker');
  await start();
  await (await initializing).evaluate(() => self.initializing);
  await stop(30);
  mode = 'normal';
  await scan(40);
  assert.ok(errors.every(error => error.includes('Simulated scanner worker failure')), String(errors));
  console.log('Scanner worker: early and idle failures, retry, reuse and cancellation during startup and decoding passed.');
} finally { await browser.close(); }
