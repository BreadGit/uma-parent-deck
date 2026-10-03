import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { assertServesThisTree } from './browser-fields.mjs';

const base = process.env.URL ?? 'http://localhost:5173/';
const browser = await chromium.launch();
const page = await browser.newPage();
const file = new URL('fixtures/scanner/android.jpg', import.meta.url).pathname;
const iphone = new URL('fixtures/scanner/iphone.jpg', import.meta.url).pathname;
const srAndR = new URL('fixtures/scanner/sr-and-r.jpg', import.meta.url).pathname;
const workers = [], errors = [], referenceRequests = [];
page.on('worker', worker => workers.push(worker));
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => { if (request.url().includes('/assets/supports/scanner/')) referenceRequests.push(request.url()); });
/** Holds screenshot decoding, after letting the first `skip` screenshots through. */
async function holdScreenshot(skip = 0) {
  await page.evaluate(skip => {
    const decode = Image.prototype.decode;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    window.screenshotPending = window.screenshotFinished = false;
    Image.prototype.decode = async function () {
      if (!this.src.startsWith('blob:') || skip-- > 0) return decode.call(this);
      window.screenshotPending = true;
      await gate;
      await decode.call(this);
      window.screenshotFinished = true;
    };
    window.releaseScreenshot = () => { Image.prototype.decode = decode; release(); };
  }, skip);
}
/** The JSON is built only while the preview is open, so open it before reading. */
async function previewJson() {
  const preview = page.locator('[data-preview]');
  if (!await preview.evaluate(details => details.open)) await preview.locator('summary').click();
  return JSON.parse(await page.locator('[data-json]').textContent());
}
async function start(files = file) {
  await page.locator('[data-files]').setInputFiles(files);
  await page.locator('[data-stop]').waitFor({ state: 'visible' });
}
/** Readings counted by the batch line: every screenshot read so far, including overlapping ones. */
const readings = async () => Number((await page.locator('[data-batch]').textContent()).match(/(\d+) readings?/)[1]);
async function scan(count) {
  await start();
  await page.locator('[data-stop]').waitFor({ state: 'hidden', timeout: 90000 });
  assert.deepEqual(await page.locator('[role="alert"]').allTextContents(), []);
  assert.equal(await readings(), count);
  assert.equal(await page.locator('[data-download]').isEnabled(), true);
  assert.equal((await previewJson())[30001], 1);
}
async function failed(count) {
  await page.getByRole('alert').waitFor({ timeout: 10000 });
  assert.match(await page.getByRole('alert').textContent(), /Recognition stopped.*Details: .*Simulated scanner worker failure/s,
    'the worker error message reaches the page');
  await page.locator('[data-stop]').waitFor({ state: 'hidden' });
  assert.equal(await readings(), count, 'worker errors retain completed readings');
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
  assert.equal(await page.locator('[data-reading]').count(), 0, 'stopping removes the reading indicator');
  assert.deepEqual(await page.locator('[role="alert"]').allTextContents(), []);
  assert.equal(await readings(), count, 'cancellation retains completed readings');
}
try {
  await page.goto(new URL('scanner.html', base).href);
  await assertServesThisTree(base);
  // Record how many buffers each message transfers instead of copying.
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage;
    window.transfers = [];
    Worker.prototype.postMessage = function (message, transfer) {
      window.transfers.push([message.kind, transfer?.length ?? 0]);
      return post.call(this, message, transfer);
    };
  });
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
  assert.match(await page.getByRole('alert').textContent(), /android\.jpg: Not read because recognition stopped/,
    'a screenshot chosen before the worker failed to start says it was not read');
  mode = 'normal';
  await page.evaluate(() => window.releaseScreenshot());
  await scan(10);
  const loadedReferences = referenceRequests.length, initializedWorkers = workers.length;
  await scan(20);
  assert.equal(workers.length, initializedWorkers, 'completed scans reuse the initialized worker and its templates');
  assert.equal(referenceRequests.length, loadedReferences, 'later scans reuse the worker\'s references');
  const transfers = await page.evaluate(() => window.transfers);
  // A transferred buffer cannot be sent twice, so the retry after the failed worker decoded its own references.
  const references = transfers.filter(([kind]) => kind === 'references');
  assert.equal(references.length, 2, 'the failed worker and its replacement each received references');
  assert.ok(references.every(([, buffers]) => buffers > 100), 'references move to the worker');
  assert.deepEqual(transfers.filter(([kind]) => kind === 'scan'), [['scan', 1], ['scan', 1]], 'screenshot pixels move to the worker');

  // A worker can also fail after readiness while the next screenshot is being prepared.
  await holdScreenshot();
  await start();
  await page.waitForFunction(() => window.screenshotPending);
  assert.equal(await page.locator('[data-reading] .scan-spinner').count(), 1, 'reading shows a spinner in step 2');
  assert.equal(await page.locator('[data-bar] .scan-spinner').count(), 0, 'the action bar keeps one shape');
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
  assert.equal(await readings(), 40, 'a cancelled decode cannot add late results');
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
  assert.equal(await readings(), 50, 'a dropped screenshot is read');
  assert.equal(await page.locator('.scan-messages').count(), 0, 'reading a screenshot again clears its earlier failure');

  // Every file of a batch is listed from the start, so one stopped or failed before its turn says it was not read.
  const notRead = async (reason, names) => assert.deepEqual(
    (await page.locator('.scan-messages p').allTextContents()).filter(text => text.includes('Not read')),
    names.map(name => `${name}: Not read because ${reason}. Add this screenshot again.`));
  // The worker fails while the second of three screenshots is prepared: the first keeps its readings.
  await holdScreenshot(1);
  await start([file, iphone, srAndR]);
  await page.waitForFunction(() => window.screenshotPending);
  assert.match(await page.locator('.scan-sources').textContent(), /sr-and-r\.jpg\s*Waiting to be read/, 'a later file waits its turn');
  await crash();
  await page.evaluate(() => window.releaseScreenshot());
  await failed(60);
  await notRead('recognition stopped', ['iphone.jpg', 'sr-and-r.jpg']);
  // Adding them again replaces those attempts; stopping during the first leaves both unread again.
  await holdScreenshot();
  await start([iphone, srAndR]);
  await page.waitForFunction(() => window.screenshotPending);
  await stop(60);
  await notRead('reading was stopped', ['iphone.jpg', 'sr-and-r.jpg']);
  await page.evaluate(() => window.releaseScreenshot());
  await page.waitForFunction(() => window.screenshotFinished);
  assert.equal(await readings(), 60, 'a stopped batch adds no late results');
  assert.ok(errors.every(error => error.includes('Simulated scanner worker failure')), String(errors));

  // The catalog lists only references that exist, so a reference that does not load means the artwork is unreachable.
  const partial = await browser.newPage();
  await partial.route(/\/assets\/supports\/scanner\//, route => route.fulfill({ status: 404, body: '' }));
  await partial.goto(new URL('scanner.html', base).href);
  await partial.locator('[data-files]').setInputFiles(file);
  await partial.getByRole('alert').waitFor({ timeout: 90000 });
  assert.match(await partial.getByRole('alert').textContent(), /Could not load the card artwork/);
  console.log('Scanner worker: early, mid-batch and idle failures, retry, reuse, drops, cancellation during startup and decoding, unread files of an interrupted batch, and unreachable references passed.');
} finally { await browser.close(); }
