import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, suite } from 'node:test';
import { defaultState, STATE_KEY, UNREADABLE_KEY } from '../src/state.ts';
import { assertFieldsMatchState, BASE_URL as url, writeMissedSave } from './browser-fields.mjs';
import { defaultParentSparks } from '../src/model/inherit.ts';
import { RARITIES } from '../src/types.ts';
import { encodeShare, decodeShare, shareCode, sharedChoices, shareUrl } from '../src/share.ts';
import { data, fresh, editor, state, trainee, target, pin, inventoryFile, predictions, confirmDialog, openAgenda, waitForShare, shareFixture } from './browser-fixtures.mjs';

suite('storage browser regressions', { concurrency: Number(process.env.BROWSER_TEST_CONCURRENCY ?? 2) }, () => {


  test('arranging the extras after a missed storage event rearranges the other tab\'s order', async (t) => {
    const saved = defaultState(data);
    saved.run.traineeCardId = 100101;
    const page = await fresh(t, saved);
    const extras = await page.locator('.wishlist li[data-wl-role="extra"]').evaluateAll((els) => els.map((el) => Number(el.dataset.wlKey)));
    assert.ok(extras.length >= 3, 'the fixture shows at least three extras');
    const [a, b, c, ...rest] = extras;
    // Another tab moves the third extra to the top.
    await writeMissedSave(page, (other) => { other.run.wishlistOrder = [c, a, b, ...rest]; });
    await page.click(`[data-action="wl-down"][data-id="${a}"]`);
    assert.deepEqual((await state(page)).run.wishlistOrder.slice(0, 3), [c, b, a], 'the move applies to the other tab\'s order');
    assert.deepEqual(await page.locator('.wishlist li[data-wl-role="extra"]').evaluateAll((els) => els.slice(0, 3).map((el) => Number(el.dataset.wlKey))), [c, b, a]);
    await assertFieldsMatchState(page, 'after arranging extras that took over a missed change from another tab');
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


  test('Reset all under a newer save keeps the reset on the page instead of reloading the old run', async (t) => {
    const saved = { ...defaultState(data), version: 99 };
    saved.run.traineeCardId = 100101;
    const page = await editor(t, saved);
    await page.waitForSelector('[data-newer-save]');
    await page.evaluate(() => { window.beforeReset = true; });
    await page.click('[data-action="reset-all"]');
    await confirmDialog(page);
    await page.waitForSelector('[data-action="clear-trainee"]', { state: 'detached' });
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.beforeReset), true, 'a reset that was not saved does not reload');
    assert.equal((await state(page)).run.traineeCardId, 100101, 'the newer save is left intact');
  });


  test('manual agenda choices use the latest save after a missed storage event', async (t) => {
    for (const scenario of [
      { name: 'pick below the latest threshold', threshold: 0.8, overrides: { 624: false }, latestThreshold: 1,
        choice: '624', expected: { 623: false, 624: true } },
      { name: 'skip above the latest threshold', threshold: 1, overrides: { 624: true }, latestThreshold: 0.8,
        choice: '', expected: { 623: false, 624: false } },
      { name: 'clear overrides for the latest automatic choice', threshold: 1, overrides: { 623: true }, latestThreshold: 0.8,
        choice: '624', expected: {} },
      { name: 'pick after the latest aptitude change', threshold: 0.8, overrides: { 624: false }, latestThreshold: 0.8, mile: 'G',
        choice: '624', expected: { 623: false, 624: true } },
    ]) await t.test(scenario.name, async (t) => {
      const saved = defaultState(data);
      saved.run.traineeCardId = 100101;
      saved.settings.winThreshold = scenario.threshold;
      saved.run.raceOverrides = scenario.overrides;
      const page = await editor(t, saved);
      await openAgenda(page);
      // Special Week's optional Junior December slot contains Hanshin Juvenile Fillies (623) and Asahi Hai (624).
      const slot = '[data-slot="22"]';
      const previous = await page.inputValue(slot);
      assert.notEqual(previous, scenario.choice, 'the user changes the displayed choice');
      await writeMissedSave(page, (other) => {
        other.settings.winThreshold = scenario.latestThreshold;
        if (scenario.mile) other.run.aptOverrides.mile = scenario.mile;
        other.run.raceOverrides[625] = true;
      });
      assert.equal(await page.inputValue(slot), previous, 'the missed event leaves the displayed choice stale');
      await page.selectOption(slot, scenario.choice);
      assert.equal(await page.inputValue(slot), scenario.choice, 'the agenda keeps the requested choice');
      const current = await state(page);
      assert.equal(current.settings.winThreshold, scenario.latestThreshold);
      if (scenario.mile) assert.equal(current.run.aptOverrides.mile, scenario.mile);
      assert.deepEqual(current.run.raceOverrides, { ...scenario.expected, 625: true }, 'other slots retain the latest overrides');
      await assertFieldsMatchState(page, 'after an agenda choice takes over a missed save');
    });
  });


  test('mission event selection edits use the latest save after a missed storage event', async (t) => {
    for (const scenario of [
      { name: 'selecting an event after another tab starts following current events', initial: [206], latest: null,
        selector: '[data-mission-event="201"]', checked: true, expected: [201, 202] },
      { name: 'stopping follow-current after another tab explicitly selects events', initial: null, latest: [206, 999999],
        selector: '[data-mission-follow]', checked: false, expected: [206, 999999] },
    ]) await t.test(scenario.name, async (t) => {
      const saved = defaultState(data);
      saved.missions.eventIds = scenario.initial;
      const page = await fresh(t, saved, { held: true, init: () => {
        Date.now = () => new Date('2026-10-04T12:00:00Z').getTime();
      } });
      await page.goto(new URL('missions.html', url).href);
      const control = page.locator(scenario.selector);
      await control.waitFor();
      assert.equal(await control.isChecked(), !scenario.checked, 'the user changes the displayed selection');
      await assertFieldsMatchState(page, 'before a mission event edit');
      await writeMissedSave(page, (other) => { other.missions.eventIds = scenario.latest; other.settings.focus = 'balanced'; });
      assert.equal(await control.isChecked(), !scenario.checked, 'the missed event leaves the displayed selection stale');
      await control.setChecked(scenario.checked);
      const current = await state(page);
      assert.deepEqual(current.missions.eventIds.slice().sort((a, b) => a - b), scenario.expected, 'the edit uses the latest selection');
      assert.equal(current.settings.focus, 'balanced', 'unrelated choices from the latest save are kept');
      await assertFieldsMatchState(page, 'after a mission event edit takes over a missed save');
    });
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


  test('advanced rarity overrides preserve imported values, export and individual edits', async (t) => {
    const saved = defaultState(data);
    const [r, sr, ssr] = RARITIES.map((rarity) => data.cards.find((card) => card.rarity === rarity));
    const unowned = data.cards.find((card) => card.rarity === 'SR' && card.id !== sr.id);
    const absent = data.cards.find((card) => card.rarity === 'SSR' && card.id !== ssr.id);
    saved.inventory = { [r.id]: 0, [sr.id]: 2, [ssr.id]: 1, [unowned.id]: null };
    const page = await editor(t, saved);
    const card = (id) => page.locator(`select[data-lb="${id}"]`).first();
    await page.locator('[data-details="advanced"] > summary').click();
    const override = (rarity) => page.locator(`[data-inventory-override="${rarity}"]`);
    assert.equal(await override('R').inputValue(), '4');
    assert.equal(await override('SR').inputValue(), '');
    assert.equal(await override('SSR').inputValue(), '');
    assert.equal(await card(r.id).inputValue(), '4', 'R overrides even an imported LB0');
    assert.equal(await card(r.id).isDisabled(), true);
    assert.equal(await card(sr.id).inputValue(), '2');
    assert.equal(await card(ssr.id).inputValue(), '1');
    assert.equal(await card(unowned.id).inputValue(), 'none');
    assert.equal(await card(absent.id).inputValue(), 'none', 'an absent SSR is not owned');
    await assertFieldsMatchState(page, 'with imported inventory and default rarity overrides');

    await override('SR').selectOption('4');
    assert.equal(await card(sr.id).inputValue(), '4');
    assert.equal(await card(unowned.id).inputValue(), '4', 'the override owns explicitly unowned cards too');
    assert.equal(await card(sr.id).isDisabled(), true);
    assert.deepEqual((await state(page)).inventory, saved.inventory);
    await assertFieldsMatchState(page, 'after overriding all SR cards');
    await override('SSR').selectOption('0');
    assert.equal(await card(ssr.id).inputValue(), '0');
    assert.equal(await card(absent.id).inputValue(), '0', 'LB0 is a valid ownership override');
    await assertFieldsMatchState(page, 'after overriding all SSR cards at LB0');

    const downloading = page.waitForEvent('download');
    await page.locator('[data-action="export"]').click();
    const download = await downloading;
    let contents = '';
    for await (const chunk of await download.createReadStream()) contents += chunk;
    const exported = JSON.parse(contents);
    for (const [id, lb] of Object.entries(saved.inventory)) assert.equal(exported[id], lb, 'export keeps readings beneath overrides');
    assert.equal(exported[absent.id], null);
    await assertFieldsMatchState(page, 'after exporting the real inventory');

    for (const rarity of RARITIES) {
      await override(rarity).selectOption('');
      await assertFieldsMatchState(page, `after disabling the ${rarity} override`);
    }
    assert.equal(await card(r.id).inputValue(), '0');
    assert.equal(await card(sr.id).inputValue(), '2');
    assert.equal(await card(ssr.id).inputValue(), '1');
    assert.equal(await card(unowned.id).inputValue(), 'none');
    assert.equal(await card(absent.id).inputValue(), 'none');
    assert.equal(await card(sr.id).isDisabled(), false);
    await card(ssr.id).selectOption('4');
    assert.equal((await state(page)).inventory[ssr.id], 4, 'LB4 is stored explicitly');
    await assertFieldsMatchState(page, 'after setting an individual SSR to MLB');
    await page.reload();
    await page.waitForSelector('select[data-lb]');
    assert.equal(await card(ssr.id).inputValue(), '4');
    await assertFieldsMatchState(page, 'after reloading saved inventory overrides');
    await page.locator('[data-details="advanced"] > summary').click();
    await page.locator('[data-action="reset-settings"]').click();
    assert.deepEqual((await state(page)).settings.inventoryOverrides, { R: 4, SR: null, SSR: null });
    assert.equal((await state(page)).inventory[r.id], 0);
    assert.equal((await state(page)).inventory[ssr.id], 4);
    await assertFieldsMatchState(page, 'after resetting advanced rarity overrides');
  });


  test('negative skills are absent from target search and saved negative targets remain visible as unavailable', async (t) => {
    const saved = defaultState(data);
    saved.run.traineeCardId = 100701;
    saved.run.targets = [{ id: 200433, role: 'required', stars: 1, priority: 0 }];
    saved.run.targetLineage['200433'] = [3, 0, 0, 0, 0, 0];
    const page = await editor(t, saved);
    assert.match(await page.locator('[data-unavailable-choices]').innerText(), /200433/);
    assert.equal(await page.locator('.wishlist [data-wl-key="200433"]').count(), 0);
    for (const name of ['Gatekept', 'Wallflower', 'Right-Handed ×']) {
      await page.fill('#target-search-required', name);
      assert.equal(await page.locator('[data-action="add-target"]').count(), 0, name);
    }
    await page.fill('#target-search-required', 'Focus');
    assert.equal(await page.locator('[data-action="add-target"][data-id="200432"]').count(), 1, 'positive counterpart remains selectable');
    assert.deepEqual((await state(page)).run.targets, saved.run.targets);
    assert.deepEqual((await state(page)).run.targetLineage, saved.run.targetLineage);
    await assertFieldsMatchState(page, 'after searching negative skills');
  });


  test('settings export captures current advanced values without changing the saved run', async (t) => {
    const saved = defaultState(data);
    saved.settings.hintScale = 1.5;
    saved.settings.chainRatesSSR = [.8, .5, .2];
    const page = await editor(t, saved);
    await page.click('[data-details="advanced"] > summary');
    await page.fill('[data-setting="hintScale"]', '2');
    await page.locator('[data-setting="hintScale"]').press('Tab');
    const before = await state(page);
    const downloaded = page.waitForEvent('download');
    await page.click('[data-action="export-settings"]');
    const download = await downloaded;
    assert.equal(download.suggestedFilename(), 'settings.json');
    let text = '';
    for await (const chunk of await download.createReadStream()) text += chunk;
    const settings = JSON.parse(text);
    assert.equal(settings.hintScale, 2);
    assert.deepEqual(settings, before.settings);
    assert.deepEqual(await state(page), before);
    await assertFieldsMatchState(page, 'after exporting settings');
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


  test('legacy edits after a missed storage event keep the other tab\'s changes', async (t) => {
    const page = await editor(t);
    await trainee(page);
    await page.click('[data-action="toggle-sparks"]');
    await page.selectOption('[data-spark-stat="0-0"]', 'speed');
    await page.click('[data-action="toggle-pink-sparks"]');
    await page.selectOption('[data-pink-lineage="3"]', 'turf');
    // Another tab edits the same sparks.
    const otherTab = (edit) => writeMissedSave(page, (saved) => edit(saved.run));
    await otherTab((run) => { run.parentSparks[0][0].stars = 1; run.parentSparks[0][1] = { stat: 'power', stars: 2 }; });
    await page.selectOption('[data-spark-stat="0-0"]', 'stamina');
    assert.deepEqual((await state(page)).run.parentSparks[0], [{ stat: 'stamina', stars: 1 }, { stat: 'power', stars: 2 }, null], 'a stat edit keeps the other tab\'s stars and sparks');
    await otherTab((run) => { run.pinkLineage[3] = { aptitude: 'dirt', stars: 3 }; run.pinkLineage[4] = { aptitude: 'long', stars: 2 }; });
    await page.selectOption('[data-pink-lineage-stars="3"]', '1');
    assert.deepEqual((await state(page)).run.pinkLineage.slice(3, 5), [{ aptitude: 'dirt', stars: 1 }, { aptitude: 'long', stars: 2 }], 'a stars edit keeps the other tab\'s aptitude and sparks');
    await otherTab((run) => { run.pinkLineage[5] = { aptitude: 'sprint', stars: 2 }; });
    const mile = await page.inputValue('[data-apt="mile"]');
    await page.selectOption('[data-apt="mile"]', mile === 'A' ? 'B' : 'A');
    assert.deepEqual((await state(page)).run.pinkLineage[5], { aptitude: 'sprint', stars: 2 }, 'an aptitude edit keeps the other tab\'s pink spark');
    await assertFieldsMatchState(page, 'after legacy edits that took over a missed change from another tab');
  });



  test('completed recommendations survive reload without a worker, while changed inputs and versions search again', async (t) => {
    const saved = defaultState(data);
    saved.run.traineeCardId = 100101;
    saved.run.targets = [{ id: 201601, role: 'required', stars: 2, priority: 0 }];
    saved.inventory['30028'] = null;
    const page = await fresh(t, saved, { clock: true });
    const finished = await state(page);
    assert.ok(finished.recommendation?.summary.evaluated > 0);
    const { wishlistOrder: _order, wishlistExcluded: _hidden, ...searched } = finished.run;
    assert.deepEqual(JSON.parse(finished.recommendation.key), [searched, finished.settings, finished.inventory], 'the key leaves the extras arrangement out');
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
    await page.clock.fastForward(500);
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
    await page.fill('#target-search-required', 'ground');
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
    await page.clock.fastForward(500);
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
      await page.waitForSelector('#target-search-required');
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
      worker.onmessage({ data: { id: worker.request.id, kind: 'result', selection: result.selection, summary: result.summary } });
    }, finished.recommendation);
    assert.equal((await state(page)).recommendation, undefined, 'an obsolete result cannot repopulate the cache after A to B to A');
    assert.equal(await page.locator('[data-plan-pending]').count(), 1);
    await page.evaluate((result) => {
      const worker = window.searchWorkers[1];
      worker.onmessage({ data: { id: worker.request.id, kind: 'result', selection: result.selection, summary: result.summary } });
    }, finished.recommendation);
    await assertFieldsMatchState(page, 'after publishing the current result');
    assert.deepEqual((await state(page)).recommendation, finished.recommendation);
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


  test('unreadable saves from another tab show recovery choices without resetting the current run', async (t) => {
    const saved = shareFixture(), page = await editor(t, saved);
    const otherTab = await page.context().newPage();
    await otherTab.goto(new URL('missions.html', url).href);
    const first = '{first broken save', second = '{second broken save';
    await otherTab.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: STATE_KEY, raw: first });
    await page.locator('[data-action="remove-unreadable"]').waitFor();
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), UNREADABLE_KEY), first);
    assert.equal(await page.locator('[data-action="clear-trainee"]').count(), 1, 'the current trainee stays on the page');
    assert.doesNotMatch(await page.locator('[data-unreadable-save]').innerText(), /started from the defaults/);
    await page.locator('[data-theme-pick="dark"]').click();
    assert.deepEqual((await state(page)).run, saved.run, 'an edit keeps the current run after the unreadable save is copied');
    await assertFieldsMatchState(page, 'after safely replacing a copied save from another tab');
    await otherTab.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: STATE_KEY, raw: second });
    await page.locator('[data-action="replace-unreadable"]').waitFor();
    assert.match(await page.locator('[data-unreadable-save]').innerText(), /does not save changes/);
    await page.locator('[data-theme-pick="light"]').click();
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), STATE_KEY), second, 'an ordinary edit keeps the uncopied original');
    const downloading = page.waitForEvent('download');
    await page.locator('[data-action="download-unreadable"]').click();
    assert.equal(await readFile(await (await downloading).path(), 'utf8'), second, 'the current original is available to download');
    await page.locator('[data-action="replace-unreadable"]').click();
    await confirmDialog(page);
    await page.locator('[data-action="remove-unreadable"]').waitFor();
    assert.equal((await state(page)).ui.theme, 'light');
    assert.deepEqual((await state(page)).run, saved.run);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), UNREADABLE_KEY), first, 'explicit replacement preserves the earlier copy');
    await assertFieldsMatchState(page, 'after explicitly replacing an uncopied save from another tab');
  });


  test('an edit after a missed unreadable storage event protects the original and an earlier copy', async (t) => {
    const saved = shareFixture();
    saved.inventory = { 30028: 2 };
    const page = await editor(t, saved);
    const unreadable = '{missed broken save', earlier = '{older broken save';
    // A same-page write models a change from another tab whose storage event was missed.
    await page.evaluate(({ key, copyKey, raw, copy }) => {
      localStorage.setItem(copyKey, copy);
      localStorage.setItem(key, raw);
    }, { key: STATE_KEY, copyKey: UNREADABLE_KEY, raw: unreadable, copy: earlier });
    assert.equal(await page.locator('[data-unreadable-save]').count(), 0, 'the change has not been observed yet');
    await page.locator('[data-theme-pick="dark"]').click();
    await page.locator('[data-action="replace-unreadable"]').waitFor();
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), STATE_KEY), unreadable);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), UNREADABLE_KEY), earlier);
    assert.equal(await page.locator('[data-action="clear-trainee"]').count(), 1, 'the current run stays usable');
    await page.locator('[data-action="replace-unreadable"]').click();
    await confirmDialog(page);
    assert.deepEqual((await state(page)).run, saved.run);
    assert.deepEqual((await state(page)).inventory, saved.inventory);
    assert.equal((await state(page)).ui.theme, 'dark');
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), UNREADABLE_KEY), earlier);
    await assertFieldsMatchState(page, 'after an explicit replacement following a missed unreadable storage event');
  });


  test('blocked browser storage still allows planning, themes and reset', async (t) => {
    const page = await fresh(t, undefined, { held: true, init: () => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
    } });
    await page.locator('[data-storage-warning]').waitFor();
    await trainee(page);
    await page.locator('[data-theme-pick="dark"]').click();
    assert.equal(await page.locator('[data-theme-pick="dark"]').getAttribute('aria-pressed'), 'true');
    await waitForShare(page);
    assert.ok((await decodeShare(shareCode(page.url()))).run.traineeCardId);
    await page.locator('[data-action="reset-all"]').click();
    await confirmDialog(page);
    assert.equal(await page.locator('[data-waiting]').count(), 1);
    assert.equal(shareCode(page.url()), null);
    assert.equal(await page.locator('[data-storage-warning]').count(), 1);
  });
});
