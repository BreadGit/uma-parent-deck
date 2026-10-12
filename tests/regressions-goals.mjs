import assert from 'node:assert/strict';
import { test, after, suite } from 'node:test';
import { defaultState, STATE_KEY } from '../src/state.ts';
import { assertFieldsMatchState } from './browser-fields.mjs';
import { data, editor, state, trainee, target, coverage, predictions, confirmDialog, openAgenda, openDetails } from './browser-fixtures.mjs';

suite('goals browser regressions', { concurrency: Number(process.env.BROWSER_TEST_CONCURRENCY ?? 2) }, () => {


  test('Narita Brian displays one race per occupied slot and counts each goal once', async (t) => {
    const page = await editor(t);
    await trainee(page, 'narita brian maverick');
    const heading = await page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'G1 agenda', exact: true }) }).locator('[data-panel-sub]').innerText();
    assert.match(heading, /18 races.*11 career goals/);
    await openAgenda(page);
    assert.equal(await page.locator('.agenda-cell.sel').count(), 18);
    assert.equal(Number(heading.match(/^(\d+) races/)[1]), await page.locator('.agenda-cell.sel').count());
  });


  test('inherited Corner Recovery and Lucky Seven hints do not gain fictitious circle upgrades', async (t) => {
    const saved = defaultState(data);
    saved.run.targets = [200352, 201562, 200012, 201032];
    saved.run.targetLineage = Object.fromEntries(saved.run.targets.map((id) => [id, [3, 0, 0, 0, 0, 0]]));
    // Isolate inherited hints while still building a complete deck through the regular UI.
    Object.assign(saved.settings, { hintBase: 0, chainRatesSSR: [0, 0, 0], chainRatesSR: [0, 0], randomEventRate: 0,
      palChainRate: 0, groupOutingRate: 0, groupFinaleRate: 0, specialEventRate: 0 });
    const page = await editor(t, saved);
    await openDetails(page);
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


  test('the results keep the missing-choice notice and the pink spark shortcut while the inputs are hidden', async (t) => {
    const saved = defaultState(data);
    saved.run.traineeCardId = 100101;
    saved.run.pinnedIds.push(99999992);
    saved.run.goal = { ...saved.run.goal, pink: [{ aptitude: 'dirt', stars: 1 }] };
    saved.run.pinkLineage = [{ aptitude: 'dirt', stars: 3 }, null, null, null, null, null];
    const page = await editor(t, saved);
    await page.click('[data-action="hide-inputs"]');
    await page.waitForSelector('[data-inputs]', { state: 'detached' });
    assert.equal((await state(page)).ui.inputsHidden, true);
    assert.match(await page.locator('[data-unavailable-choices]').innerText(), /99999992/, 'a missing shared card is reported beside the results');
    assert.equal(await page.locator('[data-goal-warnings]').count(), 1, 'a dirt spark on a G dirt trainee makes the pink estimate a range');
    await page.click('[data-action="goal-refine-pink"]');
    await page.waitForSelector('[data-pink-lineage="0"]');
    assert.equal((await state(page)).ui.inputsHidden, false, 'the shortcut shows the input column');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.pinkLineage), '0', 'and focuses the first pink spark field');
    assert.equal(await page.locator('[data-unavailable-choices]').count(), 1, 'the notice moves into the input column');
    await assertFieldsMatchState(page, 'after opening pink sparks from the warnings');
  });


  test('white targets migrate old goals and support zero or many required sparks', async (t) => {
    const saved = defaultState(data);
    saved.version = 7;
    saved.run.traineeCardId = 100101;
    saved.run.targets = [200012];
    saved.run.goal = { ...saved.run.goal, pink: 'end', required: [{ id: null, stars: 2 }, { id: 200352, stars: 3 }], preferred: [201601, 200472] };
    saved.run.aptOverrides.end = 'B';
    saved.run.pinkLineage = Array.from({ length: 6 }, () => ({ aptitude: 'end', stars: 3 }));
    const page = await editor(t, saved);
    assert.equal(await page.locator('[data-target-count="required"]').innerText(), '1');
    assert.equal(await page.locator('[data-action="select-target"]').count(), 4);
    assert.equal(await page.locator('[data-goal-required]').count(), 0);
    for (const id of [200012, 201601, 200472]) {
      await page.click(`[data-action="select-target"][data-id="${id}"]`);
      await page.click(`[data-target-role="required"][data-id="${id}"]`);
    }
    assert.equal(await page.locator('[data-target-count="required"]').innerText(), '4');
    assert.equal(await page.locator('.deck .slot').count(), 6);
    assert.equal(await page.locator('[data-goal-issues]').count(), 0);
    await page.reload();
    await page.waitForSelector('[data-target-count="required"]');
    assert.equal(await page.locator('[data-target-count="required"]').innerText(), '4');
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
    await openDetails(page);
    assert.match(await page.locator('[data-goal-details]').innerText(), /No required white sparks/);
    const probability = await page.locator('[data-goal-probability]').innerText();
    await page.reload();
    await page.waitForSelector('[data-goal-result]');
    assert.equal(await page.locator('[data-goal-probability]').innerText(), probability);
    await page.selectOption('[data-apt="end"]', 'C');
    assert.equal(await page.locator('[data-goal-warnings]').count(), 0);
    assert.match(await page.locator('[data-goal-probability]').innerText(), /%/);
  });


  test('selecting a target name toggles its editor and removal updates goals without activating another target', async (t) => {
    const page = await editor(t);
    await target(page, 'Groundwork');
    assert.equal(await page.locator('[data-target-editor]').getAttribute('data-target-editor'), '201601');
    await page.click('[data-target-role="required"]');
    await page.selectOption('[data-target-stars="201601"]', '3');
    await page.selectOption('[data-lineage-copies="201601"]', '2');
    await page.selectOption('[data-lineage-stars="201601"]', '4');
    assert.equal(await page.locator('[data-target-editor] h3').first().innerText(), 'Goals for target white spark');
    assert.match(await page.locator('[data-target-editor] h3').last().innerText(), /^White sparks in lineage/);
    assert.equal(await page.locator('[data-target-editor] [data-action="remove-target"]').count(), 1);
    await target(page, 'Lucky Seven');
    await page.click('[data-action="select-target"][data-id="201601"]');
    assert.equal(await page.inputValue('[data-target-stars="201601"]'), '3');
    assert.equal(await page.inputValue('[data-lineage-stars="201601"]'), '4');
    await page.locator('[data-action="select-target"][data-id="201601"]').press('Enter');
    assert.equal(await page.locator('[data-target-editor]').count(), 0);
    await page.locator('[data-action="select-target"][data-id="201601"]').press('Enter');
    assert.equal(await page.locator('[data-target-editor]').count(), 1);
    await page.click('[data-action="select-target"][data-id="201562"]');
    await page.click('[data-action="remove-target"][data-id="201562"]');
    assert.equal(await page.locator('[data-target-editor]').count(), 0, 'removing the selected target closes its editor without opening another');
    assert.deepEqual((await state(page)).run.targets.filter((t) => t.role === 'preferred'), []);
    await page.click('[data-action="select-target"][data-id="201601"]');
    assert.equal(await page.inputValue('[data-target-stars="201601"]'), '3');
    await page.click('[data-action="remove-target"][data-id="201601"]');
    assert.equal(await page.locator('[data-target-editor]').count(), 0);
    const after = await state(page);
    assert.deepEqual(after.run.targets, []);
    assert.deepEqual(after.run.targets.filter((t) => t.role === 'required'), []);
    assert.deepEqual(after.run.targetLineage, {});
    await page.reload();
    await page.waitForSelector('#target-search-required');
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
    await openDetails(page);
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
    await openDetails(page);
    assert.match(await pinkRow.innerText(), /100(?:\.0)?%/);
  });


  test('pink reset clears manual and inferred sparks and starting increases while preserving other inputs', async (t) => {
    const page = await editor(t);
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
    const pinkProbability = async () => { await openDetails(page); return page.locator('[data-goal-details] tbody tr').filter({ hasText: /^Pink \(/ }).locator('td').last().innerText(); };
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


  test('the per-parent lineage form keeps grandparent placement through totals edits and follows the editor between targets', async (t) => {
    const saved = defaultState(data);
    saved.run.traineeCardId = 100101;
    saved.run.targets = [{ id: 201601, role: 'required', stars: 2, priority: 0 }, { id: 200012, role: 'preferred', stars: 2, priority: 0 }];
    saved.run.targetLineage = { 201601: [0, 2, 0, 0, 0, 1] };
    const page = await editor(t, saved);
    await page.click('[data-action="select-target"][data-id="201601"]');
    assert.equal(await page.inputValue('[data-lineage-copies="201601"]'), '2');
    assert.equal(await page.inputValue('[data-lineage-stars="201601"]'), '3');
    await page.selectOption('[data-lineage-stars="201601"]', '5');
    assert.deepEqual((await state(page)).run.targetLineage[201601], [0, 3, 0, 0, 0, 2], 'more stars raise the entered grandparents rather than moving them');
    await page.selectOption('[data-lineage-copies="201601"]', '3');
    assert.deepEqual((await state(page)).run.targetLineage[201601], [3, 3, 0, 0, 0, 2], 'a new copy starts at 3★ on parent 1');
    await page.click('[data-action="toggle-lineage-parents"]');
    await page.waitForSelector('[data-lineage-parents="201601"]');
    assert.equal(await page.getAttribute('[data-action="toggle-lineage-parents"]', 'aria-pressed'), 'true');
    assert.deepEqual(await page.$$eval('[data-lineage-uma]', (els) => els.map((s) => [s.value, s.classList.contains('set')])), [['3', true], ['3', true], ['0', false], ['0', false], ['0', false], ['2', true]]);
    // Another tab sets a different slot, and this page misses its storage event (a page's own writes raise none).
    await page.evaluate((key) => {
      const other = JSON.parse(localStorage.getItem(key));
      other.run.targetLineage[201601][3] = 2;
      localStorage.setItem(key, JSON.stringify(other));
    }, STATE_KEY);
    await page.selectOption('[data-lineage-uma="201601-0"]', '0');
    assert.deepEqual((await state(page)).run.targetLineage[201601], [0, 3, 0, 2, 0, 2], 'the edit keeps the other tab\'s slot');
    assert.equal(await page.locator('[data-lineage-summary="201601"]').innerText(), '3 copies · 7★ total');
    await assertFieldsMatchState(page, 'after clearing a parent in the per-parent form');
    await page.click('[data-action="select-target"][data-id="200012"]');
    assert.equal(await page.locator('[data-lineage-parents="200012"]').count(), 1, 'the form stays open for the next target');
    assert.deepEqual(await page.$$eval('[data-lineage-uma]', (els) => els.map((s) => s.value)), ['0', '0', '0', '0', '0', '0']);
    for (const slot of [0, 1, 2, 3, 4, 5]) await page.selectOption(`[data-lineage-uma="200012-${slot}"]`, '0');
    assert.equal((await state(page)).run.targetLineage[200012], undefined, 'six empty umas store no entry');
    await page.selectOption('[data-lineage-uma="200012-5"]', '1');
    await page.selectOption('[data-lineage-uma="200012-5"]', '0');
    assert.equal((await state(page)).run.targetLineage[200012], undefined, 'clearing the last copy drops the entry');
    await page.click('[data-action="toggle-lineage-parents"]');
    await page.waitForSelector('[data-lineage-parents]', { state: 'detached' });
    assert.equal(await page.inputValue('[data-lineage-copies="200012"]'), '0');
    assert.equal(await page.isDisabled('[data-lineage-stars="200012"]'), true, 'no copies: the star total is disabled');
    await assertFieldsMatchState(page, 'after returning to lineage totals');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('[data-action="toggle-lineage-parents"]');
    await page.waitForSelector('[data-lineage-parents="200012"]');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the per-parent form fits a phone');
  });


  test('legacy saves retain negative choices as unavailable and keep gold-only targets editable', async (t) => {
    const gold = data.skills.find((s) => s.name === 'Runaway');
    const saved = { version: 6, run: { targets: [200433, 200432, gold.id], targetLineage: { 200433: { k1: 1, k2: 0, p1: 2, p2: 0 }, [gold.id]: { k1: 1, k2: 0, p1: 3, p2: 0 } } } };
    const page = await editor(t, saved);
    for (const id of [200432, gold.id]) assert.equal(await page.locator(`[data-action="select-target"][data-id="${id}"]`).count(), 1);
    assert.equal(await page.locator('[data-action="select-target"][data-id="200433"]').count(), 0, 'Gatekept is not a white-spark target');
    assert.match(await page.locator('[data-unavailable-choices]').innerText(), /200433/);
    await page.click(`[data-action="select-target"][data-id="${gold.id}"]`);
    assert.match(await page.locator('[data-target-unsupported]').innerText(), /no released white spark/);
    assert.equal(await page.inputValue(`[data-lineage-stars="${gold.id}"]`), '3');
    await page.click('[data-target-role="required"]');
    await assertFieldsMatchState(page, 'after editing a preserved gold-only target');
    assert.deepEqual((await state(page)).run.targetLineage, { 200433: [2, 0, 0, 0, 0, 0], [gold.id]: [3, 0, 0, 0, 0, 0] }, 'per-side totals from an older save place their copies on the parents');
    await page.reload();
    assert.deepEqual((await state(page)).run.targets.map((t) => t.id), saved.run.targets);
    assert.match(await page.locator('[data-unavailable-choices]').innerText(), /200433/);
    await page.fill('#target-search-required', 'Runaway');
    await page.click(`[data-action="add-target"][data-id="${gold.id}"]`);
    assert.equal((await state(page)).run.targets.length, 3, 'search resolves the retained target without duplicating it');
    await assertFieldsMatchState(page, 'after finding the preserved gold-only target');
  });


  test('goal explanations distinguish a difficult requirement, missing pink eligibility, and an impossible white spark', async (t) => {
    const saved = defaultState(data);
    saved.run.traineeCardId = 100101;
    saved.run.goal = { ...saved.run.goal, blueStars: 1, pink: [{ aptitude: 'any', stars: 3 }] };
    const page = await editor(t, saved);
    await openDetails(page);
    const limits = page.locator('[data-goal-limits]');
    assert.match(await page.locator('[data-goal-probability]').innerText(), /Chance per final spark roll/);
    // Skill availability assumes obtainable forms are bought; it is not a check against the SP budget.
    assert.match(await page.locator('[data-goal-availability]').textContent(), /assume every obtainable target form is bought; they do not check the SP budget/);
    // Any 1-star blue is certain. Any 3-star pink is 10%, so pink is the limiting individual roll.
    assert.match(await limits.innerText(), /Lowest individual chance is Any pink aptitude at 3★ or better at 10\.0%/);
    await page.selectOption('[data-goal-pink]', 'end');
    assert.match(await limits.innerText(), /End Closer pink cannot reach final A\/S under the entered grades and pink sparks/);
    assert.doesNotMatch(await limits.innerText(), /Lowest individual chance/);
    await assertFieldsMatchState(page, 'after explaining missing pink eligibility');
    const runaway = data.skills.find((s) => s.name === 'Runaway');
    await page.fill('#target-search-required', 'Runaway');
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
    await openDetails(page);
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
      const disabled = page.locator('[data-lineage-stars="201601"]');
      assert.equal(await disabled.isDisabled(), true);
      assert.ok(await disabled.evaluate((el) => Number(getComputedStyle(el).opacity) < 1), theme);
      await assertFieldsMatchState(page, `after checking field cues in ${theme}`);
    }
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
    assert.match(await page.locator('[data-action="select-target"]').innerText(), /P2$/);
    await page.click('[data-target-role="required"]');
    await page.selectOption('[data-target-stars="201601"]', '3');
    await assertFieldsMatchState(page, 'after setting required stars');
    assert.match(await page.locator('[data-action="select-target"]').innerText(), /3★\+$/);
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
    saved.run.targetLineage = { 210052: [2, 0, 0, 0, 0, 0] };
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
    assert.equal(await page.inputValue('[data-lineage-copies="210052"]'), '1');
    assert.equal(await page.inputValue('[data-lineage-stars="210052"]'), '2');
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
});
