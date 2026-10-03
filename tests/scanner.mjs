import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { importInventory } from '../src/inventory.ts';
import { loadData } from '../src/data.ts';
import { STATE_KEY } from '../src/state.ts';
import { assertFieldsMatchState, assertServesThisTree } from './browser-fields.mjs';

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
/** Every card in the review by id: confident readings are tiles, the rest are cards under "Needs a decision". */
async function readings() {
  const tiles = await page.locator('[data-ready] [data-tile]').evaluateAll(els => els.map(e => [Number(e.dataset.cardId), { lb: Number(e.dataset.lb), confident: true }]));
  const decide = await page.locator('[data-decide] [data-row]').evaluateAll(els => els.map(e => {
    const picker = e.querySelector('[data-card]'), lb = e.querySelector('[data-lb]');
    return [Number(e.dataset.conflict ?? picker.dataset.cardId), { lb: lb && lb.value !== '' ? Number(lb.value) : null, confident: false, key: e.dataset.row }];
  }));
  return new Map([...tiles, ...decide]);
}
async function expectConfident(expected, label) {
  const read = await readings();
  for (const [id, lb] of expected) {
    assert.ok(read.has(id), `${label}: ${id} was read`);
    assert.equal(read.get(id).lb, lb, `${label}: diamonds for ${id}`);
    assert.equal(read.get(id).confident, true, `${label}: ${id} needs no confirmation`);
  }
  return read;
}
/** The JSON is built only while the preview is open, so open it before reading. */
async function previewJson() {
  const preview = page.locator('[data-preview]');
  if (!await preview.evaluate(details => details.open)) await preview.locator('summary').click();
  return JSON.parse(await page.locator('[data-json]').textContent());
}
async function newInventory() {
  await page.locator('[data-new]').click(); await page.locator('[data-dialog-confirm]').click();
  // The dialog's close event is queued; wait for reset before choosing the next file.
  await page.locator('[data-new]').waitFor({ state: 'detached' });
}
async function chooseCard(key, id) {
  const input = page.locator(`[data-card="${key}"]`);
  await input.fill(loadData().cards.find(card => card.id === id).name);
  await page.locator(`[role="option"][data-id="${id}"]`).click();
  // A row that becomes complete moves out of the decisions, so only check a row that is still there.
  if (await input.count()) assert.equal(await input.getAttribute('data-card-id'), String(id));
}
/** Expands a read card's editor, which opens in the grid right under its tile. */
async function openTile(id) {
  const tile = page.locator(`[data-tile="c${id}"]`);
  if (!await page.locator('[data-ready]').evaluate(details => details.open)) await page.locator('[data-ready] > summary').click();
  if (await tile.getAttribute('aria-pressed') !== 'true') await tile.click();
  assert.equal(await tile.evaluate(el => el.nextElementSibling?.matches('[data-row]')), true, 'the editor opens under the clicked tile');
  return tile.locator('xpath=following-sibling::*[1]');
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
const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
/** Every width the main smoke test checks, in both themes, chosen through the page's own theme control. */
const pickTheme = name => page.locator(`[data-theme-pick="${name}"]`).click();
async function assertNoOverflow(state, open = async () => {}, close = async () => {}, pick = pickTheme) {
  for (const name of ['light', 'dark']) {
    await pick(name);
    for (const width of [390, 768, 1280, 1440, 1680, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await open();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${state} ${name} ${width} overflow`);
      const sheet = page.locator('[data-scanner]');
      if (await sheet.count()) assert.equal(await sheet.evaluate(el => el.scrollWidth > el.clientWidth), false, `${state} ${name} ${width} sheet overflow`);
      await close();
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
// Independently read from the Android example: SSR Special Week 1LB, event Special Week 4LB,
// Suzuka 0LB, Winning Dream Suzuka 4LB, Teio 0LB, Maruzensky 4LB, Oguri 0LB, Gold Ship 3LB,
// Daiwa Scarlet 3LB, Grass Wonder 2LB.
const android = [[30001,1],[30025,4],[30002,0],[30062,4],[30003,0],[30107,4],[30024,0],[30057,3],[30047,3],[30006,2]];
try {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(new URL('scanner.html', base).href);
  await assertServesThisTree(base);
  assert.equal(await page.title(), 'Import using screenshots');
  assert.equal(await page.locator('.scan-planner-link').getAttribute('href'), './index.html');
  await page.locator('[data-theme-pick="dark"]').click();
  assert.equal(await theme(), 'dark');
  assert.equal(await page.locator('[data-theme-pick="dark"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-theme-pick="system"]').click();
  assert.equal(await theme(), 'light', 'Auto follows the system theme');
  await page.emulateMedia({ colorScheme: 'dark' });
  // The media query's change event arrives asynchronously.
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 5000 });
  await page.emulateMedia({ colorScheme: 'light' });
  await assertNoOverflow('empty');
  assert.equal(await page.locator('[data-download]').count(), 1, 'the download button lives in the action bar only');
  assert.equal(await page.locator('[data-download]').isEnabled(), false);
  assert.equal(await page.locator('[data-bar].scan-waiting').count(), 1, 'the bar is dimmed until it can be used');
  await page.locator('[data-add]').click();
  const manual = page.locator('[data-decide] [data-row]').first(), manualPicker = manual.locator('[data-card]');
  assert.equal(await manualPicker.evaluate(el => el === document.activeElement), true, 'manual cards focus the search');
  assert.equal(await manualPicker.getAttribute('role'), 'combobox');
  await manualPicker.press('Enter');
  assert.equal(await manualPicker.getAttribute('data-card-id'), '', 'Enter without a query or highlight chooses nothing');
  await manualPicker.press('Escape');
  await manual.locator('[data-lb]').selectOption('3');
  await manual.locator('[data-exclude]').click();
  await page.locator('[data-excluded] > summary').click();
  const excludedManual = page.locator('[data-excluded] [data-row]');
  assert.equal(await excludedManual.count(), 1, 'an excluded entry without a selected card keeps its editor');
  assert.equal(await excludedManual.locator('[data-lb]').inputValue(), '3', 'exclusion preserves the entered limit break');
  await excludedManual.locator('[data-exclude]').click();
  assert.equal(await manual.locator('[data-lb]').inputValue(), '3', 'restoring the entry preserves its limit break');
  await manual.locator('[data-lb]').selectOption('');
  await manualPicker.fill('special');
  await manualPicker.press('Enter');
  assert.equal(await manualPicker.getAttribute('data-card-id'), '', 'Enter does not guess among several matches');
  await manualPicker.fill('  SSR   LAUREL stop stamina ');
  assert.equal(await page.locator('[role="option"]').count(), 1, 'search combines name, title, rarity and type words');
  assert.equal(await page.locator('[role="option"]').getAttribute('data-id'), '30125');
  assert.equal(await manualPicker.getAttribute('data-card-id'), '', 'typing does not select a card');
  await manualPicker.press('Enter');
  assert.match(await manualPicker.inputValue(), /Sakura Laurel/);
  assert.equal(await manualPicker.getAttribute('data-card-id'), '30125');
  await manual.locator('[data-lb]').selectOption('2');
  assert.equal(await page.locator('[data-decide]').count(), 0, 'a manual card with a limit break is complete');
  assert.equal(await page.locator('[data-tile="c30125"]').getAttribute('data-lb'), '2');
  let editor = await openTile(30125);
  let picker = editor.locator('[data-card]');
  await picker.fill('no-such-card');
  assert.match(await page.locator('.scan-no-matches [role="status"]').textContent(), /No cards match/);
  await page.locator('.scan-no-matches').click();
  assert.equal(await picker.getAttribute('aria-expanded'), 'true', 'pressing the no-matches row keeps the list open');
  assert.equal(await picker.evaluate(el => el === document.activeElement), true, 'and keeps focus in the search');
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
  assert.equal(await page.locator('[data-tile="c30125"]').count(), 0, 'the reading now belongs to the chosen card');
  assert.equal(await page.locator('[data-tile="c30062"]').getAttribute('data-lb'), '2', 'changing artwork preserves LB');
  assert.equal((await previewJson())[30062], 2);
  editor = await openTile(30062);
  picker = editor.locator('[data-card]');
  await picker.click();
  await picker.press('ArrowUp');
  assert.equal(await page.locator('[role="option"]').last().getAttribute('aria-selected'), 'true', 'up wraps to the final result');
  assert.equal(await page.locator('[role="listbox"]').evaluate(list => {
    const active = list.querySelector('[aria-selected="true"]').getBoundingClientRect(), bounds = list.getBoundingClientRect();
    return active.top >= bounds.top && active.bottom <= bounds.bottom;
  }), true, 'keyboard selection scrolls into view');
  // Chrome focuses a scrolling list when its scrollbar is dragged; that focus stays inside the picker.
  await page.getByRole('listbox').evaluate(list => list.focus());
  assert.equal(await picker.getAttribute('aria-expanded'), 'true', 'focusing the result list keeps it open');
  await picker.focus();
  await picker.press('Tab');
  assert.equal(await picker.getAttribute('aria-expanded'), 'false', 'tab dismisses without choosing');
  assert.equal(await picker.getAttribute('data-card-id'), '30062');
  await picker.fill('laurel');
  await page.locator('[data-add]').click();
  assert.equal(await page.getByRole('listbox').count(), 1, 'only the new row has an open picker');
  assert.equal(await page.locator('[data-decide] [data-card]').first().inputValue(), '', 'new rows do not inherit search text');
  assert.equal(await page.locator('[data-tile="c30062"]').count(), 1);
  await newInventory();

  await scan('android');
  assert.equal((await expectConfident(android, 'Android')).size, 10);
  assert.equal(await page.locator('[data-decide]').count(), 0, 'clear readings need no decision');
  assert.match(await page.locator('[data-all-ready]').textContent(), /All 10 cards read with confidence/);
  assert.equal(await page.locator('[data-download]').isEnabled(), true);
  editor = await openTile(30001);
  await chooseCard(await editor.getAttribute('data-row'), 30001);
  await scan('android');
  assert.match(await page.locator('[data-summary]').textContent(), /10 unique cards · 0 to review · 10 duplicate readings from overlap/);
  assert.match(await (await openTile(30001)).textContent(), /Seen in 2 screenshots/, 'identical overlapping readings merge');
  // Grey out the fourth diamond of the event Special Week, so a third reading of it says 3LB instead of MLB.
  await scanFile(await alteredScreenshot('android', { covers: [[176, 121, 9, 12]] }));
  const conflict = page.locator('[data-conflict="30025"]');
  assert.equal(await conflict.count(), 1, 'screenshots that disagree become one decision');
  assert.equal(await conflict.locator('[data-use]').count(), 3, 'every reading of the card is offered');
  assert.equal(await page.locator('[data-download]').isEnabled(), false);
  assert.match(await page.locator('[data-bar-summary]').textContent(), /9 ready · 1 to decide/);
  await conflict.locator('[data-use]', { hasText: 'Use MLB' }).first().click();
  assert.equal(await page.locator('[data-conflict]').count(), 0, 'one tap settles the card');
  assert.equal(await page.locator('[data-download]').isEnabled(), true);
  const downloadEvent = page.waitForEvent('download');
  await page.locator('[data-download]').click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'inventory.json');
  const exported = await importInventory(new File([await readFile(await download.path())], 'inventory.json'));
  for (const [id, lb] of android) assert.equal(exported[id], lb);
  for (const card of loadData().cards) if (card.rarity === 'R') assert.equal(exported[card.id], 4);
  assert.equal(exported[20001], null);
  await page.locator('[data-add]').click();
  const firstPicker = page.locator('[data-decide] [data-card]').first();
  await assertNoOverflow('scanned', async () => {
    await firstPicker.fill('special');
    assert.ok(await page.locator('[role="option"]').count() > 0);
  }, () => firstPicker.press('Escape'));
  // An unseen card is added from its tile with just a limit break.
  await page.locator('[data-unseen] > summary').click();
  const unseenBefore = await page.locator('[data-tile^="u"]').count();
  await page.locator('[data-tile="u30125"]').click();
  assert.equal(await page.locator('[data-tile="u30125"]').evaluate(el => el.nextElementSibling?.matches('[data-add-card="30125"]')), true);
  await page.locator('[data-add-lb="30125"]').selectOption('1');
  assert.equal(await page.locator('[data-tile^="u"]').count(), unseenBefore - 1);
  assert.equal(await page.locator('[data-tile="c30125"]').getAttribute('data-lb'), '1', 'the added card is read at once');
  await newInventory();

  for (const [covers, expectedCards] of [
    [[[130, 150, 470, 151]], android.slice(0, 6)],
    [[[130, 0, 470, 301], [0, 150, 130, 151]], android.slice(0, 1)],
    [[[130, 0, 470, 150]], [android[0], ...android.slice(5)]],
  ]) {
    await scanFile(await alteredScreenshot('android', { covers }));
    const read = await expectConfident(expectedCards, 'isolated artwork');
    assert.equal(read.size, expectedCards.length, 'a complete lone card survives without adjacent cards');
    const exported = await previewJson();
    for (const [id, lb] of expectedCards) assert.equal(exported[id], lb, `isolated artwork ${id} stays owned`);
    await newInventory();
  }
  await scanFile(await alteredScreenshot('android', { covers: [[130, 0, 470, 301], [0, 35, 130, 266]] }), /No complete card badges found/);
  assert.equal((await readings()).size, 0, 'a lone badge without matching artwork is not a card');
  await newInventory();
  await scan('iphone');
  const iphone = await readings();
  assert.equal(iphone.size, 10);
  assert.deepEqual([...iphone.values()].map(r => r.lb).sort(), [3,4,0,4,2,3,0,1,4,3].sort());
  assert.equal(iphone.get(30004).lb, 1);
  assert.equal(iphone.get(30022).lb, 3);
  // A fresh batch must not retain the first person's Gold Ship variant.
  assert.equal(iphone.has(30057), false);
  await newInventory();
  await scan('sr-and-r');
  const srAndR = await expectConfident([[20021, 4]], 'level-35 SR Aoi still has four diamonds');
  assert.equal(srAndR.size, 1, 'R artwork never becomes an SR/SSR reading');
  await (await openTile(20021)).locator('[data-exclude]').click();
  assert.match(await page.locator('[data-summary]').textContent(), /1 excluded/);
  assert.equal(await page.locator('[data-excluded] [data-tile="r"]').count(), 0);
  assert.equal(await page.locator('[data-excluded] [data-tile]').count(), 1, 'excluded readings keep a tile of their own');
  assert.equal(await page.locator('[data-download]').isEnabled(), true, 'an inventory containing only default R cards is usable');
  const rareOnly = await previewJson();
  assert.equal(rareOnly[20021], null);
  for (const card of loadData().cards) if (card.rarity === 'R') assert.equal(rareOnly[card.id], 4);
  await newInventory();
  // Move two SR cards into the SR/R boundary row, leaving three SR and two R badges side by side.
  await scanFile(await alteredScreenshot('inventory-b-4440', { copies: [[130, 410, 230, 150, 130, 563]] }));
  assert.match(await page.locator('[data-batch]').textContent(), /14 readings · 18 R cards ignored/, 'R cards beside three SR cards stay R');
  // User-labeled failures from a second inventory: clear artwork should not need confirmation.
  // The screenshots retain the obstructing game toolbar; only visible cards are expected here.
  const examples = [
    ['inventory-b-4436', [[30062, 4], [30106, 0]]],
    ['inventory-b-4437', [[30054, 0]]],
    ['inventory-b-4438', [[30125, 0], [30145, 2]]],
    ['inventory-b-4439', [[20006, 4]]],
    ['inventory-b-4440', [[20021, 4]]],
  ];
  await newInventory();
  for (const [name, expected] of examples) {
    await scan(name);
    await expectConfident(expected, name);
  }
  // Reuse the worker with a smaller, slightly shifted grid after the original-size batch.
  await scanFile(await alteredScreenshot('inventory-b-4436', { width: 480, dx: 2, dy: 3 }));
  await expectConfident([[30062, 4], [30106, 0]], 'shifted grid');
  await newInventory();
  await scanFile(await alteredScreenshot('inventory-b-4438', { covers: [[140, 504, 98, 87]] }));
  const covered = page.locator('[data-decide] [data-row]');
  assert.equal(await covered.count(), 1, 'covered artwork still requires review');
  assert.equal(await covered.locator('[data-confirm]').count(), 1);
  const coveredPicker = covered.locator('[data-card]');
  const candidate = covered.locator('.scan-candidate').first();
  assert.ok(await candidate.getAttribute('aria-label'), 'suggested matches are named');
  assert.ok((await candidate.locator('span').textContent()).trim(), 'suggested matches show a caption');
  const originalId = await coveredPicker.getAttribute('data-card-id');
  await coveredPicker.fill('laurel');
  await coveredPicker.press('Escape');
  assert.equal(await coveredPicker.getAttribute('data-card-id'), originalId);
  assert.equal(await covered.locator('[data-confirm]').count(), 1, 'canceling a search does not confirm an uncertain match');
  await chooseCard(await covered.getAttribute('data-row'), 30125);
  assert.equal(await page.locator('[data-decide]').count(), 0, 'choosing a search result confirms the correction');
  assert.deepEqual(uploads, []);
  assert.ok(referenceRequests.some(url => url.includes('/scanner/') && url.endsWith('.webp')), 'use compact generated references');
  assert.equal(referenceRequests.some(url => url.includes('/full/') || url.includes('/raw/')), false, 'original artwork stays out of the browser');

  // Inside the planner the same flow ends in the saved inventory instead of a file.
  await page.goto(base);
  await page.waitForSelector('[data-action="open-scanner"]');
  const scannerModule = /\/(?:src\/scanner\/session\.ts|assets\/session-[^/]+\.js)(?:\?|$)/;
  await page.route(scannerModule, route => route.fulfill({ status: 503, body: 'Scanner unavailable' }));
  await page.locator('[data-action="open-scanner"]').click();
  await page.locator('[data-dialog-message]').waitFor();
  assert.match(await page.locator('[data-dialog-message]').textContent(), /Could not open screenshot import/);
  assert.equal(await page.locator('[data-action="open-scanner"]').isEnabled(), true, 'a failed module load releases the opener');
  assert.equal(await page.locator('[data-action="open-scanner"]').textContent(), 'Import using screenshots');
  assert.equal(await page.locator('[data-scanner]').count(), 0, 'a failed module load does not open a partial scanner');
  await page.locator('[data-dialog-confirm]').click();
  await page.unroute(scannerModule);
  await assertFieldsMatchState(page, 'after a failed scanner module load');
  await page.reload();
  await page.locator('[data-action="open-scanner"]').click();
  const sheet = page.locator('[data-scanner]');
  await sheet.locator('[data-files]').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'close-scanner', 'the sheet opens on its back button');
  assert.equal(await sheet.evaluate(el => el.matches(':modal')), true, 'the scanner uses native modal behavior');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await sheet.evaluate(el => el.contains(document.activeElement)), true, 'backward tabbing stays inside the scanner');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'close-scanner', 'forward tabbing wraps to the back button');
  await page.locator('#trainee-search').evaluate(el => el.focus());
  assert.equal(await sheet.evaluate(el => el.contains(document.activeElement)), true, 'background planner fields cannot take focus');
  await sheet.locator('[data-add]').click();
  await sheet.locator('[data-card]').press('Escape');
  assert.equal(await sheet.count(), 1, 'Escape dismisses the card picker before closing the scanner');
  await sheet.locator('[data-new]').click();
  await page.locator('[data-dialog-cancel]').click();
  assert.equal(await sheet.evaluate(el => el.matches(':modal')), true, 'canceling a nested confirmation returns to the scanner');
  await sheet.locator('[data-new]').click();
  await page.locator('[data-dialog-confirm]').click();
  await sheet.locator('[data-new]').waitFor({ state: 'detached' });
  await sheet.locator('[data-action="close-scanner"]').focus();
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'open-scanner', 'closing returns focus to the opener');
  await assertFieldsMatchState(page, 'after closing the scanner modal');
  await page.locator('[data-action="open-scanner"]').click();
  await page.mouse.click(8, 8);
  await sheet.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'open-scanner', 'clicking the backdrop returns to the opener');
  // The system back gesture and the close watcher close the sheet without a cancelable cancel event.
  await page.locator('[data-action="open-scanner"]').click();
  await sheet.evaluate(el => el.close());
  await sheet.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.body.classList.contains('scanner-open')), false, 'a browser close releases the page scroll');
  await page.locator('[data-action="open-scanner"]').click();
  await scan('android');
  assert.equal(await page.locator('[data-apply]').count(), 1, 'the apply button lives in the action bar only');
  assert.match(await page.locator('[data-change-summary]').textContent(), /\d+ marked not owned · 7 limit breaks changed/, 'replace marks unseen cards not owned');
  await page.locator('[data-mode="update"]').check();
  assert.match(await page.locator('[data-change-summary]').textContent(), /^0 newly owned · 0 marked not owned · 7 limit breaks changed/);
  // The planner's theme control is behind the sheet; set the theme the way it would.
  await assertNoOverflow('sheet', undefined, undefined, name => page.evaluate(n => { document.documentElement.dataset.theme = n; }, name));
  await page.locator('[data-apply]').click();
  await sheet.waitFor({ state: 'detached' });
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).inventory, STATE_KEY);
  for (const [id, lb] of android) assert.equal(saved[id], lb, `applied ${id}`);
  assert.equal(Object.keys(saved).length, 10, 'update mode leaves other cards alone');
  await assertFieldsMatchState(page, 'after updating inventory from the scanner');
  await page.locator('[data-action="open-scanner"]').click();
  assert.match(await sheet.locator('[data-bar-summary]').textContent(), /10 ready/, 'reopening keeps the session');
  await sheet.locator('[data-mode="replace"]').check();
  await sheet.locator('[data-apply]').click();
  await sheet.waitFor({ state: 'detached' });
  const replaced = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).inventory, STATE_KEY);
  assert.equal(replaced[20001], null, 'replace mode marks unseen SR cards not owned');
  assert.equal(replaced[30001], 1);
  await assertFieldsMatchState(page, 'after replacing inventory from the scanner');
  assert.deepEqual(errors, []);
  console.log('Scanner: screenshot recognition, decision-first review, overlap/conflicts, unseen cards, export/import, new inventory, both phone sizes, theme control, the planner sheet and overflow at six widths in both themes passed.');
} finally { await browser.close(); }
