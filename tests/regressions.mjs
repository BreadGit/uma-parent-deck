// Browser regressions use fresh storage and the same controls a player uses. They also run against a production build.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, after } from 'node:test';
import { chromium } from 'playwright';
import { loadData } from '../src/data.ts';
import { defaultState, STATE_KEY } from '../src/state.ts';
import { assertFieldsMatchState, settlePlanActions, waitForPlan } from './browser-fields.mjs';
import { defaultParentSparks } from '../src/model/inherit.ts';

const data = loadData();
const browser = await chromium.launch();
const url = process.env.URL ?? 'http://localhost:5173/';
after(() => browser.close());

async function fresh(t, saved, settle = true) {
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
  if (settle) { await waitForPlan(page); settlePlanActions(page); }
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

test('search stays responsive, ignores obsolete results, and persists the tie setting', async (t) => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  const page = await fresh(t, saved, false);
  assert.equal(await page.locator('[data-plan-pending]').count(), 1);
  assert.equal(await page.locator('[data-goal-result]').count(), 0, 'old recommendations are hidden during search');
  await page.locator('[data-goal-stars="blue"]').selectOption('3');
  await page.locator('[data-goal-stars="pink"]').selectOption('3');
  assert.equal(await page.inputValue('[data-goal-stars="pink"]'), '3', 'inputs respond during search');
  await page.locator('[data-details="advanced"] > summary').click();
  await page.fill('[data-setting="goalTieTolerance"]', '0');
  await page.locator('[data-setting="goalTieTolerance"]').press('Tab');
  await waitForPlan(page);
  // Any 3-star blue is at most 10%, and Any 3-star pink is 10%. The final result must use both latest edits.
  const probability = (await page.locator('[data-goal-probability]').innerText()).split('\n')[0];
  assert.ok(parseFloat(probability) <= 1);
  assert.equal((await state(page)).settings.goalTieTolerance, 0);
  await assertFieldsMatchState(page, 'after replacing an active search');
  await page.reload();
  await waitForPlan(page);
  assert.equal((await page.locator('[data-goal-probability]').innerText()).split('\n')[0], probability);
  await page.locator('[data-details="advanced"] > summary').click();
  assert.equal(await page.inputValue('[data-setting="goalTieTolerance"]'), '0');
  await assertFieldsMatchState(page, 'after reloading the search preference');
});

test('required skill priority is visible and the export follows the displayed order and exclusions', async (t) => {
  const saved = defaultState(data);
  const focus = data.skills.find((s) => s.name === 'Focus');
  const falcon = data.cards.find((c) => c.charName === 'Smart Falcon' && c.rarity === 'SSR' && c.type === 'power');
  saved.run.traineeCardId = 100101;
  saved.run.pinnedIds.push(falcon.id);
  saved.run.targets = [{ id: 201601, role: 'required', stars: 2 }, { id: focus.id, role: 'preferred', stars: 2 }];
  saved.run.wishlistOrder = [focus.id, 201601];
  const page = await fresh(t, saved);
  assert.equal(await page.locator('.wishlist li').first().getAttribute('data-wl-key'), '201601');
  assert.match(await page.locator('.wishlist li').first().innerText(), /required/);
  assert.deepEqual((await state(page)).run.wishlistOrder, saved.run.wishlistOrder);
  const exported = page.waitForEvent('download');
  await page.click('[data-action="wl-export"]');
  const download = await exported;
  assert.equal(download.suggestedFilename(), 'prioritized-skills.txt');
  const lines = (await readFile(await download.path(), 'utf8')).trim().split('\n');
  assert.equal(lines[0], 'Groundwork');
  assert.equal(lines.length, await page.locator('.wishlist li').count());
  await page.click('[data-action="wl-exclude"][data-id="201601"]');
  assert.match(await page.locator('[data-priority-conflict]').innerText(), /Groundwork is required but excluded/);
  assert.equal(await page.locator('.wishlist [data-wl-key="201601"]').count(), 0);
  const secondExport = page.waitForEvent('download');
  await page.click('[data-action="wl-export"]');
  assert.ok(!(await readFile(await (await secondExport).path(), 'utf8')).split('\n').includes('Groundwork'));
  await assertFieldsMatchState(page, 'after exporting the excluded required skill list');
});

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
  await pin(page, 'piece of mind');
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

