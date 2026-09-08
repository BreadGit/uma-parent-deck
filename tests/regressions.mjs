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
  assert.deepEqual(saved.run.parentSparks, [[null, null, null], [null, null, null]]);
  assert.deepEqual(saved.run.pinnedIds, [30052]);
  assert.equal(saved.settings.focus, 'sprint');
  assert.equal(saved.inventory['30028'], 2);
});

test('ranking pins persist and an unowned pin requests a borrowed card', async (t) => {
  const saved = defaultState(data);
  saved.inventory['30028'] = null;
  saved.settings.showUnowned = true;
  const page = await fresh(t, saved);
  const button = page.locator('button[data-action="toggle-card-pin"][data-id="30028"]');
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  assert.ok((await state(page)).run.pinnedIds.includes(30028));
  assert.match(await page.locator('.pin-list .pin-row').filter({ hasText: 'Kitasan Black' }).innerText(), /borrow/);
  assert.match(await page.locator('.deck .slot').filter({ hasText: 'Kitasan Black' }).innerText(), /borrow/);
  await page.reload();
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  assert.ok(!(await state(page)).run.pinnedIds.includes(30028));
  await page.reload();
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
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
  assert.equal(await page.locator('[data-gain="0-1"]').inputValue(), '0', 'all three sparks are on Speed');
  await page.selectOption('[data-gain="0-0"]', '21');
  await page.selectOption('[data-gain="0-1"]', '12');
  await page.selectOption('[data-gain="0-2"]', '5');
  await page.selectOption('[data-gain="0-3"]', '5');
  assert.equal(await page.locator('[data-gain="0-2"]').inputValue(), '0', 'the 1★ Power uma is the weakest, so Guts took her');
  assert.equal(await page.locator('[data-gain="1-0"]').inputValue(), '0', 'parent 2 is untouched');
  assert.equal(await predictions(page).count(), 1);
  await page.reload();
  assert.deepEqual((await state(page)).run.parentSparks[0], [{ stat: 'speed', stars: 3 }, { stat: 'stamina', stars: 2 }, { stat: 'guts', stars: 1 }]);
});

test('saved spark ownership survives gain edits and reload; malformed aptitudes fall back to the trainee', async (t) => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  saved.run.parentSparks[0] = [{ stat: 'speed', stars: 1 }, { stat: 'speed', stars: 3 }, { stat: 'power', stars: 2 }];
  saved.run.aptOverrides = { turf: 'Z', dirt: 'B', luck: 'A' };
  const page = await fresh(t, saved);
  assert.equal(await page.inputValue('[data-apt="turf"]'), data.charByCardId.get(100101).aptitudes.turf);
  assert.equal(await page.inputValue('[data-apt="dirt"]'), 'B');
  await page.selectOption('[data-gain="0-0"]', '17');
  await page.reload();
  await page.waitForSelector('[data-gain]');
  assert.deepEqual((await state(page)).run.parentSparks, [[{ stat: 'speed', stars: 1 }, { stat: 'speed', stars: 2 }, { stat: 'power', stars: 2 }], [null, null, null]]);
  assert.deepEqual((await state(page)).run.aptOverrides, { dirt: 'B' });
  await page.click('[data-action="toggle-sparks"]');
  assert.deepEqual(await page.$$eval('.side.p1 select', (els) => els.map((s) => s.value)), ['speed', '1', 'speed', '2', 'power', '2']);
});

