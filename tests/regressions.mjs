// Browser regressions use fresh storage and the same controls a player uses. They also run against a production build.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, after } from 'node:test';
import { chromium } from 'playwright';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { loadData } from '../src/data.ts';
import { defaultState, STATE_KEY } from '../src/state.ts';
import { assertFieldsMatchState, waitForPlan } from './browser-fields.mjs';
import { holdSearch } from './browser-search.mjs';
import { defaultParentSparks } from '../src/model/inherit.ts';
import { encodeShare, decodeShare, sharedChoices, shareUrl } from '../src/share.ts';
import { planRun } from '../src/model/run.ts';

const data = loadData();
const browser = await chromium.launch();
const url = process.env.URL ?? 'http://localhost:5173/';
after(() => browser.close());

async function fresh(t, saved, { held = false, settle = !held, touch = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: touch, isMobile: touch });
  t.after(() => context.close());
  if (saved) await context.addInitScript(({ key, saved }) => {
    if (!localStorage.getItem('regression-seeded')) {
      localStorage.setItem(key, JSON.stringify(saved));
      localStorage.setItem('regression-seeded', '1');
    }
  }, { key: STATE_KEY, saved });
  const page = await context.newPage();
  if (held) await holdSearch(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (e) => { if (e.type() === 'error') errors.push(e.text()); });
  t.after(() => assert.deepEqual(errors, [], 'browser errors'));
  await page.goto(url);
  await page.waitForSelector('#target-search');
  if (settle) await waitForPlan(page);
  return page;
}
const editor = (t, saved) => fresh(t, saved, { held: true });
const state = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
async function discardRecommendation(page) {
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key));
    delete saved.recommendation;
    localStorage.setItem(key, JSON.stringify(saved));
  }, STATE_KEY);
}

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
const predictions = (page) => page.locator('h2', { hasText: 'Predicted run' });
/** The app's own <dialog> replaces window.confirm and alert. */
const confirmDialog = async (page) => { await page.waitForSelector('dialog[data-dialog][open]'); await page.click('[data-dialog-confirm]'); };
const openAgenda = (page) => page.click('details[data-agenda] > summary');

test('Basis labels distinguish observations, adjusted observations and model estimates without growing the row', async (t) => {
  const page = await editor(t, defaultState(data));
  const observed = page.locator('[data-basis="30028"]');
  const basisTip = (id) => page.locator(`[data-basis="${id}"] .tip`).getAttribute('data-tip');
  const rowHeight = () => observed.locator('xpath=ancestor::tr').boundingBox().then((box) => box.height);
  assert.equal(await observed.locator('[data-basis-label]').innerText(), 'Observed · LB4');
  await observed.locator('.tip').focus();
  const tooltip = page.locator('#tooltip.show');
  assert.match(await tooltip.innerText(), /community results at LB4 from at least 10 logged runs/);
  assert.match(await tooltip.innerText(), /Not separately modelled: .*Race Bonus \(stats, SP\)/);
  assert.ok(await rowHeight() < 60, 'the Basis tip does not change the row height');
  assert.match(await page.locator('.ranking-table th', { hasText: 'Basis' }).locator('.tip').getAttribute('data-tip'), /scales card stats and SP to your .*race schedule/);
  await assertFieldsMatchState(page, 'after focusing an observed Basis label');

  await page.locator('.ranking-table [data-lb="30028"]').selectOption('2');
  assert.equal(await observed.locator('[data-basis-label]').innerText(), 'Adjusted · from LB3');
  assert.match(await basisTip(30028), /Estimates LB2.*between LB3 and LB2/);
  await assertFieldsMatchState(page, 'after changing the Basis observation limit break');

  const model = page.locator('[data-basis="30146"]');
  assert.equal(await model.locator('[data-basis-label]').innerText(), 'Model estimate');
  const modelTip = await basisTip(30146);
  assert.match(modelTip, /No qualifying recorded results/);
  assert.match(modelTip, /Not in formula: .*Race Bonus \(stats, SP\)/);
  assert.match(modelTip, /Team effect estimated.*: Unique effect "All support cards gain Initial Friendship Gauge \(5\)" \(stats, SP\)/);
  assert.equal(await model.locator('[data-formula-coverage]').count(), 0, 'a card the formula partly covers carries no warning tag');

  const textOnly = page.locator('[data-basis="30080"]');
  assert.equal(await textOnly.locator('[data-formula-coverage]').innerText(), 'Not evaluated');
  assert.match(await basisTip(30080), /Not evaluated: Unique effect "Sasami Anshinzawa random events are more likely to occur"/);
  await textOnly.locator('.tip').click();
  assert.match(await tooltip.innerText(), /Sasami Anshinzawa/);
  assert.ok(await rowHeight() < 60, 'a pinned Basis tip does not change the row height');
  await assertFieldsMatchState(page, 'after pinning the Basis tip of an imported text-only unique');
});

test('effect warnings respect unique unlocks and explain observed deck effects on mobile', async (t) => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  saved.run.pinnedIds = [30088, 30146];
  saved.inventory[30088] = 0;
  const page = await fresh(t, saved, { held: true, touch: true });
  await page.setViewportSize({ width: 390, height: 900 });
  const basis = page.locator('[data-basis="30088"]');
  assert.doesNotMatch(await basis.locator('.tip').getAttribute('data-tip'), /Unique effect/, 'locked unique is not listed');
  await basis.locator('.tip').tap();
  assert.match(await page.locator('#tooltip.show').innerText(), /Not separately modelled/);
  await assertFieldsMatchState(page, 'after pinning a Basis tip on mobile');

  await page.locator('.ranking-table [data-lb="30088"]').selectOption('4');
  assert.equal(await basis.locator('[data-basis-label]').innerText(), 'Observed · LB4');
  assert.match(await basis.locator('.tip').getAttribute('data-tip'), /Fixed at the recorded deck conditions: Unique effect "If there are at least 4 different types/);
  await assertFieldsMatchState(page, 'after unlocking an observed deck effect');

  const limitations = page.locator('[data-estimate-limitations]');
  await limitations.locator('summary').tap();
  const oguri = limitations.locator('[data-card-limitations="30146"]');
  assert.match(await oguri.innerText(), /Oguri Cap/);
  assert.match(await oguri.innerText(), /Initial Friendship Gauge/);
  assert.match(await oguri.innerText(), /team effect has not been measured directly/);
  assert.match(await limitations.locator('[data-card-limitations="30088"]').innerText(), /recorded contribution stays fixed/);
  await assertFieldsMatchState(page, 'after opening deck limitations on mobile');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, 'open explanations do not overflow the phone viewport');
});

test('Light Hello uses repaired community measurements and separates formula omissions from recorded results', async (t) => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  saved.run.pinnedIds = [30052];
  const page = await editor(t, saved);
  const basis = page.locator('[data-basis="30052"]');
  assert.equal(await basis.locator('[data-basis-label]').innerText(), 'Observed · LB4');
  const measured = await basis.locator('.tip').getAttribute('data-tip');
  assert.match(measured, /community results at LB4 from at least 50 logged runs/);
  assert.match(measured, /Not separately modelled: .*Unique effect "Gain Energy Cost Reduction \(30\)/);
  assert.doesNotMatch(measured, /Not in formula/, 'a recorded contribution already includes its omitted effects');
  const scoring = page.locator('details.about', { hasText: 'How cards are scored' });
  await scoring.locator('summary').click();
  assert.match(await scoring.innerText(), /already include effects the formula cannot separate/);
  await assertFieldsMatchState(page, 'after reading Light Hello\'s measured contribution');

  await page.locator('[data-estimate-limitations] > summary').click();
  const deckNote = page.locator('[data-card-limitations="30052"]');
  assert.match(await deckNote.innerText(), /Observed · LB4/);
  assert.match(await deckNote.innerText(), /Not separately modelled/);
  assert.match(await deckNote.innerText(), /Recorded stats and SP can already include these effects/);
  await assertFieldsMatchState(page, 'after reading Light Hello\'s formula limitations');

  await page.locator('.ranking-table [data-lb="30052"]').selectOption('0');
  assert.equal(await basis.locator('[data-basis-label]').innerText(), 'Adjusted · from LB1');
  assert.match(await basis.locator('.tip').getAttribute('data-tip'), /Not separately modelled/);
  await assertFieldsMatchState(page, 'after adjusting Light Hello from a measured limit break');
});

test('rejected advanced settings retain the draft and accept the original value', async (t) => {
  const page = await editor(t, defaultState(data));
  await page.click('details[data-details="advanced"] > summary');
  for (const [key, selector, rejected] of [
    ['hintBase', '[data-setting="hintBase"]', '-1'],
    ['chainRatesSSR', '[data-setting-list="chainRatesSSR"]', '1, 2'],
  ]) {
    const original = await page.inputValue(selector);
    const saved = (await state(page)).settings[key];
    await page.fill(selector, rejected);
    await page.locator(selector).press('Tab');
    assert.equal(await page.inputValue(selector), rejected);
    assert.equal(await page.locator(selector).getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator(`[data-setting-error="${key}"]`).count(), 1);
    assert.deepEqual((await state(page)).settings[key], saved);
    await assertFieldsMatchState(page, 'after rejecting an advanced setting');
    await page.fill(selector, original);
    await page.locator(selector).press('Tab');
    assert.equal(await page.inputValue(selector), original);
    assert.equal(await page.locator(selector).getAttribute('aria-invalid'), null);
    assert.equal(await page.locator(`[data-setting-error="${key}"]`).count(), 0);
    assert.deepEqual((await state(page)).settings[key], saved);
    await assertFieldsMatchState(page, 'after restoring the original advanced setting');
  }
});

