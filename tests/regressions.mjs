// Browser regressions use fresh storage and the same controls a player uses. They also run against a production build.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { chromium } from 'playwright';
import { loadData } from '../src/data.ts';
import { defaultState, STATE_KEY } from '../src/state.ts';
import { defaultParentSparks } from '../src/model/inherit.ts';

const data = loadData();
const browser = await chromium.launch();
const url = process.env.URL ?? 'http://localhost:5173/';
after(() => browser.close());

async function fresh(t, saved) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close());
  if (saved) await context.addInitScript(({ key, saved }) => {
    if (!localStorage.getItem('regression-seeded')) {
      localStorage.setItem(key, JSON.stringify(saved));
      localStorage.setItem('regression-seeded', '1');
    }
  }, { key: STATE_KEY, saved });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (e) => { if (e.type() === 'error') errors.push(e.text()); });
  t.after(() => assert.deepEqual(errors, [], 'browser errors'));
  await page.goto(url);
  await page.waitForSelector('#target-search');
  return page;
}
const state = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
async function pick(page, selector, query, action) {
  await page.fill(selector, query);
  await page.locator(`[data-action="${action}"]`).first().click();
}
const trainee = (page, query = 'special dreamer') => pick(page, '#trainee-search', query, 'pick-trainee');
const target = (page, query) => pick(page, '#target-search', query, 'add-target');
const pin = (page, query) => pick(page, '#card-search', query, 'pin-card');
const coverage = (page, skill) => page.locator('table').filter({ has: page.locator('th', { hasText: 'Gold hint' }) }).locator('tbody tr').filter({ has: page.locator('td:first-child', { hasText: skill }) });
const inventoryFile = (inventory) => ({ name: 'inventory.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(inventory)) });
const noCards = () => Object.fromEntries(data.cards.map((c) => [c.id, null]));
const predictions = (page) => page.locator('h3', { hasText: 'Predicted run' });

test('the first reset clears targets, trainee, pins and inheritance while preserving settings and inventory', async (t) => {
  const page = await fresh(t);
  await target(page, 'Groundwork');
  await trainee(page);
  await pin(page, 'fire at my heels');
  await page.selectOption('[data-gain="0-0"]', '63');
  await page.selectOption('[data-setting="focus"]', 'sprint');
  await page.setInputFiles('#import-file', inventoryFile({ 30028: 2 }));
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).inventory['30028'] === 2, STATE_KEY);
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('[data-action="reset-all"]');
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).run.traineeCardId === null, STATE_KEY);
  assert.equal(await page.locator('.target-row').count(), 0);
  const saved = await state(page);
  assert.deepEqual(saved.run.targets, []);
  assert.deepEqual(saved.run.parentSparks, [defaultParentSparks(), defaultParentSparks()]);
  assert.deepEqual(saved.run.pinnedIds, [30052]);
  assert.equal(saved.settings.focus, 'sprint');
  assert.equal(saved.inventory['30028'], 2);
});

test('SSR event-rate edits update gold coverage immediately and survive reload unchanged', async (t) => {
  const page = await fresh(t);
  await target(page, 'Corner Recovery');
  await pin(page, 'piece of mind');
  await page.click('[data-details="advanced"] > summary');
  const gold = coverage(page, 'Corner Recovery').locator('td').nth(1);
  assert.notEqual(await gold.innerText(), '100%');
  await page.fill('[data-setting-list="chainRatesSSR"]', '1,1,1');
  await page.locator('[data-setting-list="chainRatesSSR"]').press('Tab');
  assert.equal(await gold.innerText(), '100%');
  assert.equal(await coverage(page, 'Corner Recovery').locator('td').nth(3).innerText(), '40%');
  const before = await coverage(page, 'Corner Recovery').innerText();
  await page.reload();
  assert.equal(await coverage(page, 'Corner Recovery').innerText(), before);
});