test('the borrow description reports complete-deck goal chance', async (t) => {
  const page = await fresh(t);
  await trainee(page);
  for (const skill of ['Corner Recovery', 'Groundwork', 'Pace Strategy']) await target(page, skill);
  const advice = await page.locator('.small.gap-top').filter({ hasText: /^Borrow:/ }).innerText();
  const chance = (await page.locator('[data-goal-probability]').innerText()).split('\n')[0];
  assert.ok(advice.includes(`${chance} for every requirement`));
  assert.doesNotMatch(advice, /expected sparks|best stat stick/);
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
  saved.run.goal = { ...saved.run.goal, pink: 'end', required: [{ id: null, stars: 2 }, { id: 200352, stars: 3 }], preferred: [201601, 200472] };
  saved.run.aptOverrides.end = 'B';
  saved.run.pinkLineage = Array.from({ length: 6 }, () => ({ aptitude: 'end', stars: 3 }));
  const page = await fresh(t, saved);
  assert.equal(await page.locator('[data-required-count]').innerText(), '1 required');
  assert.equal(await page.locator('[data-action="select-target"]').count(), 4);
  assert.equal(await page.locator('[data-goal-required]').count(), 0);
  for (const id of [200012, 201601, 200472]) {
    await page.click(`[data-action="select-target"][data-id="${id}"]`);
    await page.click(`[data-target-role="required"][data-id="${id}"]`);
  }
  assert.equal(await page.locator('[data-required-count]').innerText(), '4 required');
  assert.equal(await page.locator('.deck .slot').count(), 6);
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
  assert.deepEqual((await state(page)).run.targets.filter((t) => t.role === 'required'), []);
  assert.equal(await page.locator('[data-goal-issues]').count(), 0);
  assert.equal(await page.locator('[data-goal-zero]').count(), 0);
  assert.match(await page.locator('[data-goal-result]').innerText(), /No required white sparks/);
  const probability = await page.locator('[data-goal-probability]').innerText();
  await page.reload();
  await page.waitForSelector('[data-goal-result]');
  assert.equal(await page.locator('[data-goal-probability]').innerText(), probability);
  await page.selectOption('[data-apt="end"]', 'C');
  assert.equal(await page.locator('[data-goal-warnings]').count(), 0);
  assert.match(await page.locator('[data-goal-probability]').innerText(), /%/);
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
  assert.deepEqual((await state(page)).run.targets.filter((t) => t.role === 'preferred'), []);
  await page.click('[data-action="remove-target"][data-id="201601"]');
  assert.equal(await page.locator('[data-target-editor]').count(), 0);
  const after = await state(page);
  assert.deepEqual(after.run.targets, []);
  assert.deepEqual(after.run.targets.filter((t) => t.role === 'required'), []);
  assert.deepEqual(after.run.targetLineage, {});
  await page.reload();
  await page.waitForSelector('#target-search');
  assert.equal(await page.locator('[data-action="select-target"]').count(), 0);
});