test('outside clicks dismiss suggestions without clearing search text', async (t) => {
  const page = await editor(t);
  const queries = { 'trainee-search': 'special', 'target-search': 'groundwork', 'card-search': 'a' };
  for (const [id, query] of Object.entries(queries)) await page.fill(`#${id}`, query);
  await page.locator('h1').click();
  for (const [id, query] of Object.entries(queries)) {
    assert.equal(await page.inputValue(`#${id}`), query);
    assert.equal(await page.locator(`#${id}`).getAttribute('aria-expanded'), 'false');
  }
  await assertFieldsMatchState(page, 'after dismissing suggestions');
  await page.click('#target-search');
  assert.equal(await page.locator('#target-search').getAttribute('aria-expanded'), 'true');
  await page.press('#target-search', 'Enter');
  assert.equal((await state(page)).run.targets.length, 1);
  await assertFieldsMatchState(page, 'after picking from a preserved search');
});

test('overlapping dialogs settle each request independently', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const source = await readFile(new URL('../src/ui/dialog.ts', import.meta.url), 'utf8');
  const { outputText } = transpileModule(source, { compilerOptions: { target: ScriptTarget.ESNext, module: ModuleKind.ESNext } });
  await page.addScriptTag({ type: 'module', content: `${outputText}\nwindow.confirmDialog = confirmDialog;` });
  await page.evaluate(() => {
    window.answers = [];
    window.confirmDialog('First').then((ok) => window.answers.push(['first', ok]));
    window.confirmDialog('Second').then((ok) => window.answers.push(['second', ok]));
  });
  await page.waitForFunction(() => window.answers.length === 1, undefined, { timeout: 2000 });
  assert.deepEqual(await page.evaluate(() => window.answers), [['first', false]]);
  assert.equal(await page.locator('dialog[open] [data-dialog-message]').textContent(), 'Second');
  await page.click('dialog[open] [data-dialog-confirm]');
  await page.waitForFunction(() => window.answers.length === 2, undefined, { timeout: 2000 });
  assert.deepEqual(await page.evaluate(() => window.answers), [['first', false], ['second', true]]);
  await page.evaluate(() => {
    window.answers = [];
    window.confirmDialog('Third').then((ok) => window.answers.push(['third', ok]));
    document.querySelector('dialog[open] [data-dialog-confirm]').click();
    window.confirmDialog('Fourth').then((ok) => window.answers.push(['fourth', ok]));
  });
  await page.waitForFunction(() => window.answers.length === 1, undefined, { timeout: 2000 });
  assert.deepEqual(await page.evaluate(() => window.answers), [['third', true]]);
  await page.press('dialog[open]', 'Escape');
  await page.waitForFunction(() => window.answers.length === 2, undefined, { timeout: 2000 });
  assert.deepEqual(await page.evaluate(() => window.answers), [['third', true], ['fourth', false]]);
});

test('phone ranking reveals controls and spark chances when scrolled sideways', async (t) => {
  const saved = defaultState(data);
  saved.run.targets = [{ id: 200352, role: 'preferred', stars: 2, priority: 0 }];
  const page = await editor(t, saved);
  await page.setViewportSize({ width: 390, height: 844 });
  const row = page.locator('.ranking-table tbody tr').first();
  assert.ok(await row.locator('[data-target-spark]').count(), 'the row has a spark chance to read');
  const lb = row.locator('[data-lb]');
  const id = await lb.getAttribute('data-lb');
  for (const field of [lb, row.locator('[data-target-chances]')]) {
    await field.scrollIntoViewIfNeeded();
    assert.equal(await field.evaluate((el) => {
      const scroll = el.closest('.scroll');
      scroll.scrollLeft += el.getBoundingClientRect().left - scroll.getBoundingClientRect().left - 8;
      const r = el.getBoundingClientRect();
      return [r.left + 2, (r.left + r.right) / 2, r.right - 2].every((x) => el.contains(document.elementFromPoint(x, (r.top + r.bottom) / 2)));
    }), true, 'the full control or chance cell is visible and uncovered');
  }
  await lb.selectOption('2');
  assert.equal((await state(page)).inventory[id], 2);
  await assertFieldsMatchState(page, 'after editing inventory through the phone ranking');
});

test('search boxes keep keyboard selections separate when focus switches', async (t) => {
  const page = await editor(t);
  await page.fill('#target-search', 'groundwork');
  const targetId = Number(await page.locator('#target-search-list li').first().getAttribute('data-id'));
  await page.fill('#card-search', 'a');
  for (let i = 0; i < 10; i++) await page.press('#card-search', 'ArrowDown');
  assert.equal(await page.locator('#target-search').getAttribute('aria-expanded'), 'false');
  await page.click('#target-search');
  assert.equal(await page.locator('#card-search').getAttribute('aria-expanded'), 'false');
  await page.press('#target-search', 'Enter');
  assert.ok((await state(page)).run.targets.some((entry) => entry.id === targetId));
  await assertFieldsMatchState(page, 'after selecting a target following a card search');
  await page.focus('#card-search');
  await page.fill('#card-search', 'piece of mind');
  const cardId = Number(await page.locator('#card-search-list li').first().getAttribute('data-id'));
  await page.press('#card-search', 'Enter');
  assert.ok((await state(page)).run.pinnedIds.includes(cardId));
  await assertFieldsMatchState(page, 'after narrowing a highlighted card search');
});

test('search keyboard navigation reveals active rows without moving the page', async (t) => {
  const page = await editor(t);
  await page.fill('#card-search', 'a');
  const before = await page.evaluate(() => scrollY);
  const count = await page.locator('#card-search-list li').count();
  const check = async (index) => {
    assert.equal(await page.locator('#card-search').getAttribute('aria-activedescendant'), `card-search-list-${index}`);
    assert.equal(await page.locator('#card-search-list').evaluate((list) => {
      const row = list.querySelector('[aria-selected="true"]');
      const r = row.getBoundingClientRect(), bounds = list.getBoundingClientRect();
      return r.top >= bounds.top + list.clientTop - 1 && r.bottom <= bounds.top + list.clientTop + list.clientHeight + 1;
    }), true, 'the active suggestion is inside the visible list');
    assert.equal(await page.evaluate(() => scrollY), before, 'only the suggestion list scrolls');
  };
  for (let i = 0; i < count; i++) { await page.press('#card-search', 'ArrowDown'); await check(i); }
  await page.press('#card-search', 'ArrowDown'); await check(0);
  await page.press('#card-search', 'ArrowUp'); await check(count - 1);
  await page.press('#card-search', 'Escape');
  assert.equal(await page.inputValue('#card-search'), '');
  await page.fill('#card-search', 'a');
  await page.press('#card-search', 'ArrowUp'); await check(count - 1);
  await assertFieldsMatchState(page, 'after keyboard navigation and wrapping in suggestions');
});