test('Narita Brian displays one race per occupied slot and counts each goal once', async (t) => {
  const page = await fresh(t);
  await trainee(page, 'narita brian maverick');
  const heading = await page.locator('h2', { hasText: 'G1 agenda' }).innerText();
  assert.match(heading, /18 races.*11 career goals/);
  assert.equal(await page.locator('.agenda-cell.sel').count(), 18);
  assert.equal(Number(heading.match(/\((\d+) races/)[1]), await page.locator('.agenda-cell.sel').count());
});

test('skill advice includes prerequisite costs and buyable circle upgrades', async (t) => {
  const page = await fresh(t);
  await trainee(page);
  await target(page, 'Swinging Maestro');
  assert.match(await page.locator('div.small').filter({ hasText: /^Worst-case target SP cost:/ }).innerText(), /340 of/);
  await page.click('[data-action="remove-target"]');
  await target(page, 'Right-Handed');
  const row = coverage(page, 'Right-Handed');
  const hint = Number((await row.locator('td').nth(2).innerText()).replace('%', ''));
  const spark = Number((await row.locator('td').nth(3).innerText()).replace('%', ''));
  assert.ok(Math.abs(spark - hint * 0.25) <= 1, `${spark}% must use the circle rate on ${hint}% hint availability`);
  assert.match(await page.locator('div.small').filter({ hasText: /^Worst-case target SP cost:/ }).innerText(), /200 of/);
  assert.equal(await page.locator('.wishlist').getByText('Right-Handed ◎', { exact: true }).count(), 0);
});

test('the borrow description uses its marginal gain in the completed deck', async (t) => {
  const page = await fresh(t);
  await trainee(page);
  for (const skill of ['Corner Recovery', 'Groundwork', 'Pace Strategy']) await target(page, skill);
  const advice = await page.locator('.small.gap-top').filter({ hasText: /^Borrow:/ }).innerText();
  assert.match(advice, /Smart Falcon/);
  assert.match(advice, /\+4\.9% expected sparks/);
});

test('inherited Corner Recovery and Lucky Seven hints do not gain fictitious circle upgrades', async (t) => {
  const saved = defaultState(data);
  saved.run.targets = [200352, 201562, 200012, 201032];
  saved.run.targetLineage = Object.fromEntries(saved.run.targets.map((id) => [id, { k1: 1, p1: 3, k2: 0, p2: 0 }]));
  // Isolate inherited hints while still building a complete deck through the regular UI.
  Object.assign(saved.settings, { hintBase: 0, chainRatesSSR: [0, 0, 0], chainRatesSR: [0, 0], randomEventRate: 0,
    palChainRate: 0, groupOutingRate: 0, groupFinaleRate: 0, specialEventRate: 0 });
  const page = await fresh(t, saved);
  for (const [name, spark] of [['Corner Recovery', '9%'], ['Lucky Seven', '9%'], ['Right-Handed', '11%'], ['Mile Straightaways', '11%']]) {
    const row = coverage(page, name);
    assert.equal(await row.locator('td').nth(1).innerText(), '0%');
    assert.equal(await row.locator('td').nth(2).innerText(), '40%');
    assert.equal(await row.locator('td').nth(3).innerText(), spark, name);
    assert.match(await row.locator('td').nth(4).innerText(), /Lineage/);
  }
  assert.match(await page.locator('div.small').filter({ hasText: /^Worst-case target SP cost:/ }).innerText(), /690 of/);
  assert.equal(await predictions(page).count(), 1);
});

test('start gains share a side\'s three umas: a bigger gain takes the weakest umas from the other stats, and the sparks persist', async (t) => {
  const page = await fresh(t);
  await trainee(page);
  await page.selectOption('[data-gain="0-0"]', '63');
  assert.equal(await page.locator('[data-gain="0-1"]').inputValue(), '0', 'the default 1★ Stamina went to the third Speed spark');
  await page.selectOption('[data-gain="0-0"]', '21');
  await page.selectOption('[data-gain="0-1"]', '12');
  await page.selectOption('[data-gain="0-2"]', '5');
  await page.selectOption('[data-gain="0-3"]', '5');
  assert.equal(await page.locator('[data-gain="0-2"]').inputValue(), '0', 'the 1★ Power uma is the weakest, so Guts took her');
  assert.equal(await page.locator('[data-gain="1-0"]').inputValue(), '5', 'parent 2 is untouched');
  assert.equal(await predictions(page).count(), 1);
  await page.reload();
  assert.deepEqual((await state(page)).run.parentSparks[0], [{ stat: 'speed', stars: 3 }, { stat: 'stamina', stars: 2 }, { stat: 'guts', stars: 1 }]);
});

test('a malformed saved side becomes the default side without a warning, and the other side is kept', async (t) => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  saved.run.parentSparks = [[{ stat: 'speed', stars: 3 }, { stat: 'speed', stars: 3 }, { stat: 'luck', stars: 3 }], [{ stat: 'wit', stars: 3 }, { stat: 'wit', stars: 3 }, { stat: 'wit', stars: 3 }]];
  const page = await fresh(t, saved);
  assert.equal(await page.locator('[data-plan-issues]').count(), 0);
  assert.equal(await predictions(page).count(), 1);
  assert.deepEqual(await page.$$eval('[data-gain]', (els) => els.map((e) => e.value)), ['5', '0', '5', '0', '5', '0', '0', '0', '0', '63'], 'side 1 shows the default sparks, side 2 its three 3★ Wit');
  await page.selectOption('[data-gain="1-3"]', '5');
  assert.deepEqual((await state(page)).run.parentSparks, [defaultParentSparks(), [{ stat: 'wit', stars: 3 }, { stat: 'wit', stars: 3 }, { stat: 'guts', stars: 1 }]], 'the next edit saves the repaired side 1 along with the change on side 2');
});