test('goal evaluation stays active for new sessions, resets, and saves with the old toggle off', async (t) => {
  const page = await fresh(t);
  assert.equal(await page.locator('[data-goal-enabled]').count(), 0);
  assert.equal(await page.locator('[data-goal-pink]').isVisible(), true);
  assert.match(await page.locator('[data-goal-issues]').innerText(), /Choose the trainee/);
  await trainee(page);
  assert.match(await page.locator('[data-goal-probability]').innerText(), /%/);
  await assertFieldsMatchState(page, 'after selecting a trainee with automatic goal evaluation');
  await page.selectOption('[data-goal-stars="pink"]', '3');
  const chance = await page.locator('[data-goal-probability]').innerText();
  await assertFieldsMatchState(page, 'after editing an automatically evaluated goal');
  await page.reload();
  assert.equal(await page.locator('[data-goal-probability]').innerText(), chance);
  await assertFieldsMatchState(page, 'after reloading an automatically evaluated goal');
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('[data-action="reset-all"]');
  assert.equal(await page.locator('[data-goal-enabled]').count(), 0);
  assert.equal(await page.inputValue('[data-goal-stars="pink"]'), '2');
  assert.match(await page.locator('[data-goal-issues]').innerText(), /Choose the trainee/);
  await assertFieldsMatchState(page, 'after resetting with automatic goal evaluation');

  const saved = defaultState(data);
  saved.version = 14;
  saved.run.traineeCardId = 100101;
  saved.run.goal = { ...saved.run.goal, enabled: false, pink: 'turf', pinkStars: 3 };
  const restored = await fresh(t, saved);
  assert.equal(await restored.locator('[data-goal-enabled]').count(), 0);
  assert.equal(await restored.inputValue('[data-goal-pink]'), 'turf');
  assert.equal(await restored.inputValue('[data-goal-stars="pink"]'), '3');
  assert.match(await restored.locator('[data-goal-probability]').innerText(), /%/);
  await assertFieldsMatchState(restored, 'after loading a goal that was disabled');
  await restored.selectOption('[data-goal-stars="pink"]', '2');
  assert.ok(!('enabled' in (await state(restored)).run.goal));
  await assertFieldsMatchState(restored, 'after saving a formerly disabled goal');
  await restored.reload();
  assert.match(await restored.locator('[data-goal-probability]').innerText(), /%/);
  await assertFieldsMatchState(restored, 'after reloading a formerly disabled goal');
});

test('Any pink defaults to two stars, updates estimates, and persists across reload', async (t) => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  const page = await fresh(t, saved);
  const pinkRow = page.locator('.goal-breakdown tr').filter({ hasText: 'Pink (' });
  assert.equal(await page.inputValue('[data-goal-pink]'), 'any');
  assert.equal(await page.inputValue('[data-goal-stars="pink"]'), '2');
  assert.match(await pinkRow.innerText(), /80\.0%/);
  assert.equal(await page.locator('[data-goal-issues]').count(), 0);
  const chance = await page.locator('[data-goal-probability]').innerText();
  await page.selectOption('[data-goal-stars="pink"]', '3');
  assert.match(await pinkRow.innerText(), /10\.0%/);
  assert.notEqual(await page.locator('[data-goal-probability]').innerText(), chance);
  await page.selectOption('[data-goal-pink]', 'end');
  assert.equal(await page.locator('[data-goal-warnings]').count(), 0);
  assert.match(await page.locator('[data-goal-probability]').innerText(), /%/);
  await page.selectOption('[data-goal-pink]', 'any');
  assert.equal(await page.locator('[data-goal-warnings]').count(), 0);
  assert.equal(await page.locator('[data-goal-issues]').count(), 0);
  await page.reload();
  assert.equal(await page.inputValue('[data-goal-pink]'), 'any');
  assert.equal(await page.inputValue('[data-goal-stars="pink"]'), '3');
  assert.match(await pinkRow.innerText(), /10\.0%/);
});

