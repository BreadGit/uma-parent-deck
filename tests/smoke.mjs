// Checks editor flows with search held pending, then completes a real search and checks six widths in both themes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { assertFieldsMatchState, waitForPlan } from './browser-fields.mjs';
import { holdSearch, releaseSearch } from './browser-search.mjs';
import { STATE_KEY } from '../src/state.ts';
const url = process.env.URL ?? 'http://localhost:5173/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
await holdSearch(page);
const errors = [];
// Edits save and render synchronously, so each wait below names the state the next assertion reads rather than a delay.
const savedState = (predicate) => page.waitForFunction(({ key, body }) => new Function('st', `return ${body}`)(JSON.parse(localStorage.getItem(key))), { key: STATE_KEY, body: predicate });
const fieldValue = (selector, value) => page.waitForFunction(({ selector, value }) => document.querySelector(selector)?.value === value, { selector, value });
const settled = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForSelector('h1');
await page.evaluate(() => localStorage.clear());
await page.reload();
// Before a trainee is picked every result panel is dimmed, including the ones nested in the split, except the ranking
// (where the inventory lives) and the warnings, which say what is missing.
await page.waitForSelector('[data-waiting]');
const dimmed = await page.$$eval('.results section.panel', (panels) => panels.map((p) => [p.querySelector('h2').textContent, getComputedStyle(p).opacity]));
for (const [title, opacity] of dimmed) {
  const live = title.startsWith('Card ranking') || title.startsWith('Warnings');
  assert.equal(opacity, live ? '1' : '0.35', `${title} should be ${live ? 'live' : 'dimmed'} before a trainee is picked`);
}
assert.ok(dimmed.some(([title]) => title.startsWith('Prioritized skills')) && dimmed.some(([title]) => title.startsWith('Warnings')), 'the nested panels and the warnings are rendered while waiting');
// The pinned input column ends inside the viewport on a fresh page, so its own scrolling reaches the last panel.
const column = await page.$eval('.inputs', (el) => ({ top: Math.round(el.getBoundingClientRect().top), bottom: Math.round(el.getBoundingClientRect().bottom), headerBottom: Math.round(document.querySelector('header').getBoundingClientRect().bottom) }));
assert.ok(column.top >= column.headerBottom && column.bottom <= 1100, `input column ${JSON.stringify(column)} should sit under the header and end inside the 1100px viewport`);