test('a malformed saved side becomes the default side without a warning, and the other side is kept', async (t) => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  saved.run.parentSparks = [[{ stat: 'speed', stars: 3 }, { stat: 'speed', stars: 3 }, { stat: 'luck', stars: 3 }], [{ stat: 'wit', stars: 3 }, { stat: 'wit', stars: 3 }, { stat: 'wit', stars: 3 }]];
  const page = await fresh(t, saved);
  assert.equal(await page.locator('[data-plan-issues]').count(), 0);
  assert.equal(await predictions(page).count(), 1);
  assert.deepEqual(await page.$$eval('[data-gain]', (els) => els.map((e) => e.value)), ['0', '0', '0', '0', '0', '0', '0', '0', '0', '63'], 'side 1 is empty, side 2 keeps its three 3★ Wit');
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

test('white target chips migrate old goals and support zero or many required sparks', async (t) => {
  const saved = defaultState(data);
  saved.version = 7;
  saved.run.traineeCardId = 100101;
  saved.run.targets = [200012];
  saved.run.goal = { ...saved.run.goal, enabled: true, pink: 'end', required: [{ id: null, stars: 2 }, { id: 200352, stars: 3 }], preferred: [201601, 200472] };
  saved.run.aptOverrides.end = 'B';
  saved.run.pinkLineage = Array.from({ length: 6 }, () => ({ aptitude: 'end', stars: 3 }));
  const page = await fresh(t, saved);
  const before = await page.locator('.deck').innerText();
  assert.equal(await page.locator('[data-required-count]').innerText(), '1 required');
  assert.equal(await page.locator('[data-action="select-target"]').count(), 4);
  assert.equal(await page.locator('[data-goal-required]').count(), 0);
  for (const id of [200012, 201601, 200472]) {
    await page.click(`[data-action="select-target"][data-id="${id}"]`);
    await page.click(`[data-target-role="required"][data-id="${id}"]`);
  }
  assert.equal(await page.locator('[data-required-count]').innerText(), '4 required');
  assert.equal(await page.locator('.deck').innerText(), before, 'roles do not change deck ranking');
  assert.equal(await page.locator('[data-goal-issues]').count(), 0);
  await page.reload();
  await page.waitForSelector('[data-required-count]');
  assert.equal(await page.locator('[data-required-count]').innerText(), '4 required');
  await page.click('[data-action="select-target"][data-id="200352"]');
  assert.equal(await page.inputValue('[data-target-stars="200352"]'), '3');
  await page.click('[data-action="select-target"][data-id="200352"]');
  for (const id of [200012, 200352, 201601, 200472]) {
    await page.click(`[data-action="select-target"][data-id="${id}"]`);
    await page.click(`[data-target-role="preferred"][data-id="${id}"]`);
  }
  assert.deepEqual((await state(page)).run.goal.required, []);
  assert.equal(await page.locator('[data-goal-issues]').count(), 0);
  assert.equal(await page.locator('[data-goal-zero]').count(), 0);
  assert.match(await page.locator('[data-goal-result]').innerText(), /No required white sparks/);
  const probability = await page.locator('[data-goal-probability]').innerText();
  await page.reload();
  await page.waitForSelector('[data-goal-result]');
  assert.equal(await page.locator('[data-goal-probability]').innerText(), probability);
  await page.selectOption('[data-apt="end"]', 'C');
  assert.match(await page.locator('[data-goal-issues]').innerText(), /starts below B/);
  assert.equal(await page.locator('[data-goal-zero]').count(), 0);
});

test('chip selection toggles its editor and removal updates goals without activating another chip', async (t) => {
  const page = await fresh(t);
  await target(page, 'Groundwork');
  assert.equal(await page.locator('[data-target-editor]').getAttribute('data-target-editor'), '201601');
  await page.click('[data-target-role="required"]');
  await page.selectOption('[data-target-stars="201601"]', '3');
  await page.selectOption('[data-lineage-k="201601"][data-side="k1"]', '2');
  await page.selectOption('[data-lineage-p="201601"][data-side="p1"]', '4');
  assert.equal(await page.locator('[data-target-editor] h3').first().innerText(), 'Goals for target white spark');
  assert.match(await page.locator('[data-target-editor] h3').last().innerText(), /^White sparks in lineage/);
  assert.equal(await page.locator('[data-target-editor] [data-action="remove-target"]').count(), 0);
  await target(page, 'Lucky Seven');
  await page.click('[data-action="select-target"][data-id="201601"]');
  assert.equal(await page.inputValue('[data-target-stars="201601"]'), '3');
  assert.equal(await page.inputValue('[data-lineage-p="201601"][data-side="p1"]'), '4');
  await page.locator('[data-action="select-target"][data-id="201601"]').press('Enter');
  assert.equal(await page.locator('[data-target-editor]').count(), 0);
  await page.locator('[data-action="select-target"][data-id="201601"]').press('Enter');
  assert.equal(await page.locator('[data-target-editor]').count(), 1);
  await page.click('[data-action="remove-target"][data-id="201562"]');
  assert.equal(await page.locator('[data-target-editor]').getAttribute('data-target-editor'), '201601');
  assert.deepEqual((await state(page)).run.goal.preferred, []);
  await page.click('[data-action="remove-target"][data-id="201601"]');
  assert.equal(await page.locator('[data-target-editor]').count(), 0);
  const after = await state(page);
  assert.deepEqual(after.run.targets, []);
  assert.deepEqual(after.run.goal.required, []);
  assert.deepEqual(after.run.targetLineage, {});
  await page.reload();
  await page.waitForSelector('#target-search');
  assert.equal(await page.locator('[data-action="select-target"]').count(), 0);
});
