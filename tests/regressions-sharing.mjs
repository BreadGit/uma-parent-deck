import assert from 'node:assert/strict';
import { test, suite } from 'node:test';
import { defaultState } from '../src/state.ts';
import { assertFieldsMatchState, BASE_URL as url } from './browser-fields.mjs';
import { encodeShare, decodeShare, shareCode, sharedChoices, shareUrl } from '../src/share.ts';
import { data, editor, state, confirmDialog, waitForShare, navigateShare, shareFixture, holdNextShareStream } from './browser-fixtures.mjs';

suite('sharing browser regressions', { concurrency: Number(process.env.BROWSER_TEST_CONCURRENCY ?? 2) }, () => {


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
    assert.equal(await page.inputValue('[data-lineage-copies="210052"]'), '6');
    assert.equal(await page.inputValue('[data-lineage-stars="210052"]'), '14');
    await page.selectOption('[data-lineage-stars="210052"]', '15');
    await page.click('[data-action="load-goal-template"]');
    await confirmDialog(page);
    assert.deepEqual((await state(page)).run.targetLineage[210052], [3, 3, 2, 3, 2, 2], 'the extra star goes to the first grandparent and a reload of the template keeps it');
    await page.reload();
    await assertFieldsMatchState(page, 'after reloading edited template lineage');
    assert.deepEqual((await state(page)).run.targetLineage[210052], [3, 3, 2, 3, 2, 2]);
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
    assert.deepEqual(await decodeShare(shareCode(page.url())), sharedChoices(saved));
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
      await page.waitForSelector('#target-search-required');
      await waitForShare(page);
      assert.deepEqual(sharedChoices(await state(page)), sharedChoices(incoming));
      assert.deepEqual(await decodeShare(shareCode(page.url())), sharedChoices(incoming));
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
    assert.deepEqual(await decodeShare(shareCode(page.url())), sharedChoices(latest));
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
    assert.deepEqual(await decodeShare(shareCode(page.url())), sharedChoices(saved));
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
    const link = new URL(url);
    link.searchParams.set('keep', 'yes'); link.hash = 'shared';
    await page.goto(shareUrl(link.href, await encodeShare(sharedChoices(source))));
    await page.waitForSelector('#target-search-required');
    await waitForShare(page);
    const loaded = await state(page);
    assert.deepEqual(sharedChoices(loaded), sharedChoices(source));
    assert.deepEqual(loaded.inventory, receiver.inventory);
    assert.deepEqual(loaded.run.raceOverrides, source.run.raceOverrides);
    assert.equal(loaded.settings.affinity, 220); assert.equal(loaded.ui.theme, 'dark');
    await assertFieldsMatchState(page, 'after opening a share URL');
    const historyLength = await page.evaluate(() => history.length);
    await page.selectOption('[data-setting="focus"]', 'balanced');
    assert.equal(shareCode(page.url()), null, 'remove stale snapshots during the debounce');
    await page.reload();
    await page.waitForSelector('#target-search-required');
    assert.equal((await state(page)).settings.focus, 'balanced', 'reload keeps the edit made before compression');
    await waitForShare(page);
    assert.equal((await decodeShare(shareCode(page.url()))).settings.focus, 'balanced');
    assert.equal(new URL(page.url()).searchParams.get('keep'), 'yes');
    assert.match(new URL(page.url()).hash, /^#shared&run=/, 'other fragment text is kept');
    assert.equal(await page.evaluate(() => history.length), historyLength);
    await assertFieldsMatchState(page, 'after reloading a just-edited share');
    const currentUrl = page.url();
    await page.click('[data-theme-pick="light"]');
    assert.equal(page.url(), currentUrl, 'theme edits do not rewrite the share code');
    await page.click('[data-action="reset-all"]');
    await page.click('[data-dialog-confirm]');
    await page.waitForFunction(() => document.querySelector('#trainee-search'));
    await page.waitForTimeout(500);
    assert.equal(shareCode(page.url()), null);
    assert.deepEqual((await state(page)).inventory, receiver.inventory);
    assert.equal((await state(page)).settings.affinity, 220);
    await assertFieldsMatchState(page, 'after resetting a shared run');
  });


  test('older query share links still load, and no request carries a share code', async (t) => {
    const page = await editor(t, defaultState(data));
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    const source = shareFixture();
    const code = await encodeShare(sharedChoices(source));
    const older = new URL(url);
    older.searchParams.set('run', code);
    await page.goto(older.href);
    await page.waitForSelector('#target-search-required');
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('run'));
    assert.deepEqual(sharedChoices(await state(page)), sharedChoices(source));
    assert.deepEqual(await decodeShare(shareCode(page.url())), sharedChoices(source), 'the code moved into the fragment');
    requests.length = 0;
    await page.reload();
    await page.waitForSelector('#target-search-required');
    await waitForShare(page);
    assert.ok(requests.length > 0);
    assert.deepEqual(requests.filter((request) => request.includes(code) || /[?&]run=/.test(request)), [], 'reloading sends no share code');
    await assertFieldsMatchState(page, 'after loading an older query link');
  });


  test('share URL navigation rejects bad input atomically without sharing controls', async (t) => {
    const page = await editor(t, shareFixture());
    await waitForShare(page);
    assert.equal(await page.locator('[data-share-controls], [data-share], [data-section="share"]').count(), 0);
    assert.equal(await page.getByText('Share run', { exact: true }).count(), 0);
    const before = await state(page);
    for (const code of ['2dinvalid', '7jW10']) {
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
    saved.run.targetLineage['99999991'] = [3, 3, 3, 3, 3, 3];
    saved.run.pinnedIds.push(99999992);
    saved.run.wishlistOrder.push(99999993);
    const page = await editor(t, saved);
    await waitForShare(page);
    assert.match(await page.locator('[data-unavailable-choices]').innerText(), /99999991/);
    assert.match(await page.locator('[data-unavailable-choices]').innerText(), /99999992/);
    assert.match(await page.locator('[data-unavailable-choices]').innerText(), /99999993/);
    await page.selectOption('[data-setting="focus"]', 'balanced');
    await waitForShare(page);
    await page.reload(); await page.waitForSelector('#target-search-required'); await waitForShare(page);
    saved.settings.focus = 'balanced';
    assert.deepEqual(sharedChoices(await state(page)), sharedChoices(saved));
    assert.deepEqual(await decodeShare(shareCode(page.url())), sharedChoices(saved));
    await assertFieldsMatchState(page, 'after reloading unavailable choices');
  });


  test('slow share compression cannot overwrite a newer edit', async (t) => {
    const page = await editor(t, shareFixture());
    await waitForShare(page);
    const encoding = await holdNextShareStream(page, 'CompressionStream');
    await page.selectOption('[data-setting="focus"]', 'balanced');
    await encoding.started();
    await page.selectOption('[data-setting="focus"]', 'stamina');
    await waitForShare(page);
    const newestUrl = page.url();
    assert.equal((await decodeShare(shareCode(newestUrl))).settings.focus, 'stamina');
    await encoding.release();
    assert.equal(page.url(), newestUrl);
    await assertFieldsMatchState(page, 'after overlapping share encodes');
  });


  test('invalid startup shares keep the saved run and a valid URL recovers', async (t) => {
    const page = await editor(t, shareFixture());
    const before = await state(page);
    await page.goto(shareUrl(url, '7jW10'));
    await page.waitForSelector('#target-search-required');
    await page.waitForSelector('[data-dialog]');
    assert.deepEqual(await state(page), before);
    assert.equal(shareCode(page.url()), '7jW10');
    await page.click('[data-dialog-confirm]');
    await page.goto(shareUrl(url, '2jW10'));
    await page.waitForSelector('#trainee-search');
    await page.waitForTimeout(500);
    const expected = await decodeShare('2jW10');
    expected.run.raceOverrides = {};
    assert.deepEqual(sharedChoices(await state(page)), expected);
    assert.deepEqual(await decodeShare(shareCode(page.url())), expected);
    await assertFieldsMatchState(page, 'after recovering from an invalid startup URL');
  });


  test('a share import remains copyable when the browser cannot save it', async (t) => {
    const page = await editor(t, shareFixture());
    await waitForShare(page);
    const before = await state(page);
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); }; });
    const incoming = defaultState(data);
    incoming.settings.focus = 'balanced';
    await navigateShare(page, shareUrl(url, await encodeShare(sharedChoices(incoming))));
    await page.waitForSelector('[data-storage-warning]');
    assert.match(await page.locator('[data-storage-warning]').innerText(), /cannot save/);
    await waitForShare(page);
    assert.equal((await decodeShare(shareCode(page.url()))).run.traineeCardId, null);
    assert.deepEqual(await state(page), before, 'the existing persisted save was not damaged');
    assert.equal(await page.locator('#trainee-search').count(), 1, 'the decoded choices remain usable in memory');
  });


  test('share URLs restore manual schedule picks and skips and reset to automatic', async (t) => {
    const page = await editor(t, shareFixture());
    await waitForShare(page);
    await page.locator('[data-agenda] summary').click();
    // The forced race is a Senior-year running, whose calendar ID carries a suffix that formats before 6 could not share.
    const picks = await page.locator('[data-slot]').evaluateAll((fields) => {
      const later = (field) => [...field.options].find((o) => o.value.includes('_') && o.value !== field.value);
      const skip = fields.find((field) => field.value !== '');
      const force = fields.find((field) => field !== skip && later(field));
      return { skip: skip.dataset.slot, force: force.dataset.slot, race: later(force).value };
    });
    assert.match(picks.race, /_/);
    await page.selectOption(`[data-slot="${picks.skip}"]`, '');
    await page.selectOption(`[data-slot="${picks.force}"]`, picks.race);
    await waitForShare(page);
    const overrides = (await state(page)).run.raceOverrides;
    assert.ok(Object.values(overrides).includes(false));
    assert.equal(overrides[picks.race], true);
    const link = page.url();
    assert.deepEqual((await decodeShare(shareCode(link))).run.raceOverrides, overrides);
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
    assert.deepEqual((await decodeShare(shareCode(other.url()))).run.raceOverrides, {});
    await assertFieldsMatchState(other, 'after resetting shared agenda choices');
  });
});