test('pink reset clears manual and inferred sparks and starting increases while preserving other inputs', async (t) => {
  const page = await fresh(t);
  await trainee(page);
  await target(page, 'Groundwork');
  await page.selectOption('[data-gain="0-0"]', '63');
  await page.selectOption('[data-apt="end"]', 'A');
  await page.click('[data-action="toggle-pink-sparks"]');
  await page.selectOption('[data-pink-lineage="5"]', 'turf');
  const before = await state(page);
  assert.ok(before.run.pinkLineage.some((p) => p?.inferred));
  assert.ok(before.run.pinkLineage.some((p) => p && !p.inferred));
  await page.click('[data-action="reset-pink-sparks"]');
  const expected = structuredClone(before);
  expected.run.pinkLineage = Array(6).fill(null);
  expected.run.aptOverrides = {};
  assert.deepEqual(await state(page), expected);
  assert.equal(await page.inputValue('[data-apt="end"]'), data.charByCardId.get(100101).aptitudes.end);
  assert.equal(await page.locator('[data-pink-sparks-form]').count(), 1);
  assert.deepEqual(await page.locator('[data-pink-lineage]').evaluateAll((els) => els.map((el) => el.value)), Array(6).fill(''));
  assert.equal(await page.locator('[data-pink-inferred]').count(), 0);
  await page.reload();
  assert.deepEqual(await state(page), expected);
  await page.click('[data-action="reset-pink-sparks"]');
  assert.deepEqual(await state(page), expected, 'reset also works when collapsed and already empty');
});

test('pink inputs default to zero sparks and retain partial estimates across edits and reload', async (t) => {
  const saved = defaultState(data);
  saved.version = 9;
  delete saved.run.pinkLineage;
  saved.run.traineeCardId = 100101;
  saved.run.aptOverrides.end = 'B';
  saved.run.goal = { ...saved.run.goal, pink: 'end' };
  const page = await fresh(t, saved);
  const toggle = page.locator('[data-action="toggle-pink-sparks"]');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('[data-pink-sparks-form]').count(), 0);
  assert.equal(await page.locator('[data-goal-warnings]').count(), 0);
  assert.equal(await page.locator('[data-goal-issues]').count(), 0);
  assert.match(await page.locator('[data-goal-probability]').innerText(), /0%/);
  assert.equal(await page.locator('[data-goal-attempts]').count(), 3);
  await toggle.press('Enter');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('[data-pink-lineage]').count(), 6);
  await page.click('[data-action="toggle-sparks"]');
  const blueBlank = await page.locator('[data-spark-stat="0-0"] option:checked').innerText();
  const blueStarsBlank = await page.locator('[data-spark-stars="0-0"] option:checked').innerText();
  assert.deepEqual(await page.locator('[data-pink-lineage] option:checked').allTextContents(), Array(6).fill(blueBlank));
  assert.deepEqual(await page.locator('[data-pink-lineage-stars] option:checked').allTextContents(), Array(6).fill(blueStarsBlank));
  await page.click('[data-action="toggle-sparks"]');
  await assertFieldsMatchState(page, 'with zero pink sparks');
  assert.equal(await page.locator('[data-pink-lineage-stars="0"]').isDisabled(), true);
  await page.selectOption('[data-pink-lineage="0"]', 'end');
  assert.equal(await page.inputValue('[data-pink-lineage-stars="0"]'), '3');
  assert.equal(await page.locator('[data-pink-lineage-stars="0"]').isDisabled(), false);
  assert.equal(await page.locator('[data-goal-zero]').count(), 0, 'one known spark contributes before the other slots are entered');
  assert.equal(await page.locator('[data-goal-warnings]').count(), 0);
  assert.deepEqual((await state(page)).run.pinkLineage, [{ aptitude: 'end', stars: 3 }, ...Array(5).fill(null)]);
  await assertFieldsMatchState(page, 'after entering one pink spark');
  const partialProbability = await page.locator('[data-goal-probability]').innerText();
  await page.reload();
  await page.waitForSelector('[data-goal-result]');
  assert.equal(await page.locator('[data-goal-probability]').innerText(), partialProbability);
  assert.equal(await page.locator('[data-goal-warnings]').count(), 0);
  await toggle.click();
  await assertFieldsMatchState(page, 'after reloading partial pink lineage');
  for (let i = 1; i < 6; i++) await page.selectOption(`[data-pink-lineage="${i}"]`, 'end');
  assert.equal(await page.locator('[data-goal-warnings]').count(), 0);
  await page.selectOption('[data-pink-lineage-stars="0"]', '3');
  assert.equal(await page.locator('[data-goal-issues]').count(), 0);
  assert.equal(await page.locator('[data-goal-zero]').count(), 0);
  assert.equal(await page.inputValue('[data-apt="end"]'), 'A', 'known lineage determines the starting grade');
  const probability = await page.locator('[data-goal-probability]').innerText();
  const ancestry = (await state(page)).run.pinkLineage;
  await page.click('[data-action="toggle-sparks"]');
  assert.equal(await page.locator('[data-sparks-form]').count(), 1);
  await toggle.click();
  assert.equal(await page.locator('[data-pink-sparks-form]').count(), 0);
  assert.equal(await page.locator('[data-sparks-form]').count(), 1, 'blue and pink editors toggle independently');
  assert.deepEqual((await state(page)).run.pinkLineage, ancestry);
  assert.equal(await page.locator('[data-goal-probability]').innerText(), probability);
  await page.reload();
  await page.waitForSelector('[data-goal-result]');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('[data-goal-probability]').innerText(), probability);
  await toggle.click();
  assert.equal(await page.inputValue('[data-pink-lineage="0"]'), 'end');
  assert.equal(await page.inputValue('[data-pink-lineage-stars="0"]'), '3');
  await page.selectOption('[data-pink-lineage="0"]', '');
  assert.equal(await page.locator('[data-pink-lineage-stars="0"]').isDisabled(), true);
  assert.equal(await page.inputValue('[data-pink-lineage-stars="0"]'), '');
  assert.equal(await page.locator('[data-pink-lineage-stars="0"] option:checked').innerText(), blueStarsBlank);
  assert.equal((await state(page)).run.pinkLineage[0], null);
  assert.equal(await page.locator('[data-goal-zero]').count(), 0, 'remaining known sparks still contribute');
  assert.equal(await page.locator('[data-goal-warnings]').count(), 0);
  assert.match(await page.locator('[data-goal-probability]').innerText(), /%/);
  await assertFieldsMatchState(page, 'after clearing one pink spark');
  await page.click('[data-action="reset-legacy"]');
  assert.deepEqual((await state(page)).run.pinkLineage, Array(6).fill(null));
  assert.deepEqual((await state(page)).run.aptOverrides, {});
  await assertFieldsMatchState(page, 'after resetting pink lineage to zero sparks');
});

