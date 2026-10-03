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
  assert.match(await page.getByRole('alert').textContent(), /Recognition stopped.*Details: .*Simulated scanner worker failure/s,
    'the worker error message reaches the page');
  await page.locator('[data-stop]').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-row]').count(), count, 'worker errors retain completed readings');
  assert.equal(await page.locator('[data-files]').isEnabled(), true, 'worker errors allow retry');
}
async function crash() {
  // The page logs the worker's own message when it drops the worker.
  const workerError = page.waitForEvent('console', { predicate: message => message.type() === 'error'
    && message.text().includes('Scanner worker failed') && message.text().includes('Simulated scanner worker failure') });
  await workers.at(-1).evaluate(() => setTimeout(() => { throw new Error('Simulated scanner worker failure'); }, 0));
  await workerError;
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
  assert.equal(await page.locator('.scan-status progress').count(), 1, 'reading shows a progress bar');
  await crash();
  await page.evaluate(() => window.releaseScreenshot());
  await failed(20);
  assert.match(await page.getByRole('alert').textContent(), /android\.jpg: Not read because recognition stopped/,
    'an interrupted screenshot says it was not read');
  await scan(30);

  // An idle crash drops the worker; the next batch starts another instead of failing.
  const beforeIdleCrash = workers.length;
  await crash();
  await scan(40);
  assert.equal(workers.length, beforeIdleCrash + 1, 'a crashed idle worker is replaced');

  // Files dropped while a batch is read are refused with a notice, as the disabled file input refuses them.
  await holdScreenshot();
  await start();
  await page.waitForFunction(() => window.screenshotPending);
  const dropped = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['x'], 'late.png', { type: 'image/png' }));
    return transfer;
  });
  await page.dispatchEvent('[data-dropzone]', 'dragover', { dataTransfer: dropped });
  await page.dispatchEvent('[data-dropzone]', 'drop', { dataTransfer: dropped });
  assert.match(await page.locator('[data-notice]').textContent(), /Still reading/);
  assert.equal(await page.locator('[data-dropzone].scan-dragging').count(), 0, 'a refused drop is not highlighted');
  await stop(40);
  assert.match(await page.locator('.scan-messages').textContent(), /android\.jpg: Not read because reading was stopped/);
  await page.evaluate(() => window.releaseScreenshot());
  await page.waitForFunction(() => window.screenshotFinished);
  assert.equal(await page.locator('[data-row]').count(), 40, 'a cancelled decode cannot add late results');
  assert.equal(await page.locator('[data-files]').isEnabled(), true);

  mode = 'hold';
  const initializing = page.waitForEvent('worker');
  await start();
  await (await initializing).evaluate(() => self.initializing);
  await stop(40);
  mode = 'normal';
  // An idle drop highlights the zone and reads the file.
  await page.dispatchEvent('[data-dropzone]', 'dragenter', { dataTransfer: dropped });
  assert.equal(await page.locator('[data-dropzone].scan-dragging').count(), 1, 'dragging over the zone highlights it');
  await page.dispatchEvent('[data-dropzone]', 'dragleave', { dataTransfer: dropped });
  assert.equal(await page.locator('[data-dropzone].scan-dragging').count(), 0);
  const android = await page.evaluateHandle(async () => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([await (await fetch('/tests/fixtures/scanner/android.jpg')).blob()], 'android.jpg', { type: 'image/jpeg' }));
    return transfer;
  });
  await page.dispatchEvent('[data-dropzone]', 'drop', { dataTransfer: android });
  await page.locator('[data-stop]').waitFor({ state: 'hidden', timeout: 90000 });
  assert.equal(await page.locator('[data-row]').count(), 50, 'a dropped screenshot is read');
  assert.equal(await page.locator('.scan-messages').count(), 0, 'reading a screenshot again clears its earlier failure');
  assert.ok(errors.every(error => error.includes('Simulated scanner worker failure')), String(errors));
  console.log('Scanner worker: early, mid-batch and idle failures, retry, reuse, drops and cancellation during startup and decoding passed.');
} finally { await browser.close(); }
