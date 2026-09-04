// Drives the dev server in Chromium and checks zoom-sensitive slider rendering in Firefox.
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
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

// Tick marks must occupy exactly one backing-store pixel each. CSS and SVG strokes
// can cover different numbers of device pixels when browser zoom puts them between pixels.
const readTickPixels = (targetPage) => targetPage.$$eval('.blue-slider-notches', (canvases) => canvases.map((canvas) => {
  const ctx = canvas.getContext('2d');
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const columns = [];
  for (let x = 0; x < canvas.width; x++) {
    let painted = false;
    for (let y = 0; y < canvas.height; y++) painted ||= pixels[(y * canvas.width + x) * 4 + 3] > 0;
    if (painted) columns.push(x);
  }
  const widths = [];
  for (const x of columns) {
    if (!widths.length || x > widths.at(-1).end + 1) widths.push({ start: x, end: x });
    else widths.at(-1).end = x;
  }
  return widths.map(({ start, end }) => end - start + 1);
}));
const tickPixels = await readTickPixels(page);
assert.equal(tickPixels.length, 10, 'not every parent slider has a tick canvas');
assert.ok(tickPixels.every((widths) => widths.length === 10 && widths.every((width) => width === 1)), `slider tick widths vary: ${JSON.stringify(tickPixels)}`);

const firefoxBrowser = await firefox.launch();
try {
  for (const deviceScaleFactor of [1, 1.25, 1.5]) {
    const context = await firefoxBrowser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor });
    const firefoxPage = await context.newPage();
    await firefoxPage.goto(url);
    await firefoxPage.waitForSelector('.blue-slider-notches');
    const widthsAtScale = await readTickPixels(firefoxPage);
    assert.ok(widthsAtScale.every((widths) => widths.length === 10 && widths.every((width) => width === 1)), `Firefox slider tick widths vary at ${deviceScaleFactor}x: ${JSON.stringify(widthsAtScale)}`);
    await context.close();
  }
} finally {
  await firefoxBrowser.close();
}

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
assert.deepEqual(await page.$$eval('select[data-setting="focus"] option', (options) => options.map((option) => option.textContent)), ['Balanced', 'Stamina', 'Sprint']);