test('aptitude increases infer editable pink sparks, preserve manual entries, and clear estimates on trainee change', async (t) => {
  const page = await fresh(t);
  await trainee(page);
  assert.equal(await page.inputValue('[data-apt="end"]'), 'C');
  await page.selectOption('[data-apt="end"]', 'A');
  assert.equal(await page.locator('[data-pink-sparks-form]').count(), 0);
  let sparks = (await state(page)).run.pinkLineage;
  assert.deepEqual(sparks.filter(Boolean), [{ aptitude: 'end', stars: 3, inferred: true }, { aptitude: 'end', stars: 1, inferred: true }]);
  await page.click('[data-action="toggle-pink-sparks"]');
  assert.equal(await page.locator('[data-pink-inferred]').count(), 2);
  assert.equal(await page.inputValue('[data-pink-lineage-stars="0"]'), '3');
  await page.selectOption('[data-apt="end"]', 'B');
  sparks = (await state(page)).run.pinkLineage;
  const index = sparks.findIndex((spark) => spark?.inferred);
  assert.deepEqual(sparks.filter(Boolean), [{ aptitude: 'end', stars: 1, inferred: true }]);
  await page.selectOption(`[data-pink-lineage-stars="${index}"]`, '3');
  assert.equal(await page.locator('[data-pink-inferred]').count(), 0, 'editing confirms the spark as manual');
  assert.equal(await page.inputValue('[data-apt="end"]'), 'B', 'manual ancestry refines inspiration inputs without changing entered grades');
  await page.selectOption('[data-apt="end"]', 'A');
  sparks = (await state(page)).run.pinkLineage;
  assert.deepEqual(sparks[index], { aptitude: 'end', stars: 3 });
  assert.deepEqual(sparks.filter((spark) => spark?.inferred), [{ aptitude: 'end', stars: 1, inferred: true }]);
  await page.reload();
  await page.waitForSelector('[data-apt="end"]');
  assert.deepEqual((await state(page)).run.pinkLineage, sparks);
  await page.click('[data-action="toggle-pink-sparks"]');
  assert.equal(await page.locator('[data-pink-inferred]').count(), 1);
  await page.selectOption('[data-apt="end"]', 'C');
  assert.deepEqual((await state(page)).run.pinkLineage.filter(Boolean), []);
  await page.selectOption('[data-apt="end"]', 'A');
  await page.click('[data-action="clear-trainee"]');
  await trainee(page, 'haru urara');
  assert.deepEqual((await state(page)).run.pinkLineage.filter(Boolean), []);
  await page.click('[data-action="reset-legacy"]');
  assert.deepEqual((await state(page)).run.pinkLineage, Array(6).fill(null));
});

