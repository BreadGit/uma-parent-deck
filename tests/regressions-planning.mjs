import assert from 'node:assert/strict';
import { test, suite } from 'node:test';
import { defaultState, STATE_KEY } from '../src/state.ts';
import { assertFieldsMatchState, settled, waitForPlan } from './browser-fields.mjs';
import { data, fresh, editor, state, trainee, target, pin, coverage, inventoryFile, noCards, predictions, openDetails, fujiState, fujiReferencePercent } from './browser-fixtures.mjs';

suite('planning browser regressions', { concurrency: Number(process.env.BROWSER_TEST_CONCURRENCY ?? 2) }, () => {


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
    const finishedSelection = (await state(page)).recommendation.selection;
    assert.ok(finished >= initial && finished >= reference - 0.05, `find the known better Fuji deck without a Maruzensky pin: ${finished}% shown against ${reference}%`);
    await page.evaluate(() => { window.retainedDeck = document.querySelector('.deck'); window.retainedList = document.querySelector('.wishlist'); });
    await page.selectOption('[data-goal-stars="pink"]', '3');
    await page.waitForSelector('[data-plan-pending]', { state: 'attached' });
    assert.ok(await chance() < 1, 'the intermediate estimate uses the new pink requirement');
    await page.selectOption('[data-goal-stars="pink"]', '2');
    assert.equal(await page.locator('[data-goal-result]').count(), 1, 'current estimates remain visible after an edit');
    assert.equal(await page.evaluate(() => window.retainedDeck === document.querySelector('.deck') && window.retainedList === document.querySelector('.wishlist')), true, 'deck and skill editor remain mounted');
    await waitForPlan(page);
    assert.equal(await chance(), finished, 'undoing an edit reproduces the same estimate');
    assert.deepEqual((await state(page)).recommendation.selection, finishedSelection, 'search history does not change the recommendation');
    await assertFieldsMatchState(page, 'after replacing a refinement in progress');
  });


  test('a failed refinement preserves the checked deck and can be retried', async (t) => {
    const saved = fujiState();
    const reference = fujiReferencePercent(saved);
    const page = await fresh(t, saved, { settle: false, init: () => {
      const NativeWorker = window.Worker;
      let failed = false;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          // Registered before the app's handler: the first answer becomes an error instead.
          this.addEventListener('message', (event) => {
            if (failed) return;
            failed = true;
            event.stopImmediatePropagation();
            this.terminate();
            this.dispatchEvent(new MessageEvent('message', { data: { id: event.data.id, kind: 'error', message: 'Injected refinement failure' } }));
          });
        }
      };
    } });
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


  test('every planner worker failure settles the search and offers a retry', async (t) => {
    const saved = defaultState(data);
    saved.run.traineeCardId = 100101;
    const page = await fresh(t, saved, { settle: false, init: () => {
      window.searchWorkers = [];
      window.Worker = class {
        constructor() { window.searchWorkers.push(this); }
        postMessage(request) { this.request = request; }
        terminate() { this.terminated = true; }
      };
    } });
    const failures = [
      (worker) => worker.onmessage({ data: { kind: 'result', selection: [{ id: -1, lb: 9 }] } }),
      (worker) => worker.onmessageerror(new MessageEvent('messageerror')),
      (worker) => worker.onmessage({ data: { kind: 'error', message: 'injected' } }),
    ];
    for (const [i, failure] of failures.entries()) {
      await page.waitForFunction((n) => window.searchWorkers.length === n, i + 1);
      await page.evaluate((source) => (0, eval)(source)(window.searchWorkers.at(-1)), failure.toString());
      await page.waitForSelector('[data-action="retry-search"]');
      assert.equal(await page.locator('[data-plan-pending]').count(), 0, `failure ${i} is not left pending`);
      assert.equal(await page.evaluate(() => window.searchWorkers.at(-1).terminated), true);
      assert.equal(await page.locator('.deck .slot').count(), 6, 'the checked deck stays');
      await page.click('[data-action="retry-search"]');
    }
    await page.waitForFunction((n) => window.searchWorkers.length === n, failures.length + 1);
    assert.equal(await page.locator('[data-action="retry-search"]').count(), 0, 'a retry clears the failure');
    await assertFieldsMatchState(page, 'after retrying failed searches');
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
    saved.inventory = Object.fromEntries(data.cards.map((card) => [card.id, 4]));
    saved.run.traineeCardId = 100501;
    saved.run.targets = [{ id: 201601, role: 'required', stars: 2, priority: 0 }];
    saved.inventory['30017'] = null;
    const page = await fresh(t, saved, { settle: false, clock: true, init: () => {
      window.searchWorkers = [];
      window.Worker = class {
        constructor() { window.searchWorkers.push(this); }
        postMessage(request) { this.request = request; }
        terminate() { this.terminated = true; }
        deliver(selection) { this.onmessage({ data: { id: this.request.id, kind: 'result', selection } }); }
      };
    } });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForFunction(() => window.searchWorkers.length === 1);
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 60_000));
    const cards = () => page.locator('.deck .card-link').evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    const original = await cards();
    const alternative = [30017, 30107, 30052, 30020, 30078, 30083].map((id, i) => ({ id, lb: 4, borrowed: i === 0 }));
    await page.evaluate(() => { window.retainedDeck = document.querySelector('.deck'); window.retainedList = document.querySelector('.wishlist'); });
    const heading = page.locator('h2').filter({ hasText: 'Prioritized skills' });
    await heading.scrollIntoViewIfNeeded();
    const position = () => heading.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    // the deck found may offer other extras, so the extras cannot be arranged while the search runs
    assert.equal(await page.locator('[data-wl-locked]').count(), 1, 'the list is marked as updating');
    assert.equal(await page.locator('[data-action="wl-down"]:not([disabled]), [data-action="wl-exclude"]:not([disabled]), [data-action="wl-swap"]:not([disabled])').count(), 0, 'extras controls are disabled while a search runs');
    await page.evaluate(() => {
      const field = document.querySelector('[data-goal-stars="pink"]');
      for (const value of ['3', '1', '2']) { field.value = value; field.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    assert.equal(await page.evaluate(() => window.searchWorkers.length), 1, 'rapid edits wait before starting another worker');
    assert.equal(await page.evaluate(() => window.searchWorkers[0].terminated), true);
    await page.clock.runFor(399);
    assert.equal(await page.evaluate(() => window.searchWorkers.length), 1, 'the debounce has not elapsed');
    await page.clock.runFor(1);
    await page.waitForFunction(() => window.searchWorkers.length === 2);
    await page.clock.resume(); // Native scrolling and layout continue in real time after the debounce check.
    assert.equal(await page.evaluate(() => window.searchWorkers[1].request.run.goal.pink[0].stars), 2);
    await page.evaluate((selection) => window.searchWorkers[0].deliver(selection), alternative);
    assert.deepEqual(await cards(), original, 'a cancelled search cannot publish a late result');
    assert.equal(await page.evaluate(() => window.retainedDeck === document.querySelector('.deck') && window.retainedList === document.querySelector('.wishlist')), true);
    const retainedControl = page.locator('.wishlist [data-wl-key="201601"] .tip').first();
    await retainedControl.evaluate((el) => { el.focus({ preventScroll: true }); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 200); });
    await page.waitForTimeout(220);
    const anchorBefore = await retainedControl.evaluate((el) => ({ viewport: el.getBoundingClientRect().top, document: el.getBoundingClientRect().top + scrollY }));
    await page.evaluate((selection) => window.searchWorkers[1].deliver(selection), alternative);
    await waitForPlan(page);
    await settled(page);
    const anchorAfter = await retainedControl.evaluate((el) => ({ viewport: el.getBoundingClientRect().top, document: el.getBoundingClientRect().top + scrollY }));
    assert.ok(Math.abs(anchorAfter.document - anchorBefore.document) > 20, 'the final deck changes the content height above the skill');
    assert.ok(Math.abs(anchorAfter.viewport - anchorBefore.viewport) <= 1, 'the skill control stays at the same screen position');
    assert.notDeepEqual(await cards(), original, 'the final result replaces the cards once');
    assert.equal(await page.locator('.deck .slot').count(), 6);
    assert.equal(await page.locator('[data-wl-locked]').count(), 0, 'the list unlocks once the search publishes');
    const published = await position();
    await page.locator('[data-action="wl-down"]:not([disabled])').first().click();
    assert.ok(Math.abs(await position() - published) <= 1, 'reordering does not collapse the content above the editor');
    assert.equal(await page.evaluate(() => window.searchWorkers.length), 2, 'arranging the extras starts no search');
    await assertFieldsMatchState(page, 'after debounced search and skill reordering');
  });


  test('target rows show disabled controls with explanations; only extras can be arranged or hidden', async (t) => {
    const saved = defaultState(data);
    const focus = data.skills.find((s) => s.name === 'Focus');
    const falcon = data.cards.find((c) => c.charName === 'Smart Falcon' && c.rarity === 'SSR' && c.type === 'power');
    saved.run.traineeCardId = 100101;
    saved.run.pinnedIds.push(falcon.id);
    saved.run.targets = [{ id: 201601, role: 'required', stars: 2, priority: 0 }, { id: focus.id, role: 'preferred', stars: 2, priority: 0 }];
    saved.run.wishlistOrder = [focus.id, 201601];
    const page = await fresh(t, saved);
    const first = page.locator('.wishlist li').first();
    assert.equal(await first.getAttribute('data-wl-key'), '201601', 'the required target is first whatever the saved order says');
    assert.match(await first.innerText(), /required/);
    assert.equal(await first.getAttribute('draggable'), 'false');
    const targets = page.locator('.wishlist li.wl-target');
    assert.ok(await targets.count() >= 2);
    assert.equal(await targets.locator('.wl-actions button').count(), 3 * await targets.count(), 'targets show both arrows and the hide control');
    assert.equal(await targets.locator('.wl-actions button:not([disabled])').count(), 0, 'target controls cannot change the list');
    const controls = first.locator('.wl-actions');
    await controls.hover();
    await page.waitForSelector('#tooltip.show');
    assert.match(await page.locator('#tooltip').innerText(), /target skills.*cannot be removed/i);
    await controls.focus();
    assert.match(await page.locator('#tooltip').innerText(), /Parent goal/);
    assert.deepEqual((await state(page)).run.wishlistOrder, saved.run.wishlistOrder, 'the saved order is kept even where it names targets');
    assert.equal(await page.locator('[data-action="wl-export"]').count(), 0, 'the list has no export button');
    const extra = page.locator('.wishlist li[data-wl-role="extra"]').first();
    const key = await extra.getAttribute('data-wl-key');
    await page.click(`[data-action="wl-exclude"][data-id="${key}"]`);
    assert.equal(await page.locator(`.wishlist [data-wl-key="${key}"]`).count(), 0, 'a hidden extra leaves the list');
    assert.equal(await page.locator(`[data-action="wl-restore"][data-id="${key}"]`).count(), 1, 'and can be put back');
    assert.equal(await page.locator('[data-priority-conflict]').count(), 0, 'hiding raises no warning');
    assert.equal(await first.getAttribute('data-wl-key'), '201601');
    await assertFieldsMatchState(page, 'after hiding an extra');
  });


  test('ranking pins persist and an unowned pin requests a borrowed card', async (t) => {
    const saved = defaultState(data);
    saved.inventory['30028'] = null;
    saved.ui.showUnowned = true;
    const page = await editor(t, saved);
    const button = page.locator('.ranking-table button[data-action="toggle-card-pin"][data-id="30028"]');
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
    await openDetails(page);
    const gold = coverage(page, 'Corner Recovery').locator('td').nth(1);
    assert.notEqual(await gold.innerText(), '100.0%');
    await page.fill('[data-setting-list="chainRatesSSR"]', '1,1,1');
    await page.locator('[data-setting-list="chainRatesSSR"]').press('Tab');
    assert.equal(await gold.innerText(), '100.0%');
    assert.equal(await coverage(page, 'Corner Recovery').locator('td').nth(3).innerText(), '40.0%');
    const before = await coverage(page, 'Corner Recovery').innerText();
    await page.reload();
    await openDetails(page);
    assert.equal(await coverage(page, 'Corner Recovery').innerText(), before);
  });


  test('skill advice includes prerequisite costs and buyable circle upgrades', async (t) => {
    const saved = defaultState(data);
    saved.inventory = Object.fromEntries(data.cards.map((card) => [card.id, 4]));
    const page = await editor(t, saved);
    await trainee(page);
    await pin(page, 'piece of mind');
    // Fine Motion hints Right-Handed ○. A target no deck card can give is not bought, so it would cost nothing.
    await pin(page, 'wave of gratitude');
    await openDetails(page);
    await target(page, 'Swinging Maestro');
    assert.match(await page.locator('div.small').filter({ hasText: /^Worst-case target SP cost:/ }).innerText(), /340 of/);
    await page.click('[data-action="remove-target"]');
    await target(page, 'Right-Handed');
    const row = coverage(page, 'Right-Handed');
    const hint = Number((await row.locator('td').nth(2).innerText()).replace('%', ''));
    const spark = Number((await row.locator('td').nth(3).innerText()).replace('%', ''));
    assert.ok(hint > 0, 'the pinned Fine Motion card hints Right-Handed');
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


  test('zero through four owned characters show an incomplete deck, and five restore predictions', async (t) => {
    const saved = defaultState(data);
    saved.settings.inventoryOverrides.R = null;
    const page = await editor(t, saved);
    await trainee(page);
    const cards = [30052, 30028, 30016, 30083, 20009];
    for (let n = 0; n <= 5; n++) {
      const inventory = noCards();
      cards.slice(0, n).forEach((id) => { inventory[id] = 4; });
      await page.setInputFiles('#import-file', inventoryFile(inventory));
      await page.waitForFunction(({ key, n }) => Object.values(JSON.parse(localStorage.getItem(key)).inventory).filter((v) => v !== null).length === n, { key: STATE_KEY, n });
      assert.equal(await predictions(page).count(), n === 5 ? 1 : 0);
      // an incomplete deck has no run to show beside the estimate, so the estimate takes the whole width
      assert.equal(await page.locator('.results-split').count(), n === 5 ? 1 : 0, 'the two-column split appears only with a complete deck');
      const detailsSub = page.locator('section.panel').filter({ has: page.locator('details[data-prediction-details]') }).locator('[data-panel-sub]');
      assert.equal(await detailsSub.innerText(), n === 5 ? 'goal estimate · stat sources · target coverage · deck search' : 'goal estimate · deck search');
      if (n < 5) assert.match(await page.locator('[data-plan-issues]').innerText(), /Incomplete deck/);
      else assert.equal(await page.locator('.deck .slot').count(), 6);
      if (n === 0 || n === 5) {
        await openDetails(page);
        await page.waitForSelector(n === 5 ? '[data-stat-breakdown]' : '[data-details-incomplete]');
        assert.equal(await page.locator('[data-stat-breakdown]').count(), n === 5 ? 1 : 0, 'stat sources need a complete deck');
        assert.equal(await page.locator('[data-details-incomplete]').count(), n === 5 ? 0 : 1, 'an incomplete deck says why the sections are missing');
        await page.click('details[data-prediction-details] > summary');
        await page.waitForSelector('[data-goal-details]', { state: 'detached' });
      }
    }
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
});