await page.fill('#trainee-search', 'special dreamer');
await page.waitForSelector('li[data-action="pick-trainee"]');
await page.click('li[data-action="pick-trainee"]');
const aptitudePlacement = await page.evaluate(() => {
  const traineePanel = [...document.querySelectorAll('section.panel')].find((panel) => panel.querySelector('h2')?.textContent === 'Trainee');
  const advanced = document.querySelector('details[data-details="advanced"]');
  return { trainee: traineePanel.querySelectorAll('select[data-apt]').length, advanced: advanced.querySelectorAll('select[data-apt]').length };
});
assert.deepEqual(aptitudePlacement, { trainee: 6, advanced: 0 });
const baseTurf = await page.inputValue('select[data-apt="turf"]');
const overrideTurf = baseTurf === 'G' ? 'A' : 'G';
await page.selectOption('select[data-apt="turf"]', overrideTurf);
const pickTrainee = async (q) => {
  await page.click('button[data-action="clear-trainee"]');
  await page.fill('#trainee-search', q);
  await page.waitForSelector('li[data-action="pick-trainee"]');
  await page.click('li[data-action="pick-trainee"]');
};
await pickTrainee('special week hopp');
assert.equal(await page.inputValue('select[data-apt="turf"]'), baseTurf, 'selecting a trainee did not restore her default aptitude');
await pickTrainee('special dreamer');
await page.click('details[data-details="advanced"] > summary');
const advancedOverflow = await page.$eval('details[data-details="advanced"]', (details) => {
  const panelRight = details.closest('section.panel').getBoundingClientRect().right;
  return Math.max(0, ...[...details.querySelectorAll('label, input, select')].map((el) => el.getBoundingClientRect().right - panelRight));
});
assert.ok(advancedOverflow <= 0.5, `advanced settings overflow their panel by ${advancedOverflow}px`);
for (const q of ['Corner Recovery', 'Groundwork', 'Pace Strategy']) {
  await page.fill('#target-search', q);
  await page.waitForSelector('li[data-action="add-target"]');
  await page.click('li[data-action="add-target"]');
}
await page.waitForTimeout(300);
// pin a card by search and check it leads the ranking and sits in the deck
await page.fill('#card-search', 'kitasan');
await page.waitForSelector('li[data-action="pin-card"]');
await page.click('li[data-action="pin-card"]');
await page.waitForTimeout(200);
const topRanked = await page.$$eval('section.panel:last-child tbody tr td:nth-child(2)', (tds) => tds.slice(0, 2).map((td) => td.textContent));
assert.ok(topRanked.some((t) => t.includes('Kitasan Black') && t.includes('pinned')), `pinned card should sit with the pinned rows at the top, got: ${topRanked}`);
assert.ok((await page.$$eval('.deck .slot .name', (n) => n.map((x) => x.textContent))).some((n) => n.includes('Kitasan Black')), 'pinned card should be in the deck');
await page.click('.chip button[data-action="unpin-card"]:not([data-id="30052"])');
await page.click('details:has(> summary:text("Where the stats come from")) > summary');
const breakdownRows = await page.$$eval('details:has(> summary:text("Where the stats come from")) tbody tr', (r) => r.length);
assert.ok(breakdownRows >= 10, `breakdown should list cards, career, inheritance, base, final, spread; got ${breakdownRows}`);
const bodyText = await page.textContent('body');
assert.ok(!bodyText.includes('blue spark 1★'), 'predicted run still shows blue spark odds');
assert.ok(!bodyText.includes('Card / event / inherited stats'), 'predicted run still shows stat-source totals');
assert.ok(!bodyText.includes("Blue spark stars depend on each stat's final value"), 'predicted run still shows the removed explanatory blurb');
assert.ok(!bodyText.includes('White spark stars'), 'predicted run still shows white spark odds');
assert.ok(!bodyText.includes('Default limit break for unmarked cards'), 'inventory settings still show default limit-break controls');
assert.ok(!bodyText.includes('Each parent carries up to'), 'parent blue sparks still show the removed explanatory blurb');
const sliderTicks = await page.$eval('.blue-slider', (wrapper) => {
  const input = wrapper.querySelector('input');
  const ticks = wrapper.querySelector('.blue-slider-notches');
  const inputRect = input.getBoundingClientRect();
  const tickRect = ticks.getBoundingClientRect();
  return {
    inputZ: Number(getComputedStyle(input).zIndex),
    ticksZ: Number(getComputedStyle(ticks).zIndex),
    leftInset: tickRect.left - inputRect.left,
    rightInset: inputRect.right - tickRect.right,
  };
});
assert.deepEqual(sliderTicks, { inputZ: 2, ticksZ: 1, leftInset: 10, rightInset: 10 }, 'slider tick geometry is not stable');
assert.equal(await page.locator('.blue-gain-compact').count(), 1, 'parent gain detail is not compact');
assert.equal(await page.locator('.blue-gain-summary [data-inherited-stat]').count(), 5, 'parent gain summary does not include all stats');
const summary = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.chip')].map((c) => c.textContent.trim()),
  deck: [...document.querySelectorAll('.deck .slot .name')].map((n) => n.textContent.trim()),
  stats: [...document.querySelectorAll('.stat .v')].map((n) => n.textContent.trim()),
  pSS: document.querySelector('.kv .v .pill')?.textContent,
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
await page.$eval('input[data-parent="1"][data-stat="0"]', (el) => { el.value = '9'; el.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(200);
const parent2Stars = await page.evaluate(() => [...document.querySelectorAll('input[data-parent="1"]')].map((e) => Number(e.value)));
assert.ok(parent2Stars.reduce((sum, stars) => sum + stars, 0) <= 9, `parent 2 exceeded the 9-star cap: ${parent2Stars}`);
console.log('parent 2 stars after setting speed to 9 (should clamp to 0 with 9 already used):', parent2Stars);
console.log('errors:', errors);
await browser.close();
process.exit(errors.length ? 1 : 0);
