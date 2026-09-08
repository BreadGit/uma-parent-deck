// Drives the dev server in Chromium through the main flows and checks layout at four widths in both themes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { BLUE_SPARK_START_GAIN_BY_STARS } from '../src/model/rules.ts';
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

/**
 * Every form field that mirrors persisted state must show that state. A <select> the user has changed ignores later
 * `selected` attribute changes on its options, so a field that lit reuses for a different card or stat would keep a
 * stale value unless its value is bound live; this catches that whatever the field.
 */
async function assertFieldsMatchState(where) {
  const bad = await page.evaluate((gainByStars) => {
    const st = JSON.parse(localStorage.getItem('uma-parent-deck.v4') ?? '{}');
    const out = [];
    const STATS = ['speed', 'stamina', 'power', 'guts', 'wit'];
    for (const el of document.querySelectorAll('select[data-lb]')) {
      const v = st.inventory?.[el.dataset.lb];
      const want = v === null ? 'none' : String(v ?? 4);
      if (el.value !== want) out.push(`LB select for ${el.dataset.lb} shows ${el.value}, state ${want}`);
    }
    for (const el of document.querySelectorAll('select[data-gain]')) {
      const [p, i] = el.dataset.gain.split('-').map(Number);
      const want = String((st.run?.parentSparks?.[p] ?? []).filter((s) => s?.stat === STATS[i]).reduce((a, s) => a + gainByStars[s.stars], 0));
      if (el.value !== want) out.push(`gain select ${el.dataset.gain} shows ${el.value}, state makes ${want}`);
    }
    for (const el of document.querySelectorAll('select[data-spark-stat], select[data-spark-stars]')) {
      const key = el.dataset.sparkStat ?? el.dataset.sparkStars;
      const [p, u] = key.split('-').map(Number);
      const spark = st.run?.parentSparks?.[p]?.[u] ?? null;
      const want = el.dataset.sparkStat ? (spark?.stat ?? '') : spark ? String(spark.stars) : '';
      if (el.value !== want) out.push(`spark select ${key} shows ${el.value}, state ${want}`);
      if (el.dataset.sparkStars && el.disabled !== !spark) out.push(`stars select ${key} disabled=${el.disabled} for spark ${JSON.stringify(spark)}`);
      if (!!el.querySelector('option[value=""]') !== !spark) out.push(`spark select ${key} offers "—" ${spark ? 'for a filled slot' : 'not at all for an empty slot'}`);
    }
    for (const el of document.querySelectorAll('select[data-apt]')) {
      const over = st.run?.aptOverrides?.[el.dataset.apt];
      if (over && el.value !== over) out.push(`aptitude select ${el.dataset.apt} shows ${el.value}, override ${over}`);
    }
    for (const el of document.querySelectorAll('select[data-select="trainee-stars"]')) {
      if (el.value !== String(st.run?.traineeStars ?? 3)) out.push(`trainee stars shows ${el.value}, state ${st.run?.traineeStars}`);
    }
    for (const el of document.querySelectorAll('[data-setting]')) {
      const v = st.settings?.[el.dataset.setting];
      if (el.tagName === 'SELECT' && v !== undefined && el.value !== String(v)) out.push(`setting ${el.dataset.setting} shows ${el.value}, state ${v}`);
    }
    const goal = st.run?.goal;
    const check = (el, want) => { if (el.value !== String(want)) out.push(`${JSON.stringify(el.dataset)} shows ${el.value}, state ${want}`); };
    for (const el of document.querySelectorAll('[data-goal-enabled]')) {
      if (el.checked !== goal?.enabled) out.push('goal enabled differs from state');
    }
    for (const el of document.querySelectorAll('[data-goal-blue]')) {
      if (el.checked !== goal.blueStats.includes(el.dataset.goalBlue)) out.push(`blue ${el.dataset.goalBlue} differs from state`);
    }
    for (const el of document.querySelectorAll('[data-goal-stars]')) check(el, goal[`${el.dataset.goalStars}Stars`]);
    for (const el of document.querySelectorAll('[data-goal-pink]')) check(el, goal.pink ?? '');
    for (const el of document.querySelectorAll('[data-target-stars]')) check(el, goal.required.find((r) => r.id === Number(el.dataset.targetStars)).stars);
    for (const el of document.querySelectorAll('[data-target-role]')) {
      const required = goal.required.some((r) => r.id === Number(el.dataset.id));
      if (el.getAttribute('aria-pressed') !== String(required === (el.dataset.targetRole === 'required'))) out.push('target role differs from state');
    }
    for (const el of document.querySelectorAll('[data-goal-lineage-k], [data-goal-lineage-p], [data-lineage-k], [data-lineage-p]')) {
      const id = el.dataset.goalLineageK ?? el.dataset.goalLineageP ?? el.dataset.lineageK ?? el.dataset.lineageP;
      check(el, st.run.targetLineage[id]?.[el.dataset.side] ?? 0);
    }
    return out;
  }, BLUE_SPARK_START_GAIN_BY_STARS);
  assert.deepEqual(bad, [], `fields out of step with the state ${where}: ${bad.join('; ')}`);
}

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
await assertFieldsMatchState('after choosing the first trainee');
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
// the star count belongs to the trainee: 1★ set on a 1★ uma is clamped up to a 3★ uma's rarity when she is picked
await pickTrainee('haru urara');
await page.selectOption('select[data-select="trainee-stars"]', '1');
await page.waitForTimeout(200);
await assertFieldsMatchState('after setting 1★ on Haru Urara');
await pickTrainee('special dreamer');
await page.waitForTimeout(200);
const starsAfterSwitch = await page.evaluate(() => ({ shown: document.querySelector('select[data-select="trainee-stars"]').value, saved: JSON.parse(localStorage.getItem('uma-parent-deck.v4')).run.traineeStars }));
assert.deepEqual(starsAfterSwitch, { shown: '3', saved: 3 }, 'a 3★ trainee cannot keep a 1★ count');
await assertFieldsMatchState('after switching trainee');
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
await page.waitForTimeout(300);
// pin a card by search and check it leads the ranking and sits in the deck
await page.fill('#card-search', 'kitasan');
await page.waitForSelector('li[data-action="pin-card"]');
await page.click('li[data-action="pin-card"]');
await page.waitForTimeout(200);
const topRanked = await page.$$eval('section.panel:last-child tbody tr td:nth-child(2)', (tds) => tds.slice(0, 2).map((td) => ({ name: td.textContent, pinned: td.querySelector('.ranking-pin')?.getAttribute('aria-pressed') === 'true' })));
assert.ok(topRanked.some((t) => t.name.includes('Kitasan Black') && t.pinned), `pinned card should sit with the pinned rows at the top, got: ${JSON.stringify(topRanked)}`);
assert.ok((await page.$$eval('.deck .slot .name', (n) => n.map((x) => x.textContent))).some((n) => n.includes('Kitasan Black')), 'pinned card should be in the deck');
await page.click('.chip button[data-action="unpin-card"]:not([data-id="30052"])');
// Pin directly from the ranking, then unpin with the keyboard after the row moves.
const rankingPin = page.locator('button[data-action="toggle-card-pin"][data-id="30028"]');
assert.equal(await page.locator('button[data-action="toggle-card-pin"]').count(), await page.locator('.scroll tbody tr').count(), 'every ranked card has a pin button');
await rankingPin.click();
assert.equal(await rankingPin.getAttribute('aria-pressed'), 'true');
assert.equal(await page.locator('.scroll tbody tr').nth(1).locator('button[data-action="toggle-card-pin"]').getAttribute('data-id'), '30028', 'new pin follows Light Hello at the top of the ranking');
assert.equal(await page.locator('.pin-list [data-action="unpin-card"][data-id="30028"]').count(), 1);
assert.ok((await page.locator('.deck .slot .name').allTextContents()).some((name) => name.includes('Kitasan Black')), 'ranking pin adds the card to the deck');
await assertFieldsMatchState('after pinning from the ranking');
await rankingPin.press('Enter');
assert.equal(await rankingPin.getAttribute('aria-pressed'), 'false');
assert.equal(await page.locator('.pin-list [data-action="unpin-card"][data-id="30028"]').count(), 0);
await assertFieldsMatchState('after unpinning from the ranking');
await page.click('details:has(> summary:text("Where the stats come from")) > summary');
const breakdownRows = await page.$$eval('details:has(> summary:text("Where the stats come from")) tbody tr', (r) => r.length);
assert.ok(breakdownRows >= 10, `breakdown should list cards, career, inheritance, base, final, spread; got ${breakdownRows}`);
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
await page.waitForTimeout(200);
const powerCell = await page.$eval('.legacy-stat:nth-child(3)', (el) => ({ start: Number(el.querySelector('.body .v').textContent), base: Number(el.querySelector('.body .sub').textContent.replace(/\D/g, '')), p1: Number(el.querySelector('select[data-gain="0-2"]').value), p2Class: el.querySelector('select[data-gain="1-2"]').className }));
assert.equal(powerCell.start, powerCell.base + powerCell.p1 + 54, 'the start value is base plus both parents');
assert.ok(/\bp2\b/.test(powerCell.p2Class) && /\bset\b/.test(powerCell.p2Class), 'a picked gain is shown filled in parent 2 colour');
assert.equal(await page.$eval('select[data-gain="1-0"]', (s) => s.value), '0', 'all three sparks are on Power on parent 2');
await assertFieldsMatchState('after picking a start gain');
// "By stars" opens the per-uma form; a spark set there shows up as the stat's "+XX" above
assert.equal(await page.$('[data-sparks-form]'), null, 'the spark form starts closed');
await page.click('button[data-action="toggle-sparks"]');
await page.waitForSelector('[data-sparks-form]');
assert.equal(await page.$$eval('select[data-spark-stat]', (s) => s.length), 6, 'two sides of three umas');
await page.selectOption('select[data-spark-stat="0-0"]', 'guts');
await page.waitForTimeout(200);
await page.selectOption('select[data-spark-stars="0-0"]', '2');
await page.waitForTimeout(200);
const afterSpark = await page.evaluate(() => ({ speed: document.querySelector('select[data-gain="0-0"]').value, guts: document.querySelector('select[data-gain="0-3"]').value, guts2: document.querySelector('select[data-gain="1-3"]').value }));
assert.deepEqual(afterSpark, { speed: '0', guts: '12', guts2: '0' }, 'the parent has a 2★ Guts spark on her side only');
await assertFieldsMatchState('after editing a spark by stars');
await page.selectOption('select[data-gain="0-3"]', '0');
await page.waitForTimeout(200);
assert.equal(await page.$eval('select[data-spark-stat="0-0"]', (s) => s.value), '', 'setting the stat to +0 empties the uma\'s slot in the form');
await assertFieldsMatchState('after emptying a slot from the dropdown');
// +63 then +12 on one stat leaves two umas unentered: both of their selects show "—", not a stale star count
await page.selectOption('select[data-gain="0-3"]', '63');
await page.selectOption('select[data-gain="0-3"]', '12');
await page.waitForTimeout(200);
assert.deepEqual(await page.$$eval('.side.p1 select', (els) => els.map((s) => s.value)), ['guts', '2', '', '', '', ''], 'one 2★ Guts uma and two empty rows');
await assertFieldsMatchState('after shrinking a start gain');
// Editing an aggregate gain preserves an existing 1★ parent and changes only the 3★ grandparent.
for (const [selector, value] of [
  ['data-spark-stat="0-0"', 'speed'], ['data-spark-stars="0-0"', '1'],
  ['data-spark-stat="0-1"', 'speed'], ['data-spark-stars="0-1"', '3'],
  ['data-spark-stat="0-2"', 'power'], ['data-spark-stars="0-2"', '2'],
]) {
  await page.selectOption(`select[${selector}]`, value);
  await assertFieldsMatchState(`after entering ${selector}`);
}
assert.equal(await page.inputValue('select[data-gain="0-0"]'), '26');
await page.selectOption('select[data-gain="0-0"]', '17');
await assertFieldsMatchState('after reducing the grandparent spark through its gain');
assert.deepEqual(await page.$$eval('.side.p1 select', (els) => els.map((s) => s.value)), ['speed', '1', 'speed', '2', 'power', '2']);
assert.equal(await page.$$eval('.legacy-sparks', (els) => els.length), 1);
assert.ok(await page.evaluate(() => document.querySelector('.legacy-sparks').compareDocumentPosition(document.querySelector('.legacy-legend')) & Node.DOCUMENT_POSITION_FOLLOWING), 'the spark form sits above the start gain row');
await page.click('button[data-action="toggle-sparks"]');
await page.waitForTimeout(100);
assert.equal(await page.$('[data-sparks-form]'), null, 'the toggle closes the form again');
const summary = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.chip')].map((c) => c.textContent.trim()),
  deck: [...document.querySelectorAll('.deck .slot .name')].map((n) => n.textContent.trim()),
  stats: [...document.querySelectorAll('.stat .v')].map((n) => n.textContent.trim()),
  pSS: document.querySelector('.stat.outcome .pill')?.textContent,
  wishlist: [...document.querySelectorAll('ol li')].slice(0, 10).map((n) => n.textContent.trim().slice(0, 80)),
  races: document.querySelector('h2:has(+ .scroll)')?.textContent,
  rankingRows: document.querySelectorAll('section.panel:last-child tbody tr').length,
  top3: [...document.querySelectorAll('section.panel:last-child tbody tr')].slice(0, 3).map((r) => r.children[1].textContent.trim().split('\n')[0]),
}));
console.log(JSON.stringify(summary, null, 1));
// the ranking's five stat cells carry the focus multipliers, so they add up to the Total cell (within rounding)
const rowSums = await page.evaluate(() => [...document.querySelectorAll('section.panel:last-child tbody tr')].slice(0, 5).map((r) => {
  const cells = [...r.children].map((td) => Number(td.textContent.trim()));
  return { sum: cells.slice(6, 11).reduce((a, b) => a + b, 0), total: cells[11] };
}));
for (const { sum, total } of rowSums) assert.ok(Number.isFinite(total) && Math.abs(sum - total) <= 3, `ranking stat cells ${sum} vs total ${total}`);
if (process.env.SCREENSHOT_PATH !== '') await page.screenshot({ path: process.env.SCREENSHOT_PATH ?? 'docs/screenshot.png', fullPage: true });
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
await page.waitForTimeout(300);
await assertFieldsMatchState('after changing an LB in the ranking');
await page.selectOption('select[data-lb="30052"]', 'none');
await page.waitForTimeout(200);
// the default Light Hello pin, once marked not owned, becomes a borrow request and takes the friend's slot
const afterUnown = await page.evaluate(() => ({ borrow: document.querySelector('.deck .slot:has(.tag.borrow) .name')?.textContent.trim(), chip: document.querySelector('.chip:has(button[data-id="30052"]) .tag.borrow')?.textContent }));
assert.ok(afterUnown.borrow?.includes('Light Hello'), `the unowned pin should be the borrow, got ${afterUnown.borrow}`);
assert.equal(afterUnown.chip, 'borrow', 'the pinned chip says borrow');
console.log('deck after marking Light Hello SSR not owned: borrow =', afterUnown.borrow);
// the panel's Reset clears every gain and aptitude override at once
await page.selectOption('select[data-apt="turf"]', 'G');
await page.click('button[data-action="reset-legacy"]');
await page.waitForTimeout(200);
await assertFieldsMatchState('after the legacy reset');
const afterReset = await page.evaluate(() => ({ gains: [...document.querySelectorAll('select[data-gain]')].map((s) => s.value).join(','), turf: document.querySelector('select[data-apt="turf"]').value, options: document.querySelectorAll('select[data-gain="0-0"] option').length }));
assert.equal(afterReset.gains, '0,0,0,0,0,0,0,0,0,0', 'reset clears every gain for entry');
assert.equal(afterReset.turf, baseTurf, 'the aptitude override is gone');
assert.equal(afterReset.options, 20, 'every possible +XX is offered');
assert.equal(await page.locator('select[data-gain] option.dim').count(), 0, 'empty sides do not dim any choices');
await page.reload();
await page.waitForSelector('select[data-gain]');
await assertFieldsMatchState('after reloading cleared Legacy gains');
assert.deepEqual(await page.$$eval('select[data-gain]', (els) => els.map((s) => s.value)), Array(10).fill('0'));
await page.click('button[data-action="toggle-sparks"]');
await assertFieldsMatchState('after opening cleared spark rows');
assert.deepEqual(await page.$$eval('.legacy-sparks select', (els) => els.map((s) => s.value)), Array(12).fill(''));
// One occupied slot leaves room for at most two sparks on any other stat.
await page.selectOption('select[data-gain="0-0"]', '12');
await assertFieldsMatchState('after entering the first gain');
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
await assertFieldsMatchState('after selecting a dimmed gain');
assert.equal(await page.locator('select[data-gain="0-0"]').inputValue(), '0');
assert.equal(await page.locator('select[data-gain="0-1"]').inputValue(), '63');
assert.deepEqual(await page.$$eval('select[data-gain="0-0"] option:not(.dim)', (els) => els.map((o) => o.value)), ['0']);
await page.selectOption('select[data-spark-stat="0-0"]', 'power');
await assertFieldsMatchState('after moving a spark to another stat');
assert.deepEqual(await page.$$eval('select[data-gain="0-1"] option.dim', (els) => els.map((o) => o.value)), ['15', '22', '29', '31', '36', '38', '45', '47', '54', '63']);
await page.click('button[data-action="reset-legacy"]');
await assertFieldsMatchState('after clearing entered sparks again');
assert.equal(await page.locator('select[data-gain] option.dim').count(), 0);
await page.click('button[data-action="toggle-sparks"]');
await assertFieldsMatchState('after closing the spark form');
// Goal roles share the target chips. Editor selection is transient; goals and lineage persist.
const deckBeforeGoal = await page.locator('.deck').innerText();
await page.check('[data-goal-enabled]');
await assertFieldsMatchState('after enabling parent goal');
await page.uncheck('[data-goal-blue="guts"]');
await assertFieldsMatchState('after changing accepted blue stats');
await page.click('[data-action="goal-any-blue"]');
await assertFieldsMatchState('after restoring any blue stat');
for (const [selector, value] of [['[data-goal-stars="blue"]', '3'], ['[data-goal-stars="pink"]', '2'], ['[data-goal-pink]', 'turf']]) {
  await page.selectOption(selector, value);
  await assertFieldsMatchState(`after ${selector} = ${value}`);
}
for (const id of [200352, 201601, 200472]) {
  await page.click(`[data-action="select-target"][data-id="${id}"]`);
  await assertFieldsMatchState(`after opening target ${id}`);
  await page.click(`[data-target-role="required"][data-id="${id}"]`);
  await assertFieldsMatchState(`after requiring target ${id}`);
}
assert.equal(await page.locator('[data-required-count]').innerText(), '3 required');
assert.equal(await page.locator('.deck').innerText(), deckBeforeGoal, 'changing goal roles leaves selected cards unchanged');
assert.equal(await page.locator('[data-goal-issues]').count(), 0);
assert.equal(await page.locator('[data-goal-attempts]').count(), 3);
await page.click('[data-action="select-target"][data-id="201601"]');
await assertFieldsMatchState('after switching target editor');
await page.selectOption('[data-target-stars="201601"]', '3');
await assertFieldsMatchState('after required star edit');
await page.selectOption('[data-lineage-k="201601"][data-side="k1"]', '2');
await assertFieldsMatchState('after white lineage copies');
await page.selectOption('[data-lineage-p="201601"][data-side="p1"]', '5');
await assertFieldsMatchState('after white lineage stars');
await page.click('[data-action="select-target"][data-id="201601"]');
assert.equal(await page.locator('[data-target-editor]').count(), 0, 'clicking the selected chip closes the editor');
await assertFieldsMatchState('after closing target editor');
await page.click('[data-action="select-target"][data-id="201601"]');
await assertFieldsMatchState('after reopening target editor');
assert.equal(await page.locator('[data-target-editor] [data-action="remove-target"]').count(), 0, 'removal lives on the chip');
for (const query of ['Lucky Seven', 'Right-Handed']) {
  await page.fill('#target-search', query);
  await page.locator('[data-action="add-target"]').first().click();
  await assertFieldsMatchState(`after adding ${query} as preferred`);
}
await page.click('[data-action="remove-target"][data-id="200012"]');
await assertFieldsMatchState('after removing the active chip');
assert.equal(await page.locator('[data-target-editor]').count(), 0);
await page.reload();
await page.waitForSelector('[data-goal-result]');
await assertFieldsMatchState('after reloading goals');
for (const id of [200352, 201601, 200472]) {
  await page.click(`[data-action="select-target"][data-id="${id}"]`);
  await assertFieldsMatchState(`after restoring editor ${id}`);
  if (id === 201601) {
    assert.equal(await page.inputValue('[data-target-stars="201601"]'), '3');
    assert.equal(await page.inputValue('[data-lineage-p="201601"][data-side="p1"]'), '5');
  }
  await page.click(`[data-target-role="preferred"][data-id="${id}"]`);
  await assertFieldsMatchState(`after making ${id} preferred`);
}
assert.equal(await page.locator('[data-required-count]').innerText(), '0 required');
assert.equal(await page.locator('[data-goal-issues]').count(), 0, 'zero required whites is a complete white goal');
await page.click('[data-target-role="required"][data-id="200472"]');
await assertFieldsMatchState('after selecting one required white');
assert.equal(await page.locator('[data-pink-lineage], [data-pink-lineage-stars]').count(), 0);
// layout check: no horizontal overflow at common widths, both themes
for (const width of [390, 768, 1280, 1440, 1680, 1920]) {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(100);
    const sparkBars = await page.locator('meter.bar').evaluateAll((bars) => bars.map((bar) => ({ left: bar.getBoundingClientRect().left, right: bar.getBoundingClientRect().right })));
    assert.ok(sparkBars.length > 1, 'ranking has bars to compare');
    assert.ok(sparkBars.every((bar) => Math.abs(bar.left - sparkBars[0].left) < 0.5 && Math.abs(bar.right - sparkBars[0].right) < 0.5), `added spark bars should align at ${width}px ${scheme}`);
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