test('dimmed aptitude choices rebalance pink sparks and planning overrides preserve them', async (t) => {
  const page = await fresh(t);
  await trainee(page);
  assert.deepEqual(await page.locator('[data-apt="turf"] option').evaluateAll((options) => options.map((o) => o.value)), ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  assert.deepEqual(await page.locator('[data-apt="dirt"] option').evaluateAll((options) => options.map((o) => o.value)), ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  await page.selectOption('[data-apt="dirt"]', 'C');
  await page.selectOption('[data-apt="sprint"]', 'D');
  const option = page.locator('[data-apt="end"] option[value="B"]');
  assert.equal(await option.getAttribute('class'), 'dim');
  assert.equal(await option.isDisabled(), false);
  await page.selectOption('[data-apt="end"]', 'B');
  assert.equal(await page.inputValue('[data-apt="sprint"]'), 'E');
  assert.equal(await page.inputValue('[data-apt="end"]'), 'B');
  const saved = (await state(page)).run;
  assert.equal(saved.pinkLineage.filter(Boolean).length, 6);
  assert.equal(await page.locator('[data-apt="end"] option:checked').getAttribute('class'), '');
  await page.locator('[data-apt="end"]').evaluate((select) => {
    select.value = 'G';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  saved.aptOverrides.end = 'G';
  assert.deepEqual((await state(page)).run, saved);
  assert.equal(await page.inputValue('[data-apt="end"]'), 'G');
  await assertFieldsMatchState(page, 'after a below-base planning override');
  await page.reload();
  await page.waitForSelector('[data-apt="end"]');
  assert.deepEqual((await state(page)).run, saved);
  assert.equal(await page.locator('[data-apt="sprint"] option[value="D"]').getAttribute('class'), 'dim');
  await page.click('[data-action="toggle-pink-sparks"]');
  assert.equal(await page.evaluate(() => {
    const stats = document.querySelector('.legacy-stats');
    const button = document.querySelector('[data-action="toggle-pink-sparks"]');
    const form = document.querySelector('[data-pink-sparks-form]');
    const aptitudes = document.querySelector('.legacy-apts');
    const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return before(stats, button) && before(button, form) && before(form, aptitudes);
  }), true, 'pink controls sit between the stat gains and aptitude table');
});

test('manual Mile sparks survive unrelated grades, trainee changes, and reload', async (t) => {
  const page = await fresh(t);
  await trainee(page);
  await page.selectOption('[data-goal-pink]', 'turf');
  await page.click('[data-action="goal-open-pink"]');
  assert.equal(await page.locator('[data-pink-lineage="0"]').evaluate((el) => el === document.activeElement), true);
  await assertFieldsMatchState(page, 'after opening lineage from the goal controls');
  await page.selectOption('[data-pink-lineage="4"]', 'mile');
  assert.equal(await page.inputValue('[data-apt="mile"]'), 'B');
  await assertFieldsMatchState(page, 'after adding manual Mile');
  const spark = (await state(page)).run.pinkLineage[4];
  await page.selectOption('[data-apt="dirt"]', 'F');
  assert.deepEqual((await state(page)).run.pinkLineage[4], spark);
  assert.match(await page.locator('[data-goal-probability]').innerText(), /%/);
  assert.equal(await page.locator('[data-goal-issues]').count(), 0);
  await assertFieldsMatchState(page, 'after the unrelated Dirt edit');
  await page.click('[data-action="clear-trainee"]');
  await trainee(page, 'haru urara');
  await assertFieldsMatchState(page, 'after switching trainee with manual ancestry');
  await page.selectOption('[data-apt="dirt"]', 'A');
  assert.deepEqual((await state(page)).run.pinkLineage[4], spark);
  await assertFieldsMatchState(page, 'after another unrelated grade edit');
  await page.reload();
  assert.equal(await page.inputValue('[data-apt="mile"]'), 'A');
  await assertFieldsMatchState(page, 'after reloading manual ancestry');
});

test('six manual End sparks stay intact on an unrelated grade selection', async (t) => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  saved.run.aptOverrides.end = 'B';
  saved.run.pinkLineage = Array.from({ length: 6 }, () => ({ aptitude: 'end', stars: 3 }));
  const page = await fresh(t, saved);
  assert.equal(await page.inputValue('[data-apt="end"]'), 'A');
  assert.equal(await page.locator('[data-apt="turf"] option:checked').getAttribute('class'), '');
  await page.selectOption('[data-apt="turf"]', 'A');
  assert.deepEqual((await state(page)).run.pinkLineage, saved.run.pinkLineage);
  await assertFieldsMatchState(page, 'after selecting Turf with six manual End sparks');
  await page.reload();
  assert.deepEqual((await state(page)).run.pinkLineage, saved.run.pinkLineage);
  await assertFieldsMatchState(page, 'after reloading six manual End sparks');
});

test('saved white siblings and gold-only targets stay visible and keep lineage', async (t) => {
  const gold = data.skills.find((s) => s.name === 'Runaway');
  const saved = { version: 6, run: { targets: [200433, 200432, gold.id], targetLineage: { 200433: { k1: 1, k2: 0, p1: 2, p2: 0 }, [gold.id]: { k1: 1, k2: 0, p1: 3, p2: 0 } } } };
  const page = await fresh(t, saved);
  for (const id of saved.run.targets) assert.equal(await page.locator(`[data-action="select-target"][data-id="${id}"]`).count(), 1);
  await page.click(`[data-action="select-target"][data-id="${gold.id}"]`);
  assert.match(await page.locator('[data-target-unsupported]').innerText(), /no released white spark/);
  assert.equal(await page.inputValue(`[data-lineage-p="${gold.id}"][data-side="p1"]`), '3');
  await page.click('[data-target-role="required"]');
  await assertFieldsMatchState(page, 'after editing a preserved gold-only target');
  assert.deepEqual((await state(page)).run.targetLineage, saved.run.targetLineage);
  await page.reload();
  assert.deepEqual((await state(page)).run.targets.map((t) => t.id), saved.run.targets);
  await page.fill('#target-search', 'Runaway');
  await page.click(`[data-action="add-target"][data-id="${gold.id}"]`);
  assert.equal((await state(page)).run.targets.length, 3, 'search resolves the retained target without duplicating it');
  await assertFieldsMatchState(page, 'after finding the preserved gold-only target');
});

test('goal explanations distinguish a difficult requirement, missing pink eligibility, and an impossible white spark', async (t) => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  saved.run.goal = { ...saved.run.goal, blueStars: 1, pinkStars: 3 };
  const page = await fresh(t, saved);
  const limits = page.locator('[data-goal-limits]');
  assert.match(await page.locator('[data-goal-probability]').innerText(), /Chance per final spark roll/);
  // Any 1-star blue is certain. Any 3-star pink is 10%, so pink is the limiting individual roll.
  assert.match(await limits.innerText(), /Lowest individual chance is Any pink aptitude at 3★ or better at 10\.0%/);
  await page.selectOption('[data-goal-pink]', 'end');
  assert.match(await limits.innerText(), /End Closer pink cannot reach final A\/S under the entered grades and pink sparks/);
  assert.doesNotMatch(await limits.innerText(), /Lowest individual chance/);
  await assertFieldsMatchState(page, 'after explaining missing pink eligibility');
  const runaway = data.skills.find((s) => s.name === 'Runaway');
  await page.fill('#target-search', 'Runaway');
  await page.click(`[data-action="add-target"][data-id="${runaway.id}"]`);
  await page.click('[data-target-role="required"]');
  assert.match(await limits.innerText(), /Runaway is impossible as a white spark because it has no released white form/);
  assert.match(await limits.innerText(), /End Closer pink cannot reach/);
  await assertFieldsMatchState(page, 'after explaining two blocked requirements');
  await page.selectOption('[data-goal-pink]', 'any');
  assert.doesNotMatch(await limits.innerText(), /cannot reach final A\/S/);
  await page.click('[data-target-role="preferred"]');
  assert.doesNotMatch(await limits.innerText(), /impossible/);
  await assertFieldsMatchState(page, 'after removing a blocked requirement from the goal');
  await page.selectOption('[data-goal-stars="pink"]', '1');
  await page.selectOption('[data-goal-stars="blue"]', '3');
  assert.match(await limits.innerText(), /Lowest individual chance is Blue at 3★/);
  assert.match(await limits.innerText(), /needs at least 600.*better odds at 1100/);
  await assertFieldsMatchState(page, 'after explaining the blue threshold');
  for (const stat of ['speed', 'stamina', 'power', 'guts', 'wit']) await page.uncheck(`[data-goal-blue="${stat}"]`);
  assert.equal(await limits.count(), 0, 'incomplete input is not diagnosed as an impossible goal');
  await assertFieldsMatchState(page, 'after clearing acceptable blue stats');
});

test('pink probability ranges remain visible and disabled and dimmed fields have a visual cue in both themes', async (t) => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  saved.run.goal = { ...saved.run.goal, pink: 'turf' };
  saved.run.pinkLineage = [{ aptitude: 'dirt', stars: 1 }, ...Array(5).fill(null)];
  const page = await fresh(t, saved);
  assert.match(await page.locator('[data-goal-probability]').innerText(), /% to .*%/);
  assert.equal(await page.locator('[data-goal-issues]').count(), 0);
  assert.match(await page.locator('[data-goal-limits]').innerText(), /Pink eligibility is uncertain/);
  assert.match(await page.locator('[data-goal-attempts="0.5"]').innerText(), / to .* attempts/);
  await page.click('[data-action="reset-pink-sparks"]');
  await page.selectOption('[data-apt="dirt"]', 'C');
  await page.selectOption('[data-apt="sprint"]', 'D');
  await target(page, 'Groundwork');
  for (const theme of ['light', 'dark']) {
    await page.click(`[data-theme-pick="${theme}"]`);
    const colors = await page.locator('[data-apt="end"]').evaluate((s) => ({ normal: getComputedStyle(s.querySelector('option[value="C"]')).color, dim: getComputedStyle(s.querySelector('option[value="B"]')).color }));
    assert.notEqual(colors.normal, colors.dim, theme);
    const disabled = page.locator('[data-lineage-p="201601"][data-side="p1"]');
    assert.equal(await disabled.isDisabled(), true);
    assert.ok(await disabled.evaluate((el) => Number(getComputedStyle(el).opacity) < 1), theme);
    await assertFieldsMatchState(page, `after checking field cues in ${theme}`);
  }
});