test('touch help icons stay pinned without activating labels or disclosures', async (t) => {
  const page = await fresh(t, undefined, { held: true, touch: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const focus = page.locator('label.row').filter({ has: page.locator('[data-setting="focus"]') }).locator('.tip');
  const advanced = page.locator('[data-details="advanced"]');
  for (const icon of [focus, advanced.locator('summary .tip')]) {
    await icon.tap();
    assert.equal(await page.locator('#tooltip').isVisible(), true);
    assert.equal(await icon.evaluate((el) => el.classList.contains('pinned')), true);
    assert.equal(await page.locator('[data-setting="focus"]').evaluate((el) => el === document.activeElement), false);
    assert.equal(await advanced.evaluate((el) => el.open), false);
    await icon.tap();
    assert.equal(await page.locator('#tooltip').isVisible(), false);
  }
  await page.locator('[data-action="reset-all"]').tap();
  assert.equal(await page.locator('dialog[open]').count(), 1, 'ordinary buttons retain their action');
  await page.locator('[data-dialog-cancel]').tap();
  await assertFieldsMatchState(page, 'after touch help and canceling reset');
});

test('ranking expands all target chances and keeps the last target reachable on phones', async (t) => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  // Breakaway Battleship Gold Ship offers these 18 target families through hints and events.
  saved.run.targets = [200622, 200642, 200752, 201212, 201232, 201472, 201482, 201502, 201512,
    201552, 201581, 201591, 201601, 201631, 202022, 200342, 202032, 200052]
    .map((id) => ({ id, role: 'preferred', stars: 2, priority: 0 }));
  const page = await editor(t, saved);
  const row = page.locator('tr').filter({ has: page.locator('[data-lb="30004"]') });
  const more = row.locator('[data-target-more]');
  for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 844 });
    await page.click(`[data-theme-pick="${theme}"]`);
    assert.equal(await row.locator('[data-target-spark]:visible').count(), 4);
    assert.equal(await more.getAttribute('aria-expanded'), 'false');
    assert.equal(await more.getAttribute('data-tip'), null);
    await more.focus();
    await page.keyboard.press('Enter');
    assert.equal(await more.getAttribute('aria-expanded'), 'true');
    assert.equal(await more.innerText(), 'Show fewer');
    assert.equal(await row.locator('[data-target-spark]:visible').count(), 18);
    // A persisted presentation change must not collapse the card's transient expansion.
    await page.click('[data-sort="sp"]');
    assert.equal(await row.locator('[data-target-spark]:visible').count(), 18);
    const last = row.locator('[data-target-spark="200052"]');
    assert.match(await last.innerText(), /Hanshin Racecourse/);
    await last.locator('.tip').focus();
    assert.equal(await last.evaluate((el) => {
      const rect = el.getBoundingClientRect(), scroll = el.closest('.scroll').getBoundingClientRect();
      return rect.top >= Math.max(0, scroll.top) && rect.bottom <= Math.min(innerHeight, scroll.bottom);
    }), true, `last target is reachable at ${width}px in ${theme}`);
    assert.match(await page.locator('#tooltip').innerText(), /Hanshin Racecourse/);
    await more.focus();
    await page.keyboard.press('Space');
    assert.equal(await more.getAttribute('aria-expanded'), 'false');
    assert.equal(await row.locator('[data-target-spark]:visible').count(), 4);
    await assertFieldsMatchState(page, `after expanding and collapsing targets at ${width}px in ${theme}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  assert.deepEqual((await state(page)).run, saved.run, 'expansion preserves run inputs');
});

// A Fuji Kiseki player reported this six-card deck, Maruzensky borrowed, for a required Groundwork spark. Evaluating it
// as a fixed selection gives the displayed chance the search must reach without being told to pin Maruzensky.
const FUJI_DECK = [30017, 30107, 30052, 30020, 30078, 30083].map((id, i) => ({ id, lb: 4, borrowed: i === 0 }));
const fujiState = () => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100501;
  saved.run.targets = [{ id: 201601, role: 'required', stars: 2, priority: 0 }];
  saved.inventory['30017'] = null;
  return saved;
};
const fujiReferencePercent = (saved) => planRun(saved.run, saved.settings, saved.inventory, data, { selection: FUJI_DECK, search: false }).goalEstimate.probability * 100;

test('the deck stays mounted during search and edits update its estimates immediately', async (t) => {
  const saved = fujiState();
  saved.run.goal.pink = [{ aptitude: 'any', stars: 2 }];
  const reference = fujiReferencePercent(saved);
  const page = await fresh(t, saved, { settle: false });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const chance = async () => parseFloat((await page.locator('[data-goal-probability]').innerText()).split('\n')[0]);
  await page.waitForSelector('[data-plan-pending]', { state: 'attached' });
  const head = page.locator('.panel-head').filter({ has: page.getByRole('heading', { name: 'Suggested deck', exact: true }) });
  const spinner = await head.evaluate((el) => {
    const style = getComputedStyle(el, '::before');
    return { width: style.width, transform: style.transform };
  });
  assert.equal(spinner.width, '22px');
  assert.notEqual(spinner.transform, 'none');
  await page.waitForFunction((before) => {
    const heading = [...document.querySelectorAll('.panel-head')].find((el) => el.querySelector('h2')?.textContent === 'Suggested deck');
    return heading && getComputedStyle(heading, '::before').transform !== before;
  }, spinner.transform);
  assert.equal(await page.getByText('Looking for a better deck… The recommendation below is fully checked for your current inputs.', { exact: true }).count(), 0);
  assert.equal(await page.locator('.deck .slot').count(), 6);
  const initial = await chance();
  assert.ok(initial > 0);
  await waitForPlan(page);
  assert.equal(await head.evaluate((el) => getComputedStyle(el, '::before').content), 'none');
  const finished = await chance();
  assert.ok(finished >= initial && finished >= reference - 0.05, `find the known better Fuji deck without a Maruzensky pin: ${finished}% shown against ${reference}%`);
  await page.evaluate(() => { window.retainedDeck = document.querySelector('.deck'); window.retainedList = document.querySelector('.wishlist'); });
  await page.selectOption('[data-goal-stars="pink"]', '3');
  await page.waitForSelector('[data-plan-pending]', { state: 'attached' });
  assert.ok(await chance() < 1, 'the intermediate estimate uses the new pink requirement');
  await page.selectOption('[data-goal-stars="pink"]', '2');
  assert.equal(await page.locator('[data-goal-result]').count(), 1, 'current estimates remain visible after an edit');
  assert.equal(await page.evaluate(() => window.retainedDeck === document.querySelector('.deck') && window.retainedList === document.querySelector('.wishlist')), true, 'deck and skill editor remain mounted');
  await waitForPlan(page);
  assert.ok(await chance() >= finished, 'a previously discovered legal deck remains a candidate after edits');
  await assertFieldsMatchState(page, 'after replacing a refinement in progress');
});

test('a failed refinement preserves the checked deck and can be retried', async (t) => {
  const saved = fujiState();
  const reference = fujiReferencePercent(saved);
  const page = await fresh(t, saved);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    let failed = false;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', (event) => {
          if (event.data.complete || failed) return;
          failed = true;
          setTimeout(() => {
            this.terminate();
            this.dispatchEvent(new MessageEvent('message', { data: { id: event.data.id, complete: true, error: 'Injected refinement failure' } }));
          }, 0);
        });
      }
    };
  });
  await discardRecommendation(page);
  await page.reload();
  await page.waitForSelector('[data-action="retry-search"]');
  assert.match(await page.locator('[role="alert"]').innerText(), /displayed deck's estimates match your current inputs/);
  assert.equal(await page.locator('.deck .slot').count(), 6);
  assert.ok(parseFloat(await page.locator('[data-goal-probability]').innerText()) > 0);
  assert.deepEqual((await state(page)).run.targets, saved.run.targets);
  await page.click('[data-action="retry-search"]');
  await waitForPlan(page);
  assert.equal(await page.locator('[data-action="retry-search"]').count(), 0);
  assert.ok(parseFloat(await page.locator('[data-goal-probability]').innerText()) >= reference - 0.05, 'the retried search reaches the reported deck');
  await assertFieldsMatchState(page, 'after retrying a failed refinement');
});

test('search stays responsive, ignores obsolete results, and persists the tie setting', async (t) => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  const page = await fresh(t, saved, { settle: false });
  assert.equal(await page.locator('[data-plan-pending]').count(), 1);
  assert.equal(await page.locator('[data-goal-result]').count(), 1, 'the displayed deck has current estimates during search');
  assert.equal(await page.locator('.deck .slot').count(), 6);
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

test('editing waits for a pause, ignores intermediate and cancelled results, and keeps the phone editor in place', async (t) => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100501;
  saved.run.targets = [{ id: 201601, role: 'required', stars: 2, priority: 0 }];
  saved.inventory['30017'] = null;
  const page = await fresh(t, saved, { settle: false });
  await waitForPlan(page);
  await page.addInitScript(() => {
    window.searchWorkers = [];
    window.Worker = class {
      constructor() { window.searchWorkers.push(this); }
      postMessage(request) { this.request = request; }
      terminate() { this.terminated = true; }
      deliver(selection, complete = true) { this.onmessage({ data: { id: this.request.id, selection, complete } }); }
    };
  });
  await discardRecommendation(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForFunction(() => window.searchWorkers.length === 1);
  const cards = () => page.locator('.deck .card-link').evaluateAll((els) => els.map((el) => el.getAttribute('href')));
  const original = await cards();
  const alternative = [30017, 30107, 30052, 30020, 30078, 30083].map((id, i) => ({ id, lb: 4, borrowed: i === 0 }));
  await page.evaluate((selection) => window.searchWorkers[0].deliver(selection, false), alternative);
  assert.deepEqual(await cards(), original, 'the first search stage does not replace the deck');
  await page.evaluate(() => { window.retainedDeck = document.querySelector('.deck'); window.retainedList = document.querySelector('.wishlist'); });
  const heading = page.locator('h2').filter({ hasText: 'Prioritized skills' });
  await heading.scrollIntoViewIfNeeded();
  const position = () => heading.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  const before = await position();
  await page.locator('[data-action="wl-down"]:not([disabled])').first().click();
  assert.ok(Math.abs(await position() - before) <= 1, 'reordering does not collapse the content above the editor');
  await page.evaluate(() => {
    const field = document.querySelector('[data-goal-stars="pink"]');
    for (const value of ['3', '1', '2']) { field.value = value; field.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  assert.equal(await page.evaluate(() => window.searchWorkers.length), 1, 'rapid edits wait before starting another worker');
  assert.equal(await page.evaluate(() => window.searchWorkers[0].terminated), true);
  await page.waitForFunction(() => window.searchWorkers.length === 2);
  assert.equal(await page.evaluate(() => window.searchWorkers[1].request.run.goal.pink[0].stars), 2);
  await page.evaluate((selection) => window.searchWorkers[0].deliver(selection), alternative);
  assert.deepEqual(await cards(), original, 'a cancelled search cannot publish a late result');
  assert.equal(await page.evaluate(() => window.retainedDeck === document.querySelector('.deck') && window.retainedList === document.querySelector('.wishlist')), true);
  const retainedControl = page.locator('[data-action="wl-exclude"][data-id="201601"]');
  await retainedControl.evaluate((el) => { el.focus({ preventScroll: true }); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 200); });
  await page.waitForTimeout(220);
  const anchorBefore = await retainedControl.evaluate((el) => ({ viewport: el.getBoundingClientRect().top, document: el.getBoundingClientRect().top + scrollY }));
  await page.evaluate((selection) => window.searchWorkers[1].deliver(selection), alternative);
  await waitForPlan(page);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const anchorAfter = await retainedControl.evaluate((el) => ({ viewport: el.getBoundingClientRect().top, document: el.getBoundingClientRect().top + scrollY }));
  assert.ok(Math.abs(anchorAfter.document - anchorBefore.document) > 20, 'the final deck changes the content height above the skill');
  assert.ok(Math.abs(anchorAfter.viewport - anchorBefore.viewport) <= 1, 'the skill control stays at the same screen position');
  assert.notDeepEqual(await cards(), original, 'the final result replaces the cards once');
  assert.equal(await page.locator('.deck .slot').count(), 6);
  await assertFieldsMatchState(page, 'after debounced search and skill reordering');
});

test('required skill priority is visible and exclusions leave the displayed order intact', async (t) => {
  const saved = defaultState(data);
  const focus = data.skills.find((s) => s.name === 'Focus');
  const falcon = data.cards.find((c) => c.charName === 'Smart Falcon' && c.rarity === 'SSR' && c.type === 'power');
  saved.run.traineeCardId = 100101;
  saved.run.pinnedIds.push(falcon.id);
  saved.run.targets = [{ id: 201601, role: 'required', stars: 2, priority: 0 }, { id: focus.id, role: 'preferred', stars: 2, priority: 0 }];
  saved.run.wishlistOrder = [focus.id, 201601];
  const page = await editor(t, saved);
  assert.equal(await page.locator('.wishlist li').first().getAttribute('data-wl-key'), '201601');
  assert.match(await page.locator('.wishlist li').first().innerText(), /required/);
  assert.deepEqual((await state(page)).run.wishlistOrder, saved.run.wishlistOrder);
  assert.equal(await page.locator('[data-action="wl-export"]').count(), 0, 'the list has no export button');
  await page.click('[data-action="wl-exclude"][data-id="201601"]');
  assert.match(await page.locator('[data-priority-conflict]').innerText(), /Groundwork is required but excluded/);
  assert.equal(await page.locator('.wishlist [data-wl-key="201601"]').count(), 0);
  assert.match(await page.locator('.wishlist li').first().innerText(), /Focus/, 'the preferred skill moves to the top once the required one is excluded');
  await assertFieldsMatchState(page, 'after excluding the required skill');
});

test('the first reset clears targets, trainee, pins and inheritance while preserving settings and inventory', async (t) => {
  const page = await editor(t);
  await target(page, 'Groundwork');
  await trainee(page);
  await pin(page, 'fire at my heels');
  await page.selectOption('[data-gain="0-0"]', '63');
  await page.selectOption('[data-setting="focus"]', 'sprint');
  await page.setInputFiles('#import-file', inventoryFile({ 30028: 2 }));
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).inventory['30028'] === 2, STATE_KEY);
  await page.click('[data-action="reset-all"]');
  await confirmDialog(page);
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).run.traineeCardId === null, STATE_KEY);
  assert.equal(await page.locator('.target-row').count(), 0);
  const saved = await state(page);
  assert.deepEqual(saved.run.targets, []);
  assert.deepEqual(saved.run.parentSparks, [[null, null, null], [null, null, null]]);
  assert.deepEqual(saved.run.pinnedIds, [30052]);
  assert.equal(saved.settings.focus, 'stamina', 'Reset all returns the training focus to its default');
  assert.equal(saved.inventory['30028'], 2);
});

test('ranking pins persist and an unowned pin requests a borrowed card', async (t) => {
  const saved = defaultState(data);
  saved.inventory['30028'] = null;
  saved.ui.showUnowned = true;
  const page = await editor(t, saved);
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
  const page = await editor(t);
  await target(page, 'Corner Recovery');
  await pin(page, 'piece of mind');
  await page.click('[data-details="advanced"] > summary');
  const gold = coverage(page, 'Corner Recovery').locator('td').nth(1);
  assert.notEqual(await gold.innerText(), '100.0%');
  await page.fill('[data-setting-list="chainRatesSSR"]', '1,1,1');
  await page.locator('[data-setting-list="chainRatesSSR"]').press('Tab');
  assert.equal(await gold.innerText(), '100.0%');
  assert.equal(await coverage(page, 'Corner Recovery').locator('td').nth(3).innerText(), '40.0%');
  const before = await coverage(page, 'Corner Recovery').innerText();
  await page.reload();
  assert.equal(await coverage(page, 'Corner Recovery').innerText(), before);
});

test('Narita Brian displays one race per occupied slot and counts each goal once', async (t) => {
  const page = await editor(t);
  await trainee(page, 'narita brian maverick');
  const heading = await page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'G1 agenda', exact: true }) }).locator('[data-panel-sub]').innerText();
  assert.match(heading, /18 races.*11 career goals/);
  await openAgenda(page);
  assert.equal(await page.locator('.agenda-cell.sel').count(), 18);
  assert.equal(Number(heading.match(/^(\d+) races/)[1]), await page.locator('.agenda-cell.sel').count());
});

test('skill advice includes prerequisite costs and buyable circle upgrades', async (t) => {
  const page = await editor(t);
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

test('a fresh visit shows a general starting deck without prototype controls or borrow prose', async (t) => {
  const page = await editor(t);
  assert.equal(await page.locator('.deck .slot').count(), 6);
  assert.equal(await page.locator('.deck .slot').filter({ hasText: /Maruzensky|Smart Falcon/ }).count(), 0);
  assert.equal(await page.locator('.deck .tag.borrow').count(), 1, 'the borrowed card still has its badge');
  assert.equal(await page.locator('[data-goal-borrow]').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Search again', exact: true }).count(), 0);
  assert.equal(await page.getByText('Complete the required inputs to search.', { exact: true }).count(), 0);
  assert.equal(await page.inputValue('#trainee-search'), '');
  assert.equal(await page.locator('.target-row').count(), 0);
  await assertFieldsMatchState(page, 'general starting deck');
});

test('inherited Corner Recovery and Lucky Seven hints do not gain fictitious circle upgrades', async (t) => {
  const saved = defaultState(data);
  saved.run.targets = [200352, 201562, 200012, 201032];
  saved.run.targetLineage = Object.fromEntries(saved.run.targets.map((id) => [id, { k1: 1, p1: 3, k2: 0, p2: 0 }]));
  // Isolate inherited hints while still building a complete deck through the regular UI.
  Object.assign(saved.settings, { hintBase: 0, chainRatesSSR: [0, 0, 0], chainRatesSR: [0, 0], randomEventRate: 0,
    palChainRate: 0, groupOutingRate: 0, groupFinaleRate: 0, specialEventRate: 0 });
  const page = await editor(t, saved);
  // one 3★ copy: 9% per inspiration event at affinity 150 is 22.5%, so 39.9% over two events
  for (const [name, spark] of [['Corner Recovery', '8.8%'], ['Lucky Seven', '8.8%'], ['Right-Handed', '11.0%'], ['Mile Straightaways', '11.0%']]) {
    const row = coverage(page, name);
    assert.equal(await row.locator('td').nth(1).innerText(), '0%');
    assert.equal(await row.locator('td').nth(2).innerText(), '39.9%');
    assert.equal(await row.locator('td').nth(3).innerText(), spark, name);
    assert.match(await row.locator('td').nth(4).innerText(), /Lineage/);
  }
  assert.match(await page.locator('div.small').filter({ hasText: /^Worst-case target SP cost:/ }).innerText(), /690 of/);
  assert.equal(await predictions(page).count(), 1);
});

test('start gains share a side\'s three umas: a bigger gain takes the weakest umas from the other stats, and the sparks persist', async (t) => {
  const page = await editor(t);
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
  const page = await editor(t, saved);
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
  const page = await editor(t, saved);
  assert.equal(await page.locator('[data-plan-issues]').count(), 0);
  assert.equal(await predictions(page).count(), 1);
  assert.deepEqual(await page.$$eval('[data-gain]', (els) => els.map((e) => e.value)), ['0', '0', '0', '0', '0', '0', '0', '0', '0', '63'], 'side 1 is empty, side 2 keeps its three 3★ Wit');
  await page.selectOption('[data-gain="1-3"]', '5');
  assert.deepEqual((await state(page)).run.parentSparks, [defaultParentSparks(), [{ stat: 'wit', stars: 3 }, { stat: 'wit', stars: 3 }, { stat: 'guts', stars: 1 }]], 'the next edit saves the repaired side 1 along with the change on side 2');
});

test('invalid inventory imports preserve inventory, while valid export and import round-trip', async (t) => {
  const page = await editor(t);
  await page.setInputFiles('#import-file', inventoryFile({ 30052: null, 30028: 2, 20009: 0 }));
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).inventory['30052'] === null, STATE_KEY);
  const before = (await state(page)).inventory;
  for (const value of [{ garbage: 'data' }, [], { 30052: 4, 30028: 7 }]) {
    await page.setInputFiles('#import-file', inventoryFile(value));
    await page.waitForSelector('dialog[data-dialog][open]');
    assert.match(await page.locator('[data-dialog-message]').innerText(), /Import failed/);
    await page.click('[data-dialog-confirm]');
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
  const page = await editor(t);
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
  await waitForPlan(page);
  const probability = await page.locator('[data-goal-probability]').innerText();
  await page.reload();
  await page.waitForSelector('[data-goal-result]');
  assert.equal(await page.locator('[data-goal-probability]').innerText(), probability);
  await page.selectOption('[data-apt="end"]', 'C');
  assert.equal(await page.locator('[data-goal-warnings]').count(), 0);
  assert.match(await page.locator('[data-goal-probability]').innerText(), /%/);
});

test('chip selection toggles its editor and removal updates goals without activating another chip', async (t) => {
  const page = await editor(t);
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
  const page = await editor(t);
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
  await page.click('[data-action="reset-all"]');
  await confirmDialog(page);
  assert.equal(await page.locator('[data-goal-enabled]').count(), 0);
  assert.equal(await page.inputValue('[data-goal-stars="pink"]'), '1');
  assert.match(await page.locator('[data-goal-issues]').innerText(), /Choose the trainee/);
  await assertFieldsMatchState(page, 'after resetting with automatic goal evaluation');

  const saved = defaultState(data);
  saved.version = 14;
  saved.run.traineeCardId = 100101;
  saved.run.goal = { ...saved.run.goal, enabled: false, pink: 'turf', pinkStars: 3 };
  const restored = await editor(t, saved);
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

test('Any pink defaults to one star, updates estimates, and persists across reload', async (t) => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  const page = await editor(t, saved);
  const pinkRow = page.locator('.goal-breakdown tr').filter({ hasText: 'Pink (' });
  assert.equal(await page.inputValue('[data-goal-pink]'), 'any');
  assert.equal(await page.inputValue('[data-goal-stars="pink"]'), '1');
  assert.match(await pinkRow.innerText(), /100(?:\.0)?%/);
  assert.equal(await page.locator('[data-goal-issues]').count(), 0);
  const chance = await page.locator('[data-goal-probability]').innerText();
  await page.selectOption('[data-goal-stars="pink"]', '3');
  assert.match(await pinkRow.innerText(), /10\.0%/);
  assert.notEqual(await page.locator('[data-goal-probability]').innerText(), chance);
  await page.selectOption('[data-goal-pink]', 'end');
  assert.equal(await page.locator('[data-goal-warnings]').count(), 0);
  assert.match(await page.locator('[data-goal-probability]').innerText(), /%/);
  await page.click('[data-action="reset-pink-goal"]');
  assert.equal(await page.locator('[data-goal-warnings]').count(), 0);
  assert.equal(await page.locator('[data-goal-issues]').count(), 0);
  await page.reload();
  assert.equal(await page.inputValue('[data-goal-pink]'), 'any');
  assert.equal(await page.inputValue('[data-goal-stars="pink"]'), '1');
  assert.match(await pinkRow.innerText(), /100(?:\.0)?%/);
});

test('pink reset clears manual and inferred sparks and starting increases while preserving other inputs', async (t) => {
  const page = await fresh(t);
  await trainee(page);
  await target(page, 'Groundwork');
  await page.selectOption('[data-gain="0-0"]', '63');
  await page.selectOption('[data-apt="end"]', 'A');
  await page.click('[data-action="toggle-pink-sparks"]');
  await page.selectOption('[data-pink-lineage="5"]', 'turf');
  await waitForPlan(page);
  const before = await state(page);
  assert.ok(before.run.pinkLineage.some((p) => p?.inferred));
  assert.ok(before.run.pinkLineage.some((p) => p && !p.inferred));
  await page.click('[data-action="reset-pink-sparks"]');
  const expected = structuredClone(before);
  expected.run.pinkLineage = Array(6).fill(null);
  expected.run.aptOverrides = {};
  await waitForPlan(page);
  const reset = await state(page);
  assert.ok(reset.recommendation);
  assert.deepEqual(JSON.parse(reset.recommendation.key), [reset.run, reset.settings, reset.inventory]);
  expected.recommendation = reset.recommendation;
  assert.deepEqual(reset, expected);
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
  const page = await editor(t, saved);
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
  const pinkProbability = () => page.locator('[data-goal-result] tbody tr').filter({ hasText: /^Pink \(/ }).locator('td').last().innerText();
  const partialPinkProbability = await pinkProbability(), partialRun = (await state(page)).run;
  await page.reload();
  await page.waitForSelector('[data-goal-result]');
  // The pink marginal and saved inputs stay unchanged while search is held pending after reload.
  assert.equal(await pinkProbability(), partialPinkProbability);
  assert.deepEqual((await state(page)).run, partialRun);
  assert.equal(await page.locator('[data-goal-zero]').count(), 0);
  assert.equal(await page.locator('[data-goal-warnings]').count(), 0);
  await toggle.click();
  await assertFieldsMatchState(page, 'after reloading partial pink lineage');
  for (let i = 1; i < 6; i++) await page.selectOption(`[data-pink-lineage="${i}"]`, 'end');
  assert.equal(await page.locator('[data-goal-warnings]').count(), 0);
  await page.selectOption('[data-pink-lineage-stars="0"]', '3');
  assert.equal(await page.locator('[data-goal-issues]').count(), 0);
  assert.equal(await page.locator('[data-goal-zero]').count(), 0);
  assert.equal(await page.inputValue('[data-apt="end"]'), 'A', 'known lineage determines the starting grade');
  const probability = await page.locator('[data-goal-probability]').innerText(), completePinkProbability = await pinkProbability();
  const completeRun = (await state(page)).run, ancestry = completeRun.pinkLineage;
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
  assert.equal(await pinkProbability(), completePinkProbability);
  assert.deepEqual((await state(page)).run, completeRun);
  assert.equal(await page.locator('[data-goal-zero]').count(), 0);
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
  const page = await editor(t);
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
  const page = await editor(t);
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
  const page = await editor(t);
  await trainee(page);
  await page.selectOption('[data-goal-pink]', 'turf');
  await page.click('[data-action="toggle-pink-sparks"]');
  await assertFieldsMatchState(page, 'after opening pink lineage in Legacy');
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
  const page = await editor(t, saved);
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
  const page = await editor(t, saved);
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
  saved.run.goal = { ...saved.run.goal, blueStars: 1, pink: [{ aptitude: 'any', stars: 3 }] };
  const page = await editor(t, saved);
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
  await page.click('[data-action="reset-pink-goal"]');
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
  const page = await editor(t, saved);
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


test('completed recommendations survive reload without a worker, while changed inputs and versions search again', async (t) => {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  saved.run.targets = [{ id: 201601, role: 'required', stars: 2, priority: 0 }];
  saved.inventory['30028'] = null;
  const page = await fresh(t, saved);
  const finished = await state(page);
  assert.ok(finished.recommendation?.summary.evaluated > 0);
  const deck = () => page.locator('.deck .card-link').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  const original = await deck();
  const originalChance = await page.locator('[data-goal-probability]').innerText();
  await page.addInitScript(() => {
    window.searchWorkers = [];
    window.Worker = class {
      constructor() { window.searchWorkers.push(this); }
      postMessage(request) { this.request = request; }
      terminate() { this.terminated = true; }
    };
  });
  await page.reload();
  assert.equal(await page.locator('[data-plan-pending]').count(), 0);
  assert.deepEqual(await deck(), original);
  assert.equal(await page.locator('[data-goal-probability]').innerText(), originalChance);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.searchWorkers.length), 0);
  await assertFieldsMatchState(page, 'after restoring a completed recommendation');

  // A view-only edit must neither search nor walk the unchanged ranking's bindings.
  await openAgenda(page);
  await page.evaluate(() => {
    window.panelReads = 0;
    window.panelFields = ['[data-apt="end"]', '[data-slot]', '[data-setting-list="chainRatesSSR"]', '[data-select="trainee-stars"]', '[data-setting="focus"]', '.deck [data-lb]'].map((selector) => document.querySelector(selector));
    for (const field of window.panelFields) {
      const descriptor = Object.getOwnPropertyDescriptor(field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value');
      Object.defineProperty(field, 'value', { configurable: true,
        get() { window.panelReads++; return descriptor.get.call(this); },
        set(value) { descriptor.set.call(this, value); },
      });
    }
    window.rankingReads = 0;
    window.rankingField = document.querySelector('section.panel:last-child [data-lb]');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(window.rankingField, 'value', { configurable: true,
      get() { window.rankingReads++; return descriptor.get.call(this); },
      set(value) { descriptor.set.call(this, value); },
    });
    window.rankingMutations = 0;
    window.rankingObserver = new MutationObserver((records) => window.rankingMutations += records.length);
    window.rankingObserver.observe(document.querySelector('section.panel:last-child'), { subtree: true, attributes: true, childList: true, characterData: true });
  });
  for (let i = 0; i < 4; i++) await page.locator('[data-action="select-target"]').first().click();
  await page.fill('#target-search', 'ground');
  assert.equal(await page.evaluate(() => window.rankingMutations), 0);
  assert.equal(await page.evaluate(() => window.rankingReads), 0, 'view edits do not read unchanged ranking fields');
  assert.equal(await page.evaluate(() => window.panelReads), 0, 'view edits do not walk unchanged panels');
  assert.equal(await page.evaluate(() => window.searchWorkers.length), 0);
  await page.evaluate(() => { window.rankingObserver.disconnect(); delete window.rankingField.value; for (const field of window.panelFields) delete field.value; });
  await page.locator('[data-sort="speed"]').click();
  assert.equal((await state(page)).ui.sortKey, 'speed');
  await assertFieldsMatchState(page, 'after sorting a restored recommendation');
  await page.locator('section.panel:last-child [data-lb]').first().evaluate((el) => { el.value = el.value === '0' ? '4' : '0'; });
  await page.locator('[data-sort="speed"]').click();
  await assertFieldsMatchState(page, 'after a repeated sort restores a stale field');
  const unownedRow = page.locator('section.panel:last-child [data-lb="30028"]');
  assert.equal(await unownedRow.count(), 1);
  await page.uncheck('[data-setting="showUnowned"]');
  assert.equal(await unownedRow.count(), 0);
  assert.equal((await state(page)).ui.showUnowned, false);
  assert.deepEqual((await state(page)).recommendation, finished.recommendation);
  await page.reload();
  assert.equal(await unownedRow.count(), 0);
  await page.check('[data-setting="showUnowned"]');
  assert.equal(await unownedRow.count(), 1);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.searchWorkers.length), 0);
  assert.deepEqual(await deck(), original);
  await assertFieldsMatchState(page, 'after changing unowned visibility without search');
  // Restore the complete baseline before testing each reload invalidation independently.
  for (const [label, change] of [
    ['build', (s) => { s.recommendation.build = 'old-build'; }],
    ['input', (s) => { s.run.goal.blueStars = 3; }],
    ['inventory', (s) => { s.inventory[s.recommendation.selection.find((e) => !e.borrowed).id] = null; }],
    ['malformed summary', (s) => { s.recommendation.summary = {}; }],
    ['illegal selection', (s) => { s.recommendation.selection[1] = s.recommendation.selection[0]; }],
  ]) {
    const current = structuredClone(finished); change(current);
    await page.evaluate(({ key, current }) => localStorage.setItem(key, JSON.stringify(current)), { key: STATE_KEY, current });
    await page.goto(url);
    await page.waitForSelector('#target-search');
    await page.waitForFunction(() => window.searchWorkers.length === 1);
    assert.equal(await page.locator('[data-plan-pending]').count(), 1, label);
  }
  await page.evaluate(({ key, finished }) => localStorage.setItem(key, JSON.stringify(finished)), { key: STATE_KEY, finished });
  await page.reload();
  await page.locator('[data-goal-stars="blue"]').selectOption('3');
  assert.equal((await state(page)).recommendation, undefined, 'an input edit removes the saved recommendation');
  await page.waitForFunction(() => window.searchWorkers.length === 1);
  await page.locator('[data-goal-stars="blue"]').selectOption('2');
  await page.waitForFunction(() => window.searchWorkers.length === 2);
  await page.evaluate((result) => {
    const worker = window.searchWorkers[0];
    worker.onmessage({ data: { id: worker.request.id, complete: true, selection: result.selection, summary: result.summary } });
  }, finished.recommendation);
  assert.equal((await state(page)).recommendation, undefined, 'an obsolete result cannot repopulate the cache after A to B to A');
  assert.equal(await page.locator('[data-plan-pending]').count(), 1);
  await page.evaluate((result) => {
    const worker = window.searchWorkers[1];
    worker.onmessage({ data: { id: worker.request.id, complete: true, selection: result.selection, summary: result.summary } });
  }, finished.recommendation);
  await assertFieldsMatchState(page, 'after publishing the current result');
  assert.deepEqual((await state(page)).recommendation, finished.recommendation);
});

test('pink alternatives inherit the first threshold, default additions to two, exclude Any, and reset only pink', async (t) => {
  const page = await editor(t);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.selectOption('[data-goal-stars="pink"]', '3');
  await page.selectOption('[data-goal-pink]', 'turf');
  await assertFieldsMatchState(page, 'after replacing Any with Turf');
  assert.equal(await page.inputValue('[data-goal-stars="pink"]'), '3');
  assert.equal(await page.locator('[data-goal-pink] option[value="any"]').count(), 0);
  await page.click('[data-action="add-pink-goal"]');
  await assertFieldsMatchState(page, 'after adding a second pink alternative');
  assert.equal(await page.inputValue('[data-pink-aptitude="dirt"]'), '2');
  await page.selectOption('[data-goal-pink="dirt"]', 'mile');
  await page.selectOption('[data-pink-aptitude="turf"]', '2');
  await page.selectOption('[data-pink-aptitude="mile"]', '3');
  await assertFieldsMatchState(page, 'after editing both pink thresholds');
  assert.equal(await page.locator('[data-goal-pink="turf"] option[value="mile"]').count(), 0);
  assert.equal(await page.locator('[data-goal-pink="mile"] option[value="turf"]').count(), 0);
  const before = (await state(page)).run;
  await page.reload();
  await assertFieldsMatchState(page, 'after reloading pink alternatives');
  assert.deepEqual((await state(page)).run, before);
  await page.click('[data-action="remove-pink-goal"][data-aptitude="turf"]');
  await assertFieldsMatchState(page, 'after removing the first pink alternative');
  assert.equal(await page.inputValue('[data-pink-aptitude="mile"]'), '3');
  await page.click('[data-action="remove-pink-goal"][data-aptitude="mile"]');
  await assertFieldsMatchState(page, 'after removing the last pink alternative');
  assert.deepEqual((await state(page)).run.goal.pink, [{ aptitude: 'any', stars: 1 }]);
  await page.selectOption('[data-goal-pink]', 'end');
  const reset = (await state(page)).run;
  reset.goal.pink = [{ aptitude: 'any', stars: 1 }];
  await page.click('[data-action="reset-pink-goal"]');
  await assertFieldsMatchState(page, 'after resetting only the pink goal');
  assert.deepEqual((await state(page)).run, reset);
});

test('preferred white priority edits persist and role changes retain required stars', async (t) => {
  const page = await editor(t);
  await page.setViewportSize({ width: 390, height: 844 });
  await target(page, 'groundwork');
  const field = page.locator('[data-target-priority="201601"]');
  assert.equal(await field.inputValue(), '0');
  await assertFieldsMatchState(page, 'after adding a preferred white spark');
  assert.doesNotMatch(await page.locator('[data-target-editor]').innerText(), /2★\+/);
  await field.fill('2');
  await field.press('Tab');
  await assertFieldsMatchState(page, 'after setting preferred priority two');
  assert.match(await page.locator('[data-action="select-target"]').innerText(), /Preferred · priority 2/);
  await page.click('[data-target-role="required"]');
  await page.selectOption('[data-target-stars="201601"]', '3');
  await assertFieldsMatchState(page, 'after setting required stars');
  await page.click('[data-target-role="preferred"]');
  await assertFieldsMatchState(page, 'after returning to preferred');
  assert.equal(await field.inputValue(), '2');
  await field.fill('-1');
  await field.press('Tab');
  assert.equal(await field.inputValue(), '0');
  await field.fill('1.5');
  await field.press('Tab');
  assert.equal(await field.inputValue(), '0');
  await assertFieldsMatchState(page, 'after invalid priority edits');
  await field.fill(String(Number.MAX_SAFE_INTEGER));
  await field.press('Tab');
  await assertFieldsMatchState(page, 'after a large priority');
  await page.reload();
  await page.click('[data-action="select-target"][data-id="201601"]');
  await assertFieldsMatchState(page, 'after reloading preferred priority');
  assert.equal(await field.inputValue(), String(Number.MAX_SAFE_INTEGER));
  await page.click('[data-target-role="required"]');
  assert.equal(await page.inputValue('[data-target-stars="201601"]'), '3');
  await assertFieldsMatchState(page, 'after restoring retained required stars');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('templates preview without edits, confirm replacement, and preserve unrelated input and inactive lineage', async (t) => {
  const { GOAL_TEMPLATES } = await import('../src/model/goal-templates.ts');
  const { COPY } = await import('../src/ui/copy.ts');
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  saved.run.targets = [{ id: 210052, role: 'required', stars: 3, priority: 0 }];
  saved.run.targetLineage = { 210052: { k1: 1, p1: 2, k2: 0, p2: 0 } };
  saved.run.wishlistOrder = [201601, 200452];
  saved.run.wishlistExcluded = [200012];
  saved.settings.affinity = 175;
  saved.inventory['30028'] = 2;
  const page = await editor(t, saved);
  await page.setViewportSize({ width: 390, height: 844 });
  const details = page.locator('[data-goal-templates]');
  assert.equal(await details.getAttribute('open'), null);
  await details.locator('summary').click();
  const picker = page.locator('[data-goal-template]');
  assert.deepEqual(await picker.locator('option').allTextContents(), ['Choose a template', ...GOAL_TEMPLATES.map((g) => g.name)]);
  assert.equal(await picker.locator('optgroup').count(), 0);
  assert.equal(await page.locator('[data-action="load-goal-template"]').isDisabled(), true);
  await details.locator('.tip').focus();
  assert.equal(await page.locator('#tooltip').innerText(), COPY.templates.tip);
  const before = await state(page);
  const godly = GOAL_TEMPLATES[2], lite = GOAL_TEMPLATES[0];
  await picker.selectOption(godly.id);
  await assertFieldsMatchState(page, 'after previewing a template');
  assert.deepEqual(await state(page), before);
  assert.match(await page.locator('[data-template-preview]').innerText(), /Required pink spark: Any 2★\+/);
  assert.match(await page.locator('[data-template-preview]').innerText(), /priority 1/);
  await page.click('[data-action="load-goal-template"]');
  await page.waitForSelector('dialog[data-dialog][open]');
  assert.equal(await page.locator('[data-dialog-message]').innerText(), `Load "${godly.name}"? This replaces your current goal requirements and target list.`);
  await page.click('[data-dialog-cancel]');
  await assertFieldsMatchState(page, 'after canceling template loading');
  assert.deepEqual(await state(page), before);
  const load = async (template) => {
    await picker.selectOption(template.id);
    await page.click('[data-action="load-goal-template"]');
    await confirmDialog(page);
    await assertFieldsMatchState(page, `after loading ${template.name}`);
    const expected = structuredClone(before);
    expected.run.goal = template.goal;
    expected.run.targets = template.targets;
    for (const [id, lineage] of Object.entries(GOAL_TEMPLATES[2].targetLineage)) expected.run.targetLineage[id] ??= lineage;
    delete expected.recommendation;
    assert.deepEqual(await state(page), expected);
  };
  await load(godly);
  await load(lite);
  assert.equal((await state(page)).run.targets.some((target) => target.id === 210052), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.reload();
  await assertFieldsMatchState(page, 'after reloading a loaded template');
  assert.deepEqual((await state(page)).run.targetLineage, { ...godly.targetLineage, ...saved.run.targetLineage });
  assert.equal(await details.getAttribute('open'), null);
  await target(page, 'ignited spirit wit');
  assert.equal(await page.inputValue('[data-lineage-k="210052"][data-side="k1"]'), '1');
  assert.equal(await page.inputValue('[data-lineage-p="210052"][data-side="p1"]'), '2');
  await assertFieldsMatchState(page, 'after re-adding a target with preserved lineage');
  await details.locator('summary').click();
  await load(godly);
  await page.selectOption('[data-goal-stars="blue"]', '1');
  await page.click('[data-action="select-target"][data-id="200012"]');
  await page.fill('[data-target-priority="200012"]', '3');
  await page.locator('[data-target-priority="200012"]').press('Tab');
  await assertFieldsMatchState(page, 'after editing template values');
  await load(godly);
  assert.equal(GOAL_TEMPLATES[2].goal.blueStars, 3);
  assert.equal(GOAL_TEMPLATES[2].targets.find((target) => target.id === 200012).priority, 0);
});

test('template Load and pink controls share rows at phone and desktop widths', async (t) => {
  const { GOAL_TEMPLATES } = await import('../src/model/goal-templates.ts');
  const page = await editor(t);
  const godly = GOAL_TEMPLATES.find((template) => template.name === 'Front runner parent (godly)');
  await page.locator('[data-goal-templates] summary').click();
  await page.selectOption('[data-goal-template]', godly.id);
  assert.ok((await page.locator('[data-template-preview]').innerText()).includes(godly.description));
  assert.match(await page.locator('[data-template-preview]').innerText(), /Parent 1: 3× 7★ · Parent 2: 3× 7★/);
  await page.click('[data-action="load-goal-template"]');
  await confirmDialog(page);
  await assertFieldsMatchState(page, 'after applying missing godly lineage');
  assert.deepEqual((await state(page)).run.targetLineage, godly.targetLineage);
  await page.click('[data-action="select-target"][data-id="210052"]');
  for (const side of ['k1', 'k2']) assert.equal(await page.inputValue(`[data-lineage-k="210052"][data-side="${side}"]`), '3');
  for (const side of ['p1', 'p2']) assert.equal(await page.inputValue(`[data-lineage-p="210052"][data-side="${side}"]`), '7');
  await page.selectOption('[data-lineage-p="210052"][data-side="p1"]', '8');
  await page.click('[data-action="load-goal-template"]');
  await confirmDialog(page);
  assert.equal((await state(page)).run.targetLineage[210052].p1, 8);
  await page.reload();
  await assertFieldsMatchState(page, 'after reloading edited template lineage');
  assert.equal((await state(page)).run.targetLineage[210052].p1, 8);
  await page.locator('[data-goal-templates] summary').click();
  await page.selectOption('[data-goal-template]', godly.id);
  assert.equal(await page.inputValue('[data-goal-pink]'), 'any');
  assert.equal(await page.inputValue('[data-goal-stars="pink"]'), '2');
  await page.click('[data-action="add-pink-goal"]');
  await page.click('[data-action="add-pink-goal"]');
  assert.equal(await page.locator('[data-action="add-pink-goal"]').innerText(), 'Add spark');
  assert.equal(await page.locator('[data-action="reset-pink-goal"]').innerText(), 'Reset');
  assert.equal(await page.locator('[data-action="goal-open-pink"]').count(), 0);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const controls = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
      const picker = rect('[data-goal-template]'), load = rect('[data-action="load-goal-template"]');
      const reset = rect('[data-action="reset-pink-goal"]'), header = rect('.goal-group-header span');
      return { templateSameRow: load.left >= picker.right && load.top < picker.bottom && load.bottom > picker.top,
        resetTopRight: reset.left >= header.right && reset.top < header.bottom && reset.bottom > header.top,
        pinkRows: [...document.querySelectorAll('[data-pink-goal-row]')].map((row) => {
          const [apt, stars, remove] = [...row.querySelectorAll('select, button')].map((el) => el.getBoundingClientRect());
          return stars.left >= apt.right && remove.left >= stars.right && remove.top < apt.bottom && remove.bottom > apt.top;
        }), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.deepEqual(controls, { templateSameRow: true, resetTopRight: true, pinkRows: [true, true], overflow: false }, `${width}px`);
    assert.doesNotMatch(await page.locator('[data-pink-goal-row]').first().innerText(), /Aptitude|Minimum stars|Remove/);
    assert.equal(await page.locator('[data-action="remove-pink-goal"]').first().innerText(), '×');
    await assertFieldsMatchState(page, `after compact pink layout at ${width}px`);
  }
});

// Share fixtures exercise the same inputs and saved-state boundary as the UI, without importing browser modules.
const waitForShare = (page) => page.waitForFunction(() => new URL(location.href).searchParams.has('run'));
const navigateShare = (page, href) => page.evaluate((next) => {
  history.pushState(null, '', next);
  dispatchEvent(new PopStateEvent('popstate'));
}, href);
function shareFixture() {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  saved.run.traineeStars = 4;
  saved.run.targets = [{ id: 201601, role: 'required', stars: 3, priority: 0 }];
  saved.run.targetLineage = { 201601: { k1: 2, k2: 1, p1: 5, p2: 3 } };
  saved.run.parentSparks = [[{ stat: 'speed', stars: 3 }, null, null], [null, null, null]];
  saved.run.wishlistOrder = [201601, 200472];
  saved.run.wishlistExcluded = [200012];
  saved.settings.focus = 'sprint'; saved.settings.winThreshold = 0.65;
  return saved;
}

// Hold one native stream until the test releases it. Later streams finish normally, including newer imports.
async function holdNextShareStream(page, kind) {
  await page.evaluate((kind) => {
    const Native = window[kind];
    const gate = { started: false, finished: false };
    const pending = new Promise((resolve) => { gate.release = resolve; });
    (window.__shareStreams ??= {})[kind] = gate;
    window[kind] = class {
      constructor(format) {
        window[kind] = Native;
        const native = new Native(format);
        this.writable = native.writable;
        this.readable = native.readable.pipeThrough(new TransformStream({
          async transform(chunk, controller) {
            gate.started = true;
            await pending;
            controller.enqueue(chunk);
          },
          flush() { gate.finished = true; },
        }));
      }
    };
  }, kind);
  return {
    started: () => page.waitForFunction((kind) => window.__shareStreams[kind].started, kind),
    release: async () => {
      await page.evaluate((kind) => window.__shareStreams[kind].release(), kind);
      await page.waitForFunction((kind) => window.__shareStreams[kind].finished, kind);
      // Let decoding and the 300 ms URL debounce finish before asserting that stale work did nothing.
      await page.waitForTimeout(500);
    },
  };
}

test('share navigation back without a code cancels an unfinished import', async (t) => {
  const saved = shareFixture(), incoming = shareFixture();
  incoming.settings.focus = 'balanced';
  const page = await editor(t, saved);
  await waitForShare(page);
  await page.evaluate((href) => history.replaceState(null, '', href), shareUrl(url, null));
  const decoding = await holdNextShareStream(page, 'DecompressionStream');
  await navigateShare(page, shareUrl(url, await encodeShare(sharedChoices(incoming))));
  await decoding.started();
  await page.evaluate(() => new Promise((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true });
    history.back();
  }));
  await decoding.release();
  assert.deepEqual(sharedChoices(await state(page)), sharedChoices(saved));
  assert.deepEqual(await decodeShare(new URL(page.url()).searchParams.get('run')), sharedChoices(saved));
  assert.equal(await page.locator('[data-dialog]').count(), 0);
  await assertFieldsMatchState(page, 'after abandoning a share import with Back');
});

for (const pending of ['timer', 'compression']) {
  test(`share navigation cancels an earlier URL ${pending} before decoding`, async (t) => {
    const saved = shareFixture(), incoming = shareFixture();
    incoming.settings.focus = 'stamina';
    incoming.run.traineeStars = 5;
    const page = await editor(t, saved);
    await waitForShare(page);
    const decoding = await holdNextShareStream(page, 'DecompressionStream');
    const encoding = pending === 'compression' ? await holdNextShareStream(page, 'CompressionStream') : null;
    const link = shareUrl(url, await encodeShare(sharedChoices(incoming)));
    if (encoding) {
      await page.selectOption('[data-setting="focus"]', 'balanced');
      await encoding.started();
      await navigateShare(page, link);
    } else {
      // Edit and navigate in one browser task, before the URL debounce can run.
      await page.evaluate((next) => {
        const focus = document.querySelector('[data-setting="focus"]');
        focus.value = 'balanced';
        focus.dispatchEvent(new Event('change', { bubbles: true }));
        history.pushState(null, '', next);
        dispatchEvent(new PopStateEvent('popstate'));
      }, link);
    }
    await decoding.started();
    if (encoding) await encoding.release(); else await page.waitForTimeout(500);
    assert.equal(page.url(), link, 'the destination URL stays intact while its import is pending');
    saved.settings.focus = 'balanced';
    assert.deepEqual(sharedChoices(await state(page)), sharedChoices(saved));
    await assertFieldsMatchState(page, 'while decoding the destination share');
    await page.reload();
    await page.waitForSelector('#target-search');
    await waitForShare(page);
    assert.deepEqual(sharedChoices(await state(page)), sharedChoices(incoming));
    assert.deepEqual(await decodeShare(new URL(page.url()).searchParams.get('run')), sharedChoices(incoming));
    await assertFieldsMatchState(page, 'after reloading during a share import');
  });
}

test('share navigation keeps the latest import when an older decode finishes last', async (t) => {
  const first = shareFixture(), latest = shareFixture();
  first.settings.focus = 'stamina';
  latest.settings.focus = 'balanced';
  latest.run.traineeStars = 5;
  const page = await editor(t, shareFixture());
  await waitForShare(page);
  const decoding = await holdNextShareStream(page, 'DecompressionStream');
  await navigateShare(page, shareUrl(url, await encodeShare(sharedChoices(first))));
  await decoding.started();
  await navigateShare(page, shareUrl(url, await encodeShare(sharedChoices(latest))));
  await page.waitForFunction(() => document.querySelector('[data-select="trainee-stars"]').value === '5');
  await decoding.release();
  assert.deepEqual(sharedChoices(await state(page)), sharedChoices(latest));
  assert.deepEqual(await decodeShare(new URL(page.url()).searchParams.get('run')), sharedChoices(latest));
  assert.equal(await page.locator('[data-dialog]').count(), 0);
  await assertFieldsMatchState(page, 'after overlapping share imports');
});

test('share navigation preserves user edits made during decoding', async (t) => {
  const saved = shareFixture(), incoming = shareFixture();
  incoming.settings.focus = 'stamina';
  incoming.run.traineeStars = 5;
  const page = await editor(t, saved);
  await waitForShare(page);
  const decoding = await holdNextShareStream(page, 'DecompressionStream');
  await navigateShare(page, shareUrl(url, await encodeShare(sharedChoices(incoming))));
  await decoding.started();
  await page.selectOption('[data-setting="focus"]', 'balanced');
  await assertFieldsMatchState(page, 'after editing during a share import');
  await decoding.release();
  await page.waitForSelector('[data-dialog]');
  assert.match(await page.locator('[data-dialog-message]').innerText(), /choices changed while the code was loading/);
  saved.settings.focus = 'balanced';
  assert.deepEqual(sharedChoices(await state(page)), sharedChoices(saved));
  assert.deepEqual(await decodeShare(new URL(page.url()).searchParams.get('run')), sharedChoices(saved));
  await page.click('[data-dialog-confirm]');
  await assertFieldsMatchState(page, 'after skipping a share import to preserve an edit');
});

test('share URLs restore their scope, follow edits, and survive an immediate reload', async (t) => {
  const receiver = defaultState(data);
  receiver.inventory = { 30052: 2, 30028: null };
  receiver.settings.affinity = 220; receiver.ui.theme = 'dark';
  receiver.run.raceOverrides = { 999999: false };
  const page = await editor(t, receiver);
  const source = shareFixture();
  const link = new URL(shareUrl(url, await encodeShare(sharedChoices(source))));
  link.searchParams.set('keep', 'yes'); link.hash = 'shared';
  await page.goto(link.href);
  await page.waitForSelector('#target-search');
  await waitForShare(page);
  const loaded = await state(page);
  assert.deepEqual(sharedChoices(loaded), sharedChoices(source));
  assert.deepEqual(loaded.inventory, receiver.inventory);
  assert.deepEqual(loaded.run.raceOverrides, source.run.raceOverrides);
  assert.equal(loaded.settings.affinity, 220); assert.equal(loaded.ui.theme, 'dark');
  await assertFieldsMatchState(page, 'after opening a share URL');
  const historyLength = await page.evaluate(() => history.length);
  await page.selectOption('[data-setting="focus"]', 'balanced');
  assert.equal(new URL(page.url()).searchParams.has('run'), false, 'remove stale snapshots during the debounce');
  await page.reload();
  await page.waitForSelector('#target-search');
  assert.equal((await state(page)).settings.focus, 'balanced', 'reload keeps the edit made before compression');
  await waitForShare(page);
  assert.equal((await decodeShare(new URL(page.url()).searchParams.get('run'))).settings.focus, 'balanced');
  assert.equal(new URL(page.url()).searchParams.get('keep'), 'yes');
  assert.equal(new URL(page.url()).hash, '#shared');
  assert.equal(await page.evaluate(() => history.length), historyLength);
  await assertFieldsMatchState(page, 'after reloading a just-edited share');
  const currentUrl = page.url();
  await page.click('[data-theme-pick="light"]');
  assert.equal(page.url(), currentUrl, 'theme edits do not rewrite the share code');
  await page.click('[data-action="reset-all"]');
  await page.click('[data-dialog-confirm]');
  await page.waitForFunction(() => document.querySelector('#trainee-search'));
  await page.waitForTimeout(500);
  assert.equal(new URL(page.url()).searchParams.has('run'), false);
  assert.deepEqual((await state(page)).inventory, receiver.inventory);
  assert.equal((await state(page)).settings.affinity, 220);
  await assertFieldsMatchState(page, 'after resetting a shared run');
});

test('share URL navigation rejects bad input atomically without sharing controls', async (t) => {
  const page = await editor(t, shareFixture());
  await waitForShare(page);
  assert.equal(await page.locator('[data-share-controls], [data-share], [data-section="share"]').count(), 0);
  assert.equal(await page.getByText('Share run', { exact: true }).count(), 0);
  const before = await state(page);
  for (const code of ['2dinvalid', '4jW10']) {
    await navigateShare(page, shareUrl(url, code));
    await page.waitForSelector('[data-dialog]');
    assert.deepEqual(await state(page), before);
    await page.click('[data-dialog-confirm]');
  }
  const source = shareFixture(); source.settings.focus = 'balanced'; source.run.traineeStars = 5;
  await navigateShare(page, shareUrl(url, await encodeShare(sharedChoices(source))));
  await page.waitForFunction(() => document.querySelector('[data-select="trainee-stars"]').value === '5');
  await waitForShare(page);
  await assertFieldsMatchState(page, 'after navigating to a share URL');
  assert.deepEqual(sharedChoices(await state(page)), sharedChoices(source));
  for (const theme of ['light', 'dark']) {
    await page.click(`[data-theme-pick="${theme}"]`);
    for (const width of [390, 768, 1280, 1440, 1680, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `URL-only sharing at ${width}px in ${theme}`);
    }
  }
});

test('unavailable shared IDs stay visible and survive edits, reloads, and re-sharing', async (t) => {
  const saved = shareFixture();
  saved.run.targets.push({ id: 99999991, role: 'required', stars: 3, priority: 0 });
  saved.run.targetLineage['99999991'] = { k1: 3, k2: 3, p1: 9, p2: 9 };
  saved.run.pinnedIds.push(99999992);
  saved.run.wishlistOrder.push(99999993);
  const page = await editor(t, saved);
  await waitForShare(page);
  assert.match(await page.locator('[data-unavailable-choices]').innerText(), /99999991/);
  assert.match(await page.locator('[data-unavailable-choices]').innerText(), /99999992/);
  assert.match(await page.locator('[data-unavailable-choices]').innerText(), /99999993/);
  await page.selectOption('[data-setting="focus"]', 'balanced');
  await waitForShare(page);
  await page.reload(); await page.waitForSelector('#target-search'); await waitForShare(page);
  saved.settings.focus = 'balanced';
  assert.deepEqual(sharedChoices(await state(page)), sharedChoices(saved));
  assert.deepEqual(await decodeShare(new URL(page.url()).searchParams.get('run')), sharedChoices(saved));
  await assertFieldsMatchState(page, 'after reloading unavailable choices');
});

test('slow share compression cannot overwrite a newer edit', async (t) => {
  const page = await editor(t, shareFixture());
  await waitForShare(page);
  await page.evaluate(() => {
    const Native = CompressionStream;
    window.shareCompressions = 0;
    window.CompressionStream = class {
      constructor(format) {
        const native = new Native(format);
        const delay = ++window.shareCompressions === 1 ? 900 : 0;
        this.writable = native.writable;
        this.readable = native.readable.pipeThrough(new TransformStream({ async transform(chunk, controller) {
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          controller.enqueue(chunk);
        } }));
      }
    };
  });
  await page.selectOption('[data-setting="focus"]', 'balanced');
  await page.waitForFunction(() => window.shareCompressions === 1);
  await page.selectOption('[data-setting="focus"]', 'stamina');
  await waitForShare(page);
  const newestUrl = page.url();
  assert.equal((await decodeShare(new URL(newestUrl).searchParams.get('run'))).settings.focus, 'stamina');
  await page.waitForTimeout(1100);
  assert.equal(page.url(), newestUrl);
  await assertFieldsMatchState(page, 'after overlapping share encodes');
});

test('invalid startup shares keep the saved run and a valid URL recovers', async (t) => {
  const page = await editor(t, shareFixture());
  const before = await state(page);
  await page.goto(shareUrl(url, '4jW10'));
  await page.waitForSelector('#target-search');
  await page.waitForSelector('[data-dialog]');
  assert.deepEqual(await state(page), before);
  assert.equal(new URL(page.url()).searchParams.get('run'), '4jW10');
  await page.click('[data-dialog-confirm]');
  await page.goto(shareUrl(url, '2jW10'));
  await page.waitForSelector('#trainee-search');
  await page.waitForTimeout(500);
  const expected = await decodeShare('2jW10');
  expected.run.raceOverrides = {};
  assert.deepEqual(sharedChoices(await state(page)), expected);
  assert.deepEqual(await decodeShare(new URL(page.url()).searchParams.get('run')), expected);
  await assertFieldsMatchState(page, 'after recovering from an invalid startup URL');
});

test('startup persists historical identity migration and keeps imported star counts visible', async (t) => {
  const saved = shareFixture();
  saved.version = 20;
  saved.run.traineeStars = 3;
  const page = await editor(t, saved);
  assert.equal((await state(page)).version, defaultState(data).version, 'migration is saved before any user edit');
  const future = await editor(t, { ...shareFixture(), version: 99 });
  assert.equal((await state(future)).version, 99, 'opening an older app must not automatically overwrite a newer save');
  const incoming = shareFixture(); incoming.run.traineeStars = 1;
  await page.goto(shareUrl(url, await encodeShare(sharedChoices(incoming))));
  await page.waitForSelector('[data-trainee-rarity-note]');
  await waitForShare(page);
  assert.equal(await page.inputValue('[data-select="trainee-stars"]'), '1');
  await assertFieldsMatchState(page, 'after importing an older trainee rarity');
  await page.reload(); await page.waitForSelector('[data-trainee-rarity-note]');
  await waitForShare(page);
  assert.equal((await state(page)).run.traineeStars, 1);
});

test('a share import remains copyable when the browser cannot save it', async (t) => {
  const page = await editor(t, shareFixture());
  await waitForShare(page);
  const before = await state(page);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); }; });
  const incoming = defaultState(data);
  incoming.settings.focus = 'balanced';
  await navigateShare(page, shareUrl(url, await encodeShare(sharedChoices(incoming))));
  await page.waitForSelector('[data-dialog]');
  assert.match(await page.locator('[data-dialog-message]').innerText(), /could not save/);
  await page.click('[data-dialog-confirm]');
  await waitForShare(page);
  assert.equal((await decodeShare(new URL(page.url()).searchParams.get('run'))).run.traineeCardId, null);
  assert.deepEqual(await state(page), before, 'the existing persisted save was not damaged');
  assert.equal(await page.locator('#trainee-search').count(), 1, 'the decoded choices remain usable in memory');
});

test('share URLs restore manual schedule picks and skips and reset to automatic', async (t) => {
  const page = await editor(t, shareFixture());
  await waitForShare(page);
  await page.locator('[data-agenda] summary').click();
  const picks = await page.locator('[data-slot]').evaluateAll((fields) => {
    const skip = fields.find((field) => field.value !== '');
    const force = fields.find((field) => field !== skip && [...field.options].some((o) => o.value && o.value !== field.value));
    return { skip: skip.dataset.slot, force: force.dataset.slot,
      race: [...force.options].find((o) => o.value && o.value !== force.value).value };
  });
  await page.selectOption(`[data-slot="${picks.skip}"]`, '');
  await page.selectOption(`[data-slot="${picks.force}"]`, picks.race);
  await waitForShare(page);
  const overrides = (await state(page)).run.raceOverrides;
  assert.ok(Object.values(overrides).includes(false));
  assert.equal(overrides[picks.race], true);
  const link = page.url();
  assert.deepEqual((await decodeShare(new URL(link).searchParams.get('run'))).run.raceOverrides, overrides);
  await assertFieldsMatchState(page, 'after sharing manual agenda choices');
  const receiver = shareFixture();
  receiver.run.raceOverrides = { 999999: true };
  const other = await editor(t, receiver);
  await other.goto(link);
  await other.waitForSelector('[data-agenda]');
  await other.locator('[data-agenda] summary').click();
  assert.equal(await other.inputValue(`[data-slot="${picks.skip}"]`), '');
  assert.equal(await other.inputValue(`[data-slot="${picks.force}"]`), picks.race);
  assert.deepEqual((await state(other)).run.raceOverrides, overrides);
  await assertFieldsMatchState(other, 'after loading shared agenda choices');
  await other.reload();
  await other.waitForSelector('[data-agenda]');
  assert.deepEqual((await state(other)).run.raceOverrides, overrides);
  await other.click('[data-action="reset-races"]');
  await waitForShare(other);
  assert.deepEqual((await decodeShare(new URL(other.url()).searchParams.get('run'))).run.raceOverrides, {});
  await assertFieldsMatchState(other, 'after resetting shared agenda choices');
});
