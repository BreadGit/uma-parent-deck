import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, suite } from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { defaultState } from '../src/state.ts';
import { assertFieldsMatchState } from './browser-fields.mjs';
import { data, browser, fresh, editor, state, target, openDetails, fujiState } from './browser-fixtures.mjs';

suite('editor browser regressions', { concurrency: Number(process.env.BROWSER_TEST_CONCURRENCY ?? 2) }, () => {

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

    await openDetails(page);
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

    await openDetails(page);
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
    const queries = { 'trainee-search': 'special', 'target-search-required': 'groundwork', 'card-search': 'a' };
    for (const [id, query] of Object.entries(queries)) await page.fill(`#${id}`, query);
    await page.locator('h1').click();
    for (const [id, query] of Object.entries(queries)) {
      assert.equal(await page.inputValue(`#${id}`), query);
      assert.equal(await page.locator(`#${id}`).getAttribute('aria-expanded'), 'false');
    }
    await assertFieldsMatchState(page, 'after dismissing suggestions');
    await page.click('#target-search-required');
    assert.equal(await page.locator('#target-search-required').getAttribute('aria-expanded'), 'true');
    await page.press('#target-search-required', 'Enter');
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
    // the pinned Light Hello leads the ranking without a chance at this target, so take the first row that has one
    const row = page.locator('.ranking-table tbody tr').filter({ has: page.locator('[data-target-spark]') }).first();
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
    await page.fill('#target-search-required', 'groundwork');
    const targetId = Number(await page.locator('#target-search-required-list li').first().getAttribute('data-id'));
    await page.fill('#card-search', 'a');
    for (let i = 0; i < 10; i++) await page.press('#card-search', 'ArrowDown');
    assert.equal(await page.locator('#target-search-required').getAttribute('aria-expanded'), 'false');
    await page.click('#target-search-required');
    assert.equal(await page.locator('#card-search').getAttribute('aria-expanded'), 'false');
    await page.press('#target-search-required', 'Enter');
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


  test('search boxes leave composition keys to the input method and have accessible names', async (t) => {
    const page = await editor(t);
    const composing = (selector, key, keyCode = 0) => page.locator(selector).evaluate((input, { key, keyCode }) => {
      const event = new KeyboardEvent('keydown', { key, isComposing: keyCode === 0, bubbles: true, cancelable: true });
      if (keyCode) Object.defineProperty(event, 'keyCode', { value: keyCode });
      input.dispatchEvent(event);
    }, { key, keyCode });
    for (const [selector, query, label] of [['#trainee-search', 'special', 'Search trainees'],
      ['#target-search-required', 'groundwork', 'Search skills to add as required'], ['#card-search', 'piece of mind', 'Search support cards to pin']]) {
      assert.equal(await page.locator(selector).getAttribute('aria-label'), label);
      await page.fill(selector, query);
      const before = await state(page);
      await composing(selector, 'ArrowDown');
      assert.equal(await page.locator(selector).getAttribute('aria-activedescendant'), '', `${selector}: composition arrows do not move the highlight`);
      await composing(selector, 'Enter');
      await composing(selector, 'Enter', 229);
      assert.deepEqual(await state(page), before, `${selector}: composition Enter does not pick a suggestion`);
      assert.equal(await page.inputValue(selector), query, `${selector}: the query is kept`);
    }
    await page.press('#card-search', 'Enter');
    assert.equal((await state(page)).run.pinnedIds.length, defaultState(data).run.pinnedIds.length + 1, 'Enter after composition picks normally');
    await page.fill('#trainee-search', 'special');
    await page.press('#trainee-search', 'Enter');
    assert.notEqual((await state(page)).run.traineeCardId, null);
    await assertFieldsMatchState(page, 'after composition keys in search boxes');
  });


  test('every search box matches words in any order', async (t) => {
    const page = await editor(t);
    const names = (list) => page.locator(`${list} li`).allInnerTexts();
    await page.fill('#target-search-required', 'recovery corner');
    assert.ok((await names('#target-search-required-list')).some((text) => text.startsWith('Corner Recovery')), 'skill search');
    await page.fill('#card-search', 'hello light');
    assert.ok((await names('#card-search-list')).some((text) => text.includes('Light Hello')), 'card search');
    await page.fill('#trainee-search', 'week special');
    assert.ok((await names('#trainee-search-list')).some((text) => text.includes('Special Week')), 'trainee search');
  });


  test('ranking headers sort from the keyboard and keep focus', async (t) => {
    const page = await editor(t);
    const sorts = page.locator('.ranking-table th button[data-sort]');
    assert.equal(await sorts.count(), 8);
    assert.ok((await sorts.evaluateAll((buttons) => buttons.map((b) => b.tabIndex))).every((i) => i === 0));
    assert.equal(await page.locator('[data-sort="score"] .tip').count(), 0, 'the help icon is not nested in the button');
    await page.focus('[data-sort="speed"]');
    await page.keyboard.press('Enter');
    assert.equal((await state(page)).ui.sortKey, 'speed');
    assert.equal(await page.locator('th:has([data-sort="speed"])').getAttribute('aria-sort'), 'descending');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-sort')), 'speed', 'focus stays on the header');
    await page.focus('[data-sort="sp"]');
    await page.keyboard.press('Space');
    assert.equal((await state(page)).ui.sortKey, 'sp');
    await assertFieldsMatchState(page, 'after sorting from the keyboard');
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
    // Breakaway Battleship Gold Ship offers these 18 target families through hints and events. Only the ten listed
    // prioritized skills are credited with event options, so the card shows a chance for the families it hints or
    // whose events the list steers: more than the four the collapsed row holds.
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
      const chances = await row.locator('[data-target-spark]:visible').count();
      assert.ok(chances > 4 && chances <= 18, `expanding shows every chance the card has, ${chances} here`);
      // A persisted presentation change must not collapse the card's transient expansion.
      await page.click('[data-sort="sp"]');
      assert.equal(await row.locator('[data-target-spark]:visible').count(), chances);
      const last = row.locator('[data-target-spark]:visible').last();
      const lastName = (await last.locator('span').first().innerText()).trim();
      assert.ok(lastName.length > 0);
      await last.locator('.tip').focus();
      assert.equal(await last.evaluate((el) => {
        const rect = el.getBoundingClientRect(), scroll = el.closest('.scroll').getBoundingClientRect();
        return rect.top >= Math.max(0, scroll.top) && rect.bottom <= Math.min(innerHeight, scroll.bottom);
      }), true, `last target is reachable at ${width}px in ${theme}`);
      assert.ok((await page.locator('#tooltip').innerText()).includes(lastName), `the tooltip is for ${lastName}`);
      await more.focus();
      await page.keyboard.press('Space');
      assert.equal(await more.getAttribute('aria-expanded'), 'false');
      assert.equal(await row.locator('[data-target-spark]:visible').count(), 4);
      await assertFieldsMatchState(page, `after expanding and collapsing targets at ${width}px in ${theme}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    assert.deepEqual((await state(page)).run, saved.run, 'expansion preserves run inputs');
  });


  test('candidate toggle disappears when all chips fit, including after resizing an expanded list', async (t) => {
    const saved = defaultState(data);
    saved.run.traineeCardId = 100501;
    const page = await fresh(t, saved);
    const hide = page.locator('[data-action="wl-exclude"]:not([disabled])');
    for (let i = 0; await hide.count(); i++) {
      assert.ok(i < 40, 'hiding extras terminates');
      await hide.first().click();
    }
    const toggle = page.locator('[data-action="wl-candidates"]');
    await page.setViewportSize({ width: 390, height: 1000 });
    await toggle.waitFor();
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('[data-candidates]').evaluate((el) => el.scrollHeight > el.clientHeight + 1), false, 'expanding shows every candidate');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-candidates]');
      const height = parseFloat(getComputedStyle(el).getPropertyValue('--wl-candidates-height'));
      return [...el.children].every((chip) => chip.getBoundingClientRect().bottom <= el.getBoundingClientRect().top + height + 1);
    });
    await toggle.waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 390, height: 1000 });
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'the list collapses again when more rows need hiding');
    await toggle.focus();
    await page.keyboard.press('Enter');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Enter');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'wl-candidates');
    await toggle.click();
    const restore = page.locator('[data-action="wl-restore"]');
    for (let i = 0; await restore.count(); i++) {
      assert.ok(i < 40, 'restoring extras terminates');
      await restore.first().click();
    }
    await toggle.waitFor({ state: 'detached' });
    await assertFieldsMatchState(page, 'after resizing, toggling and restoring candidates');
  });


  test('search suggestions open inside the pinned input column and keyboard rows stay in view', async (t) => {
    const page = await editor(t, fujiState());
    const column = page.locator('[data-inputs]');
    assert.equal(await column.evaluate((el) => el.scrollHeight > el.clientHeight), true, 'the input column scrolls on its own at this height');
    // park the card search at the column's bottom edge, where an opened list would drop out of view
    await column.evaluate((el) => { const input = document.querySelector('#card-search'); el.scrollTop += input.getBoundingClientRect().bottom - (el.getBoundingClientRect().top + el.clientHeight); });
    const before = await page.evaluate(() => scrollY);
    const within = (selector) => page.evaluate((selector) => {
      const column = document.querySelector('[data-inputs]'), el = document.querySelector(selector);
      const r = el.getBoundingClientRect(), c = column.getBoundingClientRect();
      return r.top >= c.top - 1 && r.bottom <= c.top + column.clientHeight + 1;
    }, selector);
    await page.fill('#card-search', 'kita');
    assert.equal(await within('#card-search-list'), true, 'the opened list is scrolled into the column');
    assert.equal(await within('#card-search'), true, 'without losing the search box');
    const count = await page.locator('#card-search-list li').count();
    for (let i = 0; i < count; i++) {
      await page.press('#card-search', 'ArrowDown');
      assert.equal(await within('#card-search-list [aria-selected="true"]'), true, `row ${i} is inside the column`);
    }
    assert.equal(await page.evaluate(() => scrollY), before, 'the page itself does not move');
    await page.press('#card-search', 'Escape');
    await assertFieldsMatchState(page, 'after navigating suggestions inside the pinned column');
  });
});