test('invalid inventory imports preserve inventory, while valid export and import round-trip', async (t) => {
  const page = await fresh(t);
  await page.setInputFiles('#import-file', inventoryFile({ 30052: null, 30028: 2, 20009: 0 }));
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).inventory['30052'] === null, STATE_KEY);
  const before = (await state(page)).inventory;
  for (const value of [{ garbage: 'data' }, [], { 30052: 4, 30028: 7 }]) {
    const dialog = page.waitForEvent('dialog');
    const upload = page.setInputFiles('#import-file', inventoryFile(value));
    const alert = await dialog;
    assert.match(alert.message(), /Import failed/);
    await alert.accept();
    await upload;
    assert.deepEqual((await state(page)).inventory, before);
  }
  const downloaded = page.waitForEvent('download');
  await page.click('[data-action="export"]');
  const download = await downloaded;
  let text = '';
  for await (const chunk of await download.createReadStream()) text += chunk;
  const inventory = JSON.parse(text);
  assert.equal(Object.keys(inventory).length, data.cards.length);
  for (const [id, lb] of Object.entries(before)) assert.equal(inventory[id], lb);
  await page.setInputFiles('#import-file', inventoryFile(inventory));
  await page.waitForFunction(({ key, n }) => Object.keys(JSON.parse(localStorage.getItem(key)).inventory).length === n, { key: STATE_KEY, n: data.cards.length });
  assert.deepEqual((await state(page)).inventory, inventory);
});

test('zero through four owned characters show an incomplete deck, and five restore predictions', async (t) => {
  const page = await fresh(t);
  await trainee(page);
  const cards = [30052, 30028, 30016, 30083, 20009];
  for (let n = 0; n <= 5; n++) {
    const inventory = noCards();
    cards.slice(0, n).forEach((id) => { inventory[id] = 4; });
    await page.setInputFiles('#import-file', inventoryFile(inventory));
    await page.waitForFunction(({ key, n }) => Object.values(JSON.parse(localStorage.getItem(key)).inventory).filter((v) => v !== null).length === n, { key: STATE_KEY, n });
    assert.equal(await predictions(page).count(), n === 5 ? 1 : 0);
    if (n < 5) assert.match(await page.locator('[data-plan-issues]').innerText(), /Incomplete deck/);
    else assert.equal(await page.locator('.deck .slot').count(), 6);
  }
});
