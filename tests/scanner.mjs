import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { importInventory } from '../src/inventory.ts';
import { loadData } from '../src/data.ts';
import { assertServesThisTree } from './browser-fields.mjs';

const base = process.env.URL ?? 'http://localhost:5173/';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [], uploads = [], referenceRequests = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => { if (request.method() !== 'GET') uploads.push(request.url()); });
page.on('request', request => { if (request.url().includes('/assets/supports/')) referenceRequests.push(request.url()); });
async function scanFile(file, expectedError) {
  await page.locator('[data-files]').setInputFiles(file);
  await page.locator('[data-stop]').waitFor({ state: 'visible' });
  await page.locator('[data-stop]').waitFor({ state: 'hidden', timeout: 90000 });
  const alerts = await page.locator('[role="alert"]').allTextContents();
  if (expectedError) { assert.equal(alerts.length, 1); assert.match(alerts[0], expectedError); }
  else assert.deepEqual(alerts, []);
}
const scan = name => scanFile(new URL(`fixtures/scanner/${name}.jpg`, import.meta.url).pathname);
async function newInventory() {
  await page.locator('[data-new]').click(); await page.locator('[data-dialog-confirm]').click();
  // The dialog's close event is queued; wait for reset before choosing the next file.
  await page.locator('[data-new]').waitFor({ state: 'detached' });
}
async function chooseCard(key, id) {
  const input = page.locator(`[data-card="${key}"]`);
  await input.fill(loadData().cards.find(card => card.id === id).name);
  await page.locator(`[role="option"][data-id="${id}"]`).click();
  assert.equal(await input.getAttribute('data-card-id'), String(id));
}
async function alteredScreenshot(name, changes) {
  const source = await readFile(new URL(`fixtures/scanner/${name}.jpg`, import.meta.url));
  const encoded = await page.evaluate(async ({ encoded, width, dx = 0, dy = 0, covers = [], copies = [] }) => {
    const image = new Image(); image.src = `data:image/jpeg;base64,${encoded}`; await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width ?? image.width; canvas.height = Math.round(image.height * canvas.width / image.width);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#777'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, dx, dy, canvas.width, canvas.height);
    for (const cover of covers) ctx.fillRect(...cover.map(value => value * canvas.width / 600));
    // Copies are [x, y, width, height, toX, toY] in the same 600 px coordinates as covers.
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height), scratch = document.createElement('canvas');
    scratch.width = canvas.width; scratch.height = canvas.height; scratch.getContext('2d').putImageData(before, 0, 0);
    for (const [x, y, w, h, toX, toY] of copies.map(copy => copy.map(value => value * canvas.width / 600))) {
      ctx.drawImage(scratch, x, y, w, h, toX, toY, w, h);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  }, { encoded: source.toString('base64'), ...changes });
  return { name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') };
}
try {
  await page.goto(new URL('scanner.html', base).href);
  await assertServesThisTree(base);
  assert.equal(await page.title(), 'Uma inventory scanner');
  await page.locator('[data-add]').click();
  const manual = page.locator('[data-row]').first(), picker = manual.locator('[data-card]');
  assert.equal(await picker.evaluate(el => el === document.activeElement), true, 'manual cards focus the search');
  assert.equal(await picker.getAttribute('role'), 'combobox');
  await picker.press('Enter');
  assert.equal(await picker.getAttribute('data-card-id'), '', 'Enter without a query or highlight chooses nothing');
  await picker.fill('special');
  await picker.press('Enter');
  assert.equal(await picker.getAttribute('data-card-id'), '', 'Enter does not guess among several matches');
  await picker.fill('  SSR   LAUREL stop stamina ');
  assert.equal(await page.locator('[role="option"]').count(), 1, 'search combines name, title, rarity and type words');
  assert.equal(await page.locator('[role="option"]').getAttribute('data-id'), '30125');
  assert.equal(await picker.getAttribute('data-card-id'), '', 'typing does not select a card');
  await picker.press('Enter');
  assert.match(await picker.inputValue(), /Sakura Laurel/);
  assert.equal(await picker.getAttribute('data-card-id'), '30125');
  await manual.locator('[data-lb]').selectOption('2');
  await picker.fill('no-such-card');
  assert.match(await page.getByRole('status').textContent(), /No cards match/);
  await picker.press('Enter');
  assert.equal(await picker.getAttribute('data-card-id'), '30125', 'no results cannot change the selection');
  await picker.press('Escape');
  assert.equal(await picker.getAttribute('aria-expanded'), 'false');
  assert.match(await picker.inputValue(), /Sakura Laurel/, 'Escape restores the selected label');
  await picker.click();
  assert.equal(await picker.getAttribute('aria-expanded'), 'true', 'click reopens a focused picker');
  await picker.fill('winning dream');
  await picker.press('ArrowDown');
  const active = await picker.getAttribute('aria-activedescendant');
  assert.equal(await page.locator(`#${active}`).getAttribute('data-id'), '30062');
  await picker.press('Enter');
  assert.equal(await picker.getAttribute('data-card-id'), '30062');
  assert.equal(await manual.locator('[data-lb]').inputValue(), '2', 'changing artwork preserves LB');
  assert.equal(JSON.parse(await page.locator('[data-json]').textContent())[30062], 2);
  await picker.click();
  await picker.press('ArrowUp');
  assert.equal(await page.locator('[role="option"]').last().getAttribute('aria-selected'), 'true', 'up wraps to the final result');
  assert.equal(await page.locator('[role="listbox"]').evaluate(list => {
    const active = list.querySelector('[aria-selected="true"]').getBoundingClientRect(), bounds = list.getBoundingClientRect();
    return active.top >= bounds.top && active.bottom <= bounds.bottom;
  }), true, 'keyboard selection scrolls into view');
  await picker.press('Tab');
  assert.equal(await picker.getAttribute('aria-expanded'), 'false', 'tab dismisses without choosing');
  assert.equal(await picker.getAttribute('data-card-id'), '30062');
  await picker.fill('laurel');
  await page.locator('[data-add]').click();
  assert.equal(await page.getByRole('listbox').count(), 1, 'only the new row has an open picker');
  assert.equal(await page.locator('[data-card]').first().inputValue(), '', 'new rows do not inherit search text');
  assert.equal(await page.locator('[data-card]').nth(1).getAttribute('data-card-id'), '30062');
  await newInventory();
  await scan('android');
  assert.equal(await page.locator('[data-row]').count(), 10);
  // Independently read from the Android example: SSR Special Week 1LB, event Special Week 4LB,
  // Suzuka 0LB, Winning Dream Suzuka 4LB, Teio 0LB, Maruzensky 4LB, Oguri 0LB, Gold Ship 3LB,
  // Daiwa Scarlet 3LB, Grass Wonder 2LB.
  const expected = [[30001,1],[30025,4],[30002,0],[30062,4],[30003,0],[30107,4],[30024,0],[30057,3],[30047,3],[30006,2]];
  const readings = await page.locator('[data-row]').evaluateAll(rows => rows.map(row => ({
    key: row.dataset.row, id: Number(row.querySelector('[data-card]').dataset.cardId), lb: Number(row.querySelector('[data-lb]').value),
  })));
  for (const [i, [id, lb]] of expected.entries()) {
    assert.equal(readings[i].lb, lb, `Android diamond count for ${id}`);
    assert.equal(readings[i].id, id, `Android artwork ${id}`);
  }
  for (const [i, [id]] of expected.entries()) await chooseCard(readings[i].key, id);
  await page.locator('[data-download]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-download]').isEnabled(), true);
  await scan('android');
  const added = await page.locator('[data-row]').evaluateAll(rows => rows.slice(10).map(row => row.dataset.row));
  for (const [i, [id]] of expected.entries()) await chooseCard(added[i], id);
  assert.match(await page.locator('[data-summary]').textContent(), /10 unique cards.*10 overlapping readings/);
  await page.locator(`[data-lb="${added[0]}"]`).selectOption('4');
  assert.equal(await page.locator('[data-download]').isEnabled(), false);
  assert.match(await page.locator('[data-row]').first().textContent(), /Different LB readings/);
  await page.locator(`[data-lb="${added[0]}"]`).selectOption('1');
  const downloadEvent = page.waitForEvent('download');
  await page.locator('[data-download]').click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'inventory.json');
  const exported = await importInventory(new File([await readFile(await download.path())], 'inventory.json'));
  for (const [id, lb] of expected) assert.equal(exported[id], lb);
  for (const card of loadData().cards) if (card.rarity === 'R') assert.equal(exported[card.id], 4);
  assert.equal(exported[20001], null);
  for (const theme of ['light', 'dark']) for (const width of [390, 768, 1280]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.setViewportSize({ width, height: 900 });
    const picker = page.locator('[data-card]').first();
    await picker.fill('special');
    assert.ok(await page.locator('[role="option"]').count() > 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${theme} ${width} overflow`);
    await picker.press('Escape');
  }
  await newInventory();
  for (const [covers, expectedCards] of [
    [[[130, 150, 470, 151]], expected.slice(0, 6)],
    [[[130, 0, 470, 301], [0, 150, 130, 151]], expected.slice(0, 1)],
    [[[130, 0, 470, 150]], [expected[0], ...expected.slice(5)]],
  ]) {
    await scanFile(await alteredScreenshot('android', { covers }));
    const cards = await page.locator('[data-row]').evaluateAll(rows => rows.map(row => [
      Number(row.querySelector('[data-card]').dataset.cardId), Number(row.querySelector('[data-lb]').value),
    ]));
    assert.deepEqual(cards, expectedCards, 'a complete lone card survives without adjacent cards');
    assert.equal(await page.locator('[data-confirm]').count(), 0, 'clear isolated artwork needs no confirmation');
    const exported = JSON.parse(await page.locator('[data-json]').textContent());
    for (const [id, lb] of expectedCards) assert.equal(exported[id], lb, `isolated artwork ${id} stays owned`);
    await newInventory();
  }
  await scanFile(await alteredScreenshot('android', { covers: [[130, 0, 470, 301], [0, 35, 130, 266]] }), /No complete card badges found/);
  assert.equal(await page.locator('[data-row]').count(), 0, 'a lone badge without matching artwork is not a card');
  await newInventory();
  await scan('iphone');
  assert.equal(await page.locator('[data-row]').count(), 10);
  const iphone = await page.locator('[data-row]').evaluateAll(rows => rows.map(row => ({ id: Number(row.querySelector('[data-card]').dataset.cardId), lb: Number(row.querySelector('[data-lb]').value) })));
  assert.deepEqual(iphone.map(r => r.lb), [3,4,0,4,2,3,0,1,4,3]);
  assert.equal(iphone[7].id, 30004);
  assert.equal(iphone[9].id, 30022);
  // A fresh batch must not retain the first person's Gold Ship variant.
  assert.equal(iphone.some(r => r.id === 30057), false);
  await newInventory();
  await scan('sr-and-r');
  assert.equal(await page.locator('[data-row]').count(), 1, 'R artwork never becomes an SR/SSR reading');
  assert.equal(await page.locator('[data-card]').getAttribute('data-card-id'), '20021');
  assert.equal(await page.locator('[data-lb]').inputValue(), '4', 'level-35 SR Aoi still has four diamonds');
  await page.locator('[data-exclude]').click();
  assert.equal(await page.locator('[data-download]').isEnabled(), true, 'an inventory containing only default R cards is usable');
  const rareOnly = JSON.parse(await page.locator('[data-json]').textContent());
  assert.equal(rareOnly[20021], null);
  for (const card of loadData().cards) if (card.rarity === 'R') assert.equal(rareOnly[card.id], 4);
  await newInventory();
  // Move two SR cards into the SR/R boundary row, leaving three SR and two R badges side by side.
  await scanFile(await alteredScreenshot('inventory-b-4440', { copies: [[130, 410, 230, 150, 130, 563]] }));
  assert.equal(await page.locator('[data-row]').count(), 14, 'R cards beside three SR cards stay R');
  assert.match(await page.locator('.scan-sources figcaption').textContent(), /18 R cards ignored/);
  // User-labeled failures from a second inventory: clear artwork should not need confirmation.
  // The screenshots retain the obstructing game toolbar; only visible cards are expected here.
  const examples = [
    ['inventory-b-4436', [[3, 30062, 4], [12, 30106, 0]]],
    ['inventory-b-4437', [[14, 30054, 0]]],
    ['inventory-b-4438', [[11, 30125, 0], [13, 30145, 2]]],
    ['inventory-b-4439', [[5, 20006, 4]]],
    ['inventory-b-4440', [[-1, 20021, 4]]],
  ];
  await newInventory();
  for (const [name, expected] of examples) {
    const offset = await page.locator('[data-row]').count();
    await scan(name);
    for (const [index, id, lb] of expected) {
      const row = page.locator('[data-row]').nth(index < 0 ? index : offset + index);
      assert.equal(await row.locator('[data-card]').getAttribute('data-card-id'), String(id), `${name} artwork ${id}`);
      assert.equal(await row.locator('[data-lb]').inputValue(), String(lb), `${name} diamonds ${id}`);
      assert.equal(await row.locator('[data-confirm]').count(), 0, `${name} clear artwork ${id} needs no confirmation`);
    }
  }
  // Reuse the worker with a smaller, slightly shifted grid after the original-size batch.
  const offset = await page.locator('[data-row]').count();
  await scanFile(await alteredScreenshot('inventory-b-4436', { width: 480, dx: 2, dy: 3 }));
  for (const [index, id, lb] of [[3, 30062, 4], [12, 30106, 0]]) {
    const row = page.locator('[data-row]').nth(offset + index);
    assert.equal(await row.locator('[data-card]').getAttribute('data-card-id'), String(id), `shifted grid artwork ${id}`);
    assert.equal(await row.locator('[data-lb]').inputValue(), String(lb), `shifted grid diamonds ${id}`);
    assert.equal(await row.locator('[data-confirm]').count(), 0, `shifted grid confidence ${id}`);
  }
  await newInventory();
  await scanFile(await alteredScreenshot('inventory-b-4438', { covers: [[140, 504, 98, 87]] }));
  assert.equal(await page.locator('[data-row]').nth(11).locator('[data-confirm]').count(), 1, 'covered artwork still requires review');
  const covered = page.locator('[data-row]').nth(11), coveredPicker = covered.locator('[data-card]');
  const originalId = await coveredPicker.getAttribute('data-card-id');
  await coveredPicker.fill('laurel');
  await coveredPicker.press('Escape');
  assert.equal(await coveredPicker.getAttribute('data-card-id'), originalId);
  assert.equal(await covered.locator('[data-confirm]').count(), 1, 'canceling a search does not confirm an uncertain match');
  await chooseCard(await covered.getAttribute('data-row'), 30125);
  assert.equal(await covered.locator('[data-confirm]').count(), 0, 'choosing a search result confirms the correction');
  assert.deepEqual(uploads, []);
  assert.ok(referenceRequests.some(url => url.includes('/scanner/') && url.endsWith('.webp')), 'use compact generated references');
  assert.equal(referenceRequests.some(url => url.includes('/full/') || url.includes('/raw/')), false, 'original artwork stays out of the browser');
  assert.deepEqual(errors, []);
  console.log('Scanner: screenshot recognition, review, overlap/conflicts, export/import, new inventory, both phone sizes and themes passed.');
} finally { await browser.close(); }
