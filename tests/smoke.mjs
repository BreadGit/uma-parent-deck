// Drives the dev server in Chromium through the main flows and checks layout at four widths in both themes.
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
assert.deepEqual(await page.$$eval('select[data-setting="focus"] option', (options) => options.map((option) => option.textContent)), ['Balanced', 'Stamina', 'Sprint']);

await page.fill('#trainee-search', 'special dreamer');
await page.waitForSelector('li[data-action="pick-trainee"]');
await page.click('li[data-action="pick-trainee"]');
// the legacy screen mirrors the game: aptitude overrides and per-parent start gains live there, not in the Trainee panel
const legacyPlacement = await page.evaluate(() => {
  const panelOf = (title) => [...document.querySelectorAll('section.panel')].find((panel) => panel.querySelector('h2')?.textContent.startsWith(title));
  return { traineeApts: panelOf('Trainee').querySelectorAll('select[data-apt]').length, legacyApts: panelOf('Legacy screen').querySelectorAll('select[data-apt]').length, gains: panelOf('Legacy screen').querySelectorAll('select[data-gain]').length, styleSelects: [...panelOf('Legacy screen').querySelectorAll('select[data-apt]')].filter((s) => ['front', 'pace', 'late', 'end'].includes(s.dataset.apt)).length };
});
assert.deepEqual(legacyPlacement, { traineeApts: 0, legacyApts: 6, gains: 10, styleSelects: 0 });
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
// picking a start gain fills the dropdown in its parent's colour and raises the start value
await page.selectOption('select[data-gain="1-2"]', '54');
await page.waitForTimeout(200);
const powerCell = await page.$eval('.legacy-stat:nth-child(3)', (el) => ({ start: Number(el.querySelector('.body .v').textContent), base: Number(el.querySelector('.body .sub').textContent.replace(/\D/g, '')), p1: Number(el.querySelector('select[data-gain="0-2"]').value), p2Class: el.querySelector('select[data-gain="1-2"]').className }));
assert.equal(powerCell.start, powerCell.base + powerCell.p1 + 54, 'the start value is base plus both parents');
assert.ok(/\bp2\b/.test(powerCell.p2Class) && /\bset\b/.test(powerCell.p2Class), 'a picked gain is shown filled in parent 2 colour');
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
{
  const firstSelected = await page.$('select[data-slot]:has(option[selected][value]:not([value=""]))');
  const before = await page.$$eval('.agenda-cell.sel', (n) => n.length);
  await firstSelected.selectOption('');
  await page.waitForTimeout(200);
  const after = await page.$$eval('.agenda-cell.sel', (n) => n.length);
  assert.ok(after < before, `skipping a slot should remove a race (${before} -> ${after})`);
}
await page.selectOption('select[data-lb="30028"]', '2');
await page.selectOption('select[data-lb="30052"]', 'none');
await page.waitForTimeout(200);
const afterUnown = await page.evaluate(() => [...document.querySelectorAll('.deck .slot .name')].map((n) => n.textContent.trim()));
console.log('deck after marking Light Hello SSR not owned:', afterUnown);
// the header Reset clears every gain and aptitude override at once
await page.selectOption('select[data-apt="turf"]', 'G');
await page.click('button[data-action="reset-legacy"]');
await page.waitForTimeout(200);
const afterReset = await page.evaluate(() => ({ gains: [...document.querySelectorAll('select[data-gain]')].map((s) => s.value).join(','), turf: document.querySelector('select[data-apt="turf"]').value, options: document.querySelectorAll('select[data-gain="0-0"] option').length }));
assert.equal(afterReset.gains, Array(10).fill('0').join(','), 'every start gain is back to +0');
assert.equal(afterReset.turf, baseTurf, 'the aptitude override is gone');
assert.equal(afterReset.options, 20, 'every possible +XX is offered');
// layout check: no horizontal overflow at common widths, both themes
for (const width of [1280, 1440, 1680, 1920]) {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(100);
    const over = await page.evaluate(() => {
      const w = document.documentElement.clientWidth; const bad = [];
      if (document.documentElement.scrollWidth > w + 1) bad.push(`document ${document.documentElement.scrollWidth} > ${w}`);
      for (const el of document.querySelectorAll('section.panel, .agenda-year, .deck .slot')) { const r = el.getBoundingClientRect(); if (r.right > w + 1) bad.push(`${el.className} right=${Math.round(r.right)}`); }
      return bad;
    });
    assert.deepEqual(over, [], `overflow at ${width}px ${scheme}: ${over.join('; ')}`);
  }
}
console.log('layout ok at 1280-1920px in light and dark');
console.log('errors:', errors);
await browser.close();
process.exit(errors.length ? 1 : 0);