// A range input must stay mounted while it is dragged. Replacing it on each input event
// breaks pointer capture and prevents the thumb from reaching the pointer.
const threshold = page.locator('input[data-setting="winThreshold"]');
await threshold.scrollIntoViewIfNeeded();
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
await page.waitForFunction(() => document.querySelector('output[data-setting-output="winThreshold"]').value === `${Math.round(Number(document.querySelector('input[data-setting="winThreshold"]').value) * 100)}%`);
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
  return { traineeApts: panelOf('Trainee').querySelectorAll('select[data-apt]').length, legacyApts: panelOf('Legacy').querySelectorAll('select[data-apt]').length, gains: panelOf('Legacy').querySelectorAll('select[data-gain]').length, styleSelects: [...panelOf('Legacy').querySelectorAll('select[data-apt]')].filter((s) => ['front', 'pace', 'late', 'end'].includes(s.dataset.apt)).length };
});
assert.deepEqual(legacyPlacement, { traineeApts: 0, legacyApts: 10, gains: 10, styleSelects: 4 });
assert.deepEqual(await page.$$eval('select[data-gain]', (els) => els.map((s) => s.value)), Array(10).fill('0'), 'a fresh run starts with no entered gains');
await assertFieldsMatchState(page, 'after choosing the first trainee');
const baseTurf = await page.inputValue('select[data-apt="turf"]');
await page.selectOption('select[data-apt="end"]', 'A');
await assertFieldsMatchState(page, 'after increasing End Closer');
const pickTrainee = async (q) => {
  await page.click('button[data-action="clear-trainee"]');
  await page.fill('#trainee-search', q);
  await page.waitForSelector('li[data-action="pick-trainee"]');
  await page.click('li[data-action="pick-trainee"]');
};
await pickTrainee('special week hopp');
assert.equal(await page.inputValue('select[data-apt="turf"]'), baseTurf, 'selecting a trainee did not restore her default aptitude');
// the star count belongs to the trainee: 1★ set on a 1★ uma is clamped up to a 3★ uma's rarity when she is picked
await pickTrainee('haru urara');
await page.selectOption('select[data-select="trainee-stars"]', '1');
await savedState('st.run.traineeStars === 1');
await assertFieldsMatchState(page, 'after setting 1★ on Haru Urara');
await pickTrainee('special dreamer');
await savedState('st.run.traineeCardId === 100101');
const starsAfterSwitch = await page.evaluate((key) => ({ shown: document.querySelector('select[data-select="trainee-stars"]').value, saved: JSON.parse(localStorage.getItem(key)).run.traineeStars }), STATE_KEY);
assert.deepEqual(starsAfterSwitch, { shown: '3', saved: 3 }, 'a 3★ trainee cannot keep a 1★ count');
await assertFieldsMatchState(page, 'after switching trainee');
const searchWidths = await page.$$eval('input[type=search]', (els) => els.map((el) => ({ id: el.id, input: el.getBoundingClientRect().width, panel: el.closest('section.panel').getBoundingClientRect().width })));
for (const w of searchWidths) assert.ok(w.input > w.panel * 0.8, `${w.id} is ${w.input}px wide in a ${w.panel}px panel`);
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
await savedState('st.run.targets.length === 3');
// Pin a card by search and check its ranking control and deck slot.
await page.fill('#card-search', 'kitasan');
await page.waitForSelector('li[data-action="pin-card"]');
await page.click('li[data-action="pin-card"]');
await savedState('st.run.pinnedIds.includes(30028)');
assert.equal(await page.locator('[data-action="toggle-card-pin"][data-id="30028"]').getAttribute('aria-pressed'), 'true');
assert.ok((await page.$$eval('.deck .slot .name', (n) => n.map((x) => x.textContent))).some((n) => n.includes('Kitasan Black')), 'pinned card should be in the deck');
await page.click('.chip button[data-action="unpin-card"]:not([data-id="30052"])');
// Pin directly from the ranking, then unpin with the keyboard.
const rankingPin = page.locator('button[data-action="toggle-card-pin"][data-id="30028"]');
assert.equal(await page.locator('button[data-action="toggle-card-pin"]').count(), await page.locator('.scroll tbody tr').count(), 'every ranked card has a pin button');
await rankingPin.click();
await assertFieldsMatchState(page, 'with immediate deck estimates');
assert.equal(await rankingPin.getAttribute('aria-pressed'), 'true');
assert.equal(await page.locator('.pin-list [data-action="unpin-card"][data-id="30028"]').count(), 1);
assert.ok((await page.locator('.deck .slot .name').allTextContents()).some((name) => name.includes('Kitasan Black')), 'ranking pin adds the card to the deck');
await assertFieldsMatchState(page, 'after pinning from the ranking');
await rankingPin.press('Enter');
assert.equal(await rankingPin.getAttribute('aria-pressed'), 'false');
assert.equal(await page.locator('.pin-list [data-action="unpin-card"][data-id="30028"]').count(), 0);
await assertFieldsMatchState(page, 'after unpinning from the ranking');
const breakdownRows = await page.$$eval('[data-stat-breakdown] tbody tr', (r) => r.length);
assert.ok(breakdownRows >= 10, `breakdown should list cards, career, inheritance, base, final, spread; got ${breakdownRows}`);
// The input column hides behind a persisted flag; the run summary keeps the trainee and goal in view while it is hidden.
await page.click('[data-action="hide-inputs"]');
await savedState('st.ui.inputsHidden === true');
assert.equal(await page.locator('[data-inputs]').count(), 0, 'hiding removes the input column');
assert.match(await page.locator('[data-run-summary]').innerText(), /Blue\s+.*★\+/, 'the summary names the blue goal');
assert.equal(await page.locator('main').evaluate((el) => el.classList.contains('inputs-hidden')), true);
await assertFieldsMatchState(page, 'with the inputs hidden');
await page.click('[data-action="show-inputs"]');
await savedState('st.ui.inputsHidden === false');
assert.equal(await page.locator('[data-inputs]').count(), 1, 'showing restores the input column');
assert.equal(await page.locator('[data-run-summary]').count(), 0);
await assertFieldsMatchState(page, 'with the inputs shown again');
const bodyText = await page.textContent('body');
assert.ok(!bodyText.includes('blue spark 1★'), 'predicted run still shows blue spark odds');
assert.ok(!bodyText.includes('Card / event / inherited stats'), 'predicted run still shows stat-source totals');
assert.ok(!bodyText.includes("Blue spark stars depend on each stat's final value"), 'predicted run still shows the removed explanatory blurb');
assert.ok(!bodyText.includes('White spark stars'), 'predicted run still shows white spark odds');
assert.ok(bodyText.includes('Estimated SP'), 'predicted run should show the estimated SP');
assert.ok(!(await page.$$eval('select[data-apt] option', (o) => o.some((x) => x.value === 'S'))), 'S cannot be chosen as a pre-run aptitude');
assert.ok(!bodyText.includes('Default limit break for unmarked cards'), 'inventory settings still show default limit-break controls');
assert.ok(!bodyText.includes('Each parent carries up to'), 'parent blue sparks still show the removed explanatory blurb');
// picking a start gain fills the dropdown in its parent's colour and raises the start value
await page.selectOption('select[data-gain="1-2"]', '54');
await fieldValue('select[data-gain="1-2"]', '54');
const powerCell = await page.$eval('.legacy-stat:nth-child(3)', (el) => ({ start: Number(el.querySelector('.legacy-v').textContent), base: Number(el.querySelector('.legacy-sub').textContent.replace(/\D/g, '')), p1: Number(el.querySelector('select[data-gain="0-2"]').value), p2Class: el.querySelector('select[data-gain="1-2"]').className }));
assert.equal(powerCell.start, powerCell.base + powerCell.p1 + 54, 'the start value is base plus both parents');
assert.ok(/\bp2\b/.test(powerCell.p2Class) && /\bset\b/.test(powerCell.p2Class), 'a picked gain is shown filled in parent 2 colour');
assert.equal(await page.$eval('select[data-gain="1-0"]', (s) => s.value), '0', 'all three sparks are on Power on parent 2');
await assertFieldsMatchState(page, 'after picking a start gain');
// "By stars" opens the per-uma form; a spark set there shows up as the stat's "+XX" above
assert.equal(await page.$('[data-sparks-form]'), null, 'the spark form starts closed');
await page.click('button[data-action="toggle-sparks"]');
await page.waitForSelector('[data-sparks-form]');
assert.equal(await page.$$eval('select[data-spark-stat]', (s) => s.length), 6, 'two sides of three umas');
await page.selectOption('select[data-spark-stat="0-0"]', 'guts');
await fieldValue('select[data-spark-stat="0-0"]', 'guts');
await page.selectOption('select[data-spark-stars="0-0"]', '2');
await fieldValue('select[data-gain="0-3"]', '12');
const afterSpark = await page.evaluate(() => ({ speed: document.querySelector('select[data-gain="0-0"]').value, guts: document.querySelector('select[data-gain="0-3"]').value, guts2: document.querySelector('select[data-gain="1-3"]').value }));
assert.deepEqual(afterSpark, { speed: '0', guts: '12', guts2: '0' }, 'the parent has a 2★ Guts spark on her side only');
await assertFieldsMatchState(page, 'after editing a spark by stars');
await page.selectOption('select[data-gain="0-3"]', '0');
await fieldValue('select[data-gain="0-3"]', '0');
assert.equal(await page.$eval('select[data-spark-stat="0-0"]', (s) => s.value), '', 'setting the stat to +0 empties the uma\'s slot in the form');
await assertFieldsMatchState(page, 'after emptying a slot from the dropdown');
// +63 then +12 on one stat leaves two umas unentered: both of their selects show "—", not a stale star count
await page.selectOption('select[data-gain="0-3"]', '63');
await page.selectOption('select[data-gain="0-3"]', '12');
await fieldValue('select[data-gain="0-3"]', '12');
assert.deepEqual(await page.$$eval('.side.p1 select', (els) => els.map((s) => s.value)), ['guts', '2', '', '', '', ''], 'one 2★ Guts uma and two empty rows');
await assertFieldsMatchState(page, 'after shrinking a start gain');
// Editing an aggregate gain preserves an existing 1★ parent and changes only the 3★ grandparent.
for (const [selector, value] of [
  ['data-spark-stat="0-0"', 'speed'], ['data-spark-stars="0-0"', '1'],
  ['data-spark-stat="0-1"', 'speed'], ['data-spark-stars="0-1"', '3'],
  ['data-spark-stat="0-2"', 'power'], ['data-spark-stars="0-2"', '2'],
]) {
  await page.selectOption(`select[${selector}]`, value);
  await assertFieldsMatchState(page, `after entering ${selector}`);
}
assert.equal(await page.inputValue('select[data-gain="0-0"]'), '26');
await page.selectOption('select[data-gain="0-0"]', '17');
await assertFieldsMatchState(page, 'after reducing the grandparent spark through its gain');
assert.deepEqual(await page.$$eval('.side.p1 select', (els) => els.map((s) => s.value)), ['speed', '1', 'speed', '2', 'power', '2']);
assert.equal(await page.$$eval('.legacy-sparks', (els) => els.length), 1);
assert.ok(await page.evaluate(() => document.querySelector('.legacy-sparks').compareDocumentPosition(document.querySelector('.legacy-legend')) & Node.DOCUMENT_POSITION_FOLLOWING), 'the spark form sits above the start gain row');
await page.click('button[data-action="toggle-sparks"]');
await page.waitForSelector('[data-sparks-form]', { state: 'detached' });
assert.equal(await page.$('[data-sparks-form]'), null, 'the toggle closes the form again');
const summary = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.chip')].map((c) => c.textContent.trim()),
  deck: [...document.querySelectorAll('.deck .slot .name')].map((n) => n.textContent.trim()),
  stats: [...document.querySelectorAll('.stat-v')].map((n) => n.textContent.trim()),
  pSS: document.querySelector('.stat.outcome .pill')?.textContent,
  wishlist: [...document.querySelectorAll('ol li')].slice(0, 10).map((n) => n.textContent.trim().slice(0, 80)),
  races: document.querySelector('section.panel:has([data-agenda]) [data-panel-sub]')?.textContent,
  rankingRows: document.querySelectorAll('section.panel:last-child tbody tr').length,
  top3: [...document.querySelectorAll('section.panel:last-child tbody tr')].slice(0, 3).map((r) => r.children[1].textContent.trim().split('\n')[0]),
}));
console.log(JSON.stringify(summary, null, 1));
// the ranking's five stat cells carry the focus multipliers, so they add up to the Total cell (within rounding)
const rowSums = await page.evaluate(() => [...document.querySelectorAll('section.panel:last-child tbody tr')].slice(0, 5).map((r) => {
  const stats = [...r.querySelectorAll('[data-card-stat]')].map((td) => Number(td.textContent.trim()));
  return { sum: stats.reduce((a, b) => a + b, 0), total: Number(r.querySelector('[data-card-stat-total]').textContent.trim()) };
}));
for (const { sum, total } of rowSums) assert.ok(Number.isFinite(total) && Math.abs(sum - total) <= 3, `ranking stat cells ${sum} vs total ${total}`);
if (process.env.SCREENSHOT_PATH !== '') await page.screenshot({ path: process.env.SCREENSHOT_PATH ?? 'docs/screenshot.png', fullPage: true });
// exercise a race override, an LB change, a "not owned" mark and a blue spark slider
{
  // the race grid is collapsed until asked for; it stays open for the layout checks below
  await page.click('details[data-agenda] > summary');
  await page.waitForSelector('select[data-slot]');
  const firstSelected = await page.$('select[data-slot]:has(option[selected][value]:not([value=""]))');
  const before = await page.$$eval('.agenda-cell.sel', (n) => n.length);
  await firstSelected.selectOption('');
  await page.waitForFunction((before) => document.querySelectorAll('.agenda-cell.sel').length !== before, before);
  const after = await page.$$eval('.agenda-cell.sel', (n) => n.length);
  assert.ok(after < before, `skipping a slot should remove a race (${before} -> ${after})`);
}
await page.selectOption('select[data-lb="30028"]', '2');
await savedState('st.inventory["30028"] === 2');
await assertFieldsMatchState(page, 'after changing an LB in the ranking');
await page.selectOption('select[data-lb="30052"]', 'none');
await savedState('st.inventory["30052"] === null');
// the default Light Hello pin, once marked not owned, becomes a borrow request and takes the friend's slot
const afterUnown = await page.evaluate(() => ({ borrow: document.querySelector('.deck .slot:has(.tag.borrow) .name')?.textContent.trim(), chip: document.querySelector('.chip:has(button[data-id="30052"]) .tag.borrow')?.textContent }));
assert.ok(afterUnown.borrow?.includes('Light Hello'), `the unowned pin should be the borrow, got ${afterUnown.borrow}`);
assert.equal(afterUnown.chip, 'borrow', 'the pinned chip says borrow');
console.log('deck after marking Light Hello SSR not owned: borrow =', afterUnown.borrow);
// the panel's Reset clears every gain and aptitude override at once
await page.selectOption('select[data-apt="end"]', 'A');
await page.click('button[data-action="reset-legacy"]');
await savedState('Object.keys(st.run.aptOverrides).length === 0');
await assertFieldsMatchState(page, 'after the legacy reset');
const afterReset = await page.evaluate(() => ({ gains: [...document.querySelectorAll('select[data-gain]')].map((s) => s.value).join(','), turf: document.querySelector('select[data-apt="turf"]').value, options: document.querySelectorAll('select[data-gain="0-0"] option').length }));
assert.equal(afterReset.gains, '0,0,0,0,0,0,0,0,0,0', 'reset clears every gain for entry');
assert.equal(afterReset.turf, baseTurf, 'the aptitude override is gone');
assert.equal(afterReset.options, 20, 'every possible +XX is offered');
assert.equal(await page.locator('select[data-gain] option.dim').count(), 0, 'empty sides do not dim any choices');
await page.reload();
await page.waitForSelector('select[data-gain]');
await assertFieldsMatchState(page, 'after reloading cleared Legacy gains');
assert.deepEqual(await page.$$eval('select[data-gain]', (els) => els.map((s) => s.value)), Array(10).fill('0'));
await page.click('button[data-action="toggle-sparks"]');
await assertFieldsMatchState(page, 'after opening cleared spark rows');
assert.deepEqual(await page.$$eval('.legacy-sparks select', (els) => els.map((s) => s.value)), Array(12).fill(''));
// One occupied slot leaves room for at most two sparks on any other stat.
await page.selectOption('select[data-gain="0-0"]', '12');
await assertFieldsMatchState(page, 'after entering the first gain');
assert.deepEqual(await page.$$eval('select[data-gain="0-1"] option.dim', (els) => els.map((o) => o.value)), ['15', '22', '29', '31', '36', '38', '45', '47', '54', '63']);
assert.equal(await page.locator('select[data-gain="0-0"] option.dim').count(), 0, 'replacing the current stat can use its own slot');
assert.equal(await page.locator('select[data-gain^="1-"] option.dim').count(), 0, 'the other parent side is independent');
for (const theme of ['light', 'dark']) {
  await page.click(`button[data-theme-pick="${theme}"]`);
  const colors = await page.$eval('select[data-gain="0-1"]', (s) => ({
    normal: getComputedStyle(s.querySelector('option[value="12"]')).color,
    dim: getComputedStyle(s.querySelector('option[value="63"]')).color,
  }));
  assert.notEqual(colors.normal, colors.dim, `conflicting options have a distinct text color in ${theme} theme`);
}
await page.click('button[data-theme-pick="system"]');
// A dimmed choice remains selectable and reallocates the side's existing sparks.
assert.equal(await page.locator('select[data-gain] option:disabled').count(), 0);
await page.selectOption('select[data-gain="0-1"]', '63');
await assertFieldsMatchState(page, 'after selecting a dimmed gain');
assert.equal(await page.locator('select[data-gain="0-0"]').inputValue(), '0');
assert.equal(await page.locator('select[data-gain="0-1"]').inputValue(), '63');
assert.deepEqual(await page.$$eval('select[data-gain="0-0"] option:not(.dim)', (els) => els.map((o) => o.value)), ['0']);
await page.selectOption('select[data-spark-stat="0-0"]', 'power');
await assertFieldsMatchState(page, 'after moving a spark to another stat');
assert.deepEqual(await page.$$eval('select[data-gain="0-1"] option.dim', (els) => els.map((o) => o.value)), ['15', '22', '29', '31', '36', '38', '45', '47', '54', '63']);
await page.click('button[data-action="reset-legacy"]');
await assertFieldsMatchState(page, 'after clearing entered sparks again');
assert.equal(await page.locator('select[data-gain] option.dim').count(), 0);
await page.click('button[data-action="toggle-sparks"]');
await assertFieldsMatchState(page, 'after closing the spark form');
// Dimmed aptitude choices rebalance six pink sparks without going below base grades.
await page.selectOption('[data-apt="dirt"]', 'C');
await assertFieldsMatchState(page, 'after allocating four pink sparks to dirt');
await page.selectOption('[data-apt="sprint"]', 'D');
await assertFieldsMatchState(page, 'after filling all six pink slots');
assert.equal(await page.locator('[data-apt="end"] option[value="B"]').getAttribute('class'), 'dim');
assert.equal(await page.locator('[data-apt="end"] option[value="B"]').isDisabled(), false);
await page.selectOption('[data-apt="end"]', 'B');
await assertFieldsMatchState(page, 'after rebalancing a dimmed aptitude choice');
assert.equal(await page.inputValue('[data-apt="sprint"]'), 'E');
assert.equal(await page.inputValue('[data-apt="end"]'), 'B');
assert.equal(await page.locator('[data-apt="end"] option:checked').getAttribute('class'), '');
assert.equal(await page.locator('[data-apt="end"] option[value="D"]').count(), 1);
await page.locator('[data-apt="end"]').evaluate((select) => {
  select.value = 'D';
  select.dispatchEvent(new Event('change', { bubbles: true }));
});
await assertFieldsMatchState(page, 'after selecting a planning override below base');
assert.equal(await page.inputValue('[data-apt="end"]'), 'D');
await page.click('[data-action="reset-legacy"]');
await assertFieldsMatchState(page, 'after resetting aptitude rebalance checks');
// Goal roles share the target chips. Editor selection is transient; goals and lineage persist.
assert.equal(await page.locator('[data-goal-enabled]').count(), 0);
assert.equal(await page.locator('[data-goal-result]').count(), 1);
await assertFieldsMatchState(page, 'with automatic parent goal evaluation');
assert.equal(await page.inputValue('[data-goal-pink]'), 'any');
assert.equal(await page.inputValue('[data-goal-stars="pink"]'), '1');
await page.selectOption('[data-goal-pink]', 'end');
await assertFieldsMatchState(page, 'after selecting a specific pink goal');
await page.click('[data-action="reset-pink-goal"]');
await assertFieldsMatchState(page, 'after restoring Any pink');
await page.selectOption('[data-apt="end"]', 'A');
await assertFieldsMatchState(page, 'after raising aptitude before pink reset');
await page.click('[data-action="reset-pink-sparks"]');
await assertFieldsMatchState(page, 'after resetting pink sparks');
await page.uncheck('[data-goal-blue="guts"]');
await assertFieldsMatchState(page, 'after changing accepted blue stats');
await page.click('[data-action="goal-any-blue"]');
await assertFieldsMatchState(page, 'after restoring any blue stat');
for (const [selector, value] of [['[data-goal-stars="blue"]', '3'], ['[data-goal-stars="pink"]', '2'], ['[data-goal-pink]', 'turf']]) {
  await page.selectOption(selector, value);
  await assertFieldsMatchState(page, `after ${selector} = ${value}`);
}
for (const id of [200352, 201601, 200472]) {
  await page.click(`[data-action="select-target"][data-id="${id}"]`);
  await assertFieldsMatchState(page, `after opening target ${id}`);
  await page.click(`[data-target-role="required"][data-id="${id}"]`);
  await assertFieldsMatchState(page, `after requiring target ${id}`);
}
assert.equal(await page.locator('[data-required-count]').innerText(), '3 required');
assert.equal(await page.locator('.deck .slot').count(), 6, 'goal search keeps a complete legal deck');
assert.equal(await page.locator('[data-pink-sparks-form]').count(), 0, 'pink ancestry starts collapsed');
await page.click('[data-action="toggle-pink-sparks"]');
await assertFieldsMatchState(page, 'after opening pink sparks');
const startEnd = await page.inputValue('[data-apt="end"]');
await page.selectOption('[data-apt="end"]', 'A');
await assertFieldsMatchState(page, 'after inferring pink sparks from an aptitude increase');
assert.equal(await page.locator('[data-pink-inferred]').count(), 2);
await page.reload();
await page.waitForSelector('[data-goal-result]');
await page.click('[data-action="toggle-pink-sparks"]');
await assertFieldsMatchState(page, 'after reloading inferred pink sparks');
assert.equal(await page.locator('[data-pink-inferred]').count(), 2);
await page.selectOption('[data-apt="end"]', startEnd);
await assertFieldsMatchState(page, 'after restoring the base aptitude');
assert.equal(await page.locator('[data-pink-inferred]').count(), 0);
for (let i = 0; i < 6; i++) {
  await page.selectOption(`[data-pink-lineage="${i}"]`, 'turf');
  await assertFieldsMatchState(page, `after pink lineage ${i}`);
}
await page.selectOption('[data-pink-lineage-stars="0"]', '3');
await assertFieldsMatchState(page, 'after pink star edit');
const goalWithPinkSparks = await page.locator('[data-goal-probability]').innerText();
await page.click('[data-action="toggle-pink-sparks"]');
await assertFieldsMatchState(page, 'after closing pink sparks');
assert.equal(await page.locator('[data-pink-sparks-form]').count(), 0);
assert.equal(await page.locator('[data-goal-probability]').innerText(), goalWithPinkSparks, 'closing inputs keeps inspiration estimates');
assert.equal(await page.locator('[data-goal-issues]').count(), 0);
assert.equal(await page.locator('[data-goal-attempts]').count(), 3);
await page.click('[data-action="select-target"][data-id="201601"]');
await assertFieldsMatchState(page, 'after switching target editor');
await page.selectOption('[data-target-stars="201601"]', '3');
await assertFieldsMatchState(page, 'after required star edit');
await page.selectOption('[data-lineage-k="201601"][data-side="k1"]', '2');
await assertFieldsMatchState(page, 'after white lineage copies');
await page.selectOption('[data-lineage-p="201601"][data-side="p1"]', '5');
await assertFieldsMatchState(page, 'after white lineage stars');
await page.click('[data-action="select-target"][data-id="201601"]');
assert.equal(await page.locator('[data-target-editor]').count(), 0, 'clicking the selected chip closes the editor');
await assertFieldsMatchState(page, 'after closing target editor');
await page.click('[data-action="select-target"][data-id="201601"]');
await assertFieldsMatchState(page, 'after reopening target editor');
assert.equal(await page.locator('[data-target-editor] [data-action="remove-target"]').count(), 0, 'removal lives on the chip');
for (const query of ['Lucky Seven', 'Right-Handed']) {
  await page.fill('#target-search', query);
  await page.locator('[data-action="add-target"]').first().click();
  await assertFieldsMatchState(page, `after adding ${query} as preferred`);
}
await page.click('[data-action="remove-target"][data-id="200012"]');
await assertFieldsMatchState(page, 'after removing the active chip');
assert.equal(await page.locator('[data-target-editor]').count(), 0);
await page.reload();
await page.waitForSelector('[data-goal-result]');
await assertFieldsMatchState(page, 'after reloading goals');
for (const id of [200352, 201601, 200472]) {
  await page.click(`[data-action="select-target"][data-id="${id}"]`);
  await assertFieldsMatchState(page, `after restoring editor ${id}`);
  if (id === 201601) {
    assert.equal(await page.inputValue('[data-target-stars="201601"]'), '3');
    assert.equal(await page.inputValue('[data-lineage-p="201601"][data-side="p1"]'), '5');
  }
  await page.click(`[data-target-role="preferred"][data-id="${id}"]`);
  await assertFieldsMatchState(page, `after making ${id} preferred`);
}
assert.equal(await page.locator('[data-required-count]').innerText(), '0 required');
assert.equal(await page.locator('[data-goal-issues]').count(), 0, 'zero required whites is a complete white goal');
await page.click('[data-target-role="required"][data-id="200472"]');
await assertFieldsMatchState(page, 'after selecting one required white');
assert.equal(await page.locator('[data-pink-sparks-form]').count(), 0, 'pink editor stays closed after reload');
await page.click('[data-action="toggle-pink-sparks"]');
await assertFieldsMatchState(page, 'after restoring pink editor');
assert.equal(await page.inputValue('[data-pink-lineage-stars="0"]'), '3');
await page.click('[data-action="toggle-sparks"]');
await assertFieldsMatchState(page, 'with both advanced legacy forms open');
await releaseSearch(page);
await waitForPlan(page);
await assertFieldsMatchState(page, 'after the native worker publishes the completed deck');
// layout check: no horizontal overflow at common widths, both themes
for (const width of [390, 768, 1280, 1440, 1680, 1920]) {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 1000 });
    await settled();
    assert.match(await page.locator('[data-sort="score"]').innerText(), /^Target spark chances.*▾$/);
    assert.equal(await page.getByText('Added spark chance', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Spark chance alone', { exact: true }).count(), 0);
    assert.ok(await page.locator('[data-target-chances]').evaluateAll((cells) => cells.every((cell) => cell.querySelectorAll('[data-target-spark]').length <= 4)));
    const over = await page.evaluate(() => {
      const w = document.documentElement.clientWidth; const bad = [];
      if (document.documentElement.scrollWidth > w + 1) bad.push(`document ${document.documentElement.scrollWidth} > ${w}`);
      for (const el of document.querySelectorAll('section.panel, .agenda-year, .deck .slot')) { const r = el.getBoundingClientRect(); if (r.right > w + 1) bad.push(`${el.className} right=${Math.round(r.right)}`); }
      // content clipped inside a box never widens the document, so check every clipping element's own content too;
      // deliberate truncation (ellipsis, line clamp) is exempt and a few px of a nowrap row are tolerated
      for (const el of document.querySelectorAll('#app *')) {
        const cs = getComputedStyle(el);
        if (!(cs.overflowX === 'hidden' || cs.overflowX === 'clip') || cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none') continue;
        if (el.scrollWidth > el.clientWidth + 4) bad.push(`${el.tagName.toLowerCase()}.${el.className} clips ${el.scrollWidth - el.clientWidth}px (${el.textContent.trim().slice(0, 30)})`);
      }
      return bad;
    });
    assert.deepEqual(over, [], `overflow at ${width}px ${scheme}: ${over.join('; ')}`);
  }
}
console.log('layout ok at 390-1920px in light and dark');
console.log('errors:', errors);
await browser.close();
process.exit(errors.length ? 1 : 0);
