import assert from 'node:assert/strict';
import { assertFieldsMatchState } from './browser-fields.mjs';
import { STATE_KEY } from '../src/state.ts';

/** Run in the smoke browser after planner checks, retaining its run to verify page independence. */
export async function checkMissions(page, url, overflowReport) {
  const read = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  const previous = await read();
  await page.addInitScript(() => { Date.now = () => new Date('2026-10-04T12:00:00Z').getTime(); });
  await page.goto(new URL('missions.html', url).href);
  await page.waitForSelector('[data-mission-event="201"]');
  assert.equal(await page.locator('[data-mission-event="201"]').isChecked(), true);
  assert.equal(await page.locator('[data-mission-event="202"]').isChecked(), true);
  await assertFieldsMatchState(page, 'with current missions selected');
  await page.locator('[data-mission-event="202"]').uncheck();
  await assertFieldsMatchState(page, 'after deselecting Japan Cup');
  assert.equal(await page.locator('[data-mission-race]').count(), 6, 'three named races, each available in two years');
  assert.equal(await page.locator('[data-mission-slot="43"] [data-mission-race]').count(), 2, 'Fuji and Swan collide in Classic late October');
  await page.locator('[data-mission-recommend="105301"]').click();
  await assertFieldsMatchState(page, 'after selecting Bamboo Memory');
  assert.match(await page.locator('[data-mission-fit]').innerText(), /3 \/ 3/);
  assert.equal(await page.locator('[data-mission-slot="43"] [data-mission-race="89"].mission-suggested').count(), 1);
  assert.equal(await page.locator('[data-mission-slot="67"] [data-mission-race="112_2"].mission-suggested').count(), 1);
  assert.ok(await page.locator('[data-mission-goal-conflict]').count());
  await page.locator('[data-mission-complete="1001373"]').first().check();
  await assertFieldsMatchState(page, 'after checking Fuji Stakes');
  assert.equal(await page.locator('[data-mission-complete="1001373"]:checked').count(), 3, 'both runnings and the checklist stay in sync');
  await page.reload();
  await page.waitForSelector('[data-mission-fit]');
  await assertFieldsMatchState(page, 'after reloading mission progress');
  assert.match(await page.locator('[data-mission-fit]').innerText(), /2 \/ 2/);
  await page.locator('[data-mission-event="201"]').uncheck();
  await assertFieldsMatchState(page, 'after clearing built-in selections');
  await page.getByText('Paste missions from GameTora', { exact: true }).click();
  await page.locator('[data-mission-paste]').fill('x20000\nMile Ch.: Complete 2 Career playthroughs having cleared all Career goals\nx1\nMile Ch.: Win the Fuji Stakes in Career\nx1\nMile Ch.: Win the Swan Stakes in Career\nx10000\nMile Ch.: Win the Mile Championship in Career\nx150\nMile Ch.: Complete all special missions\nWin an unknown race');
  await page.locator('[data-action="import-missions"]').click();
  await assertFieldsMatchState(page, 'after pasting mission requirements');
  assert.equal((await read()).missions.pastedLines.length, 6);
  assert.equal(await page.locator('[data-mission-race]').count(), 6);
  assert.equal(await page.getByText('Win an unknown race', { exact: false }).count(), 1);
  await page.locator('[data-mission-complete]').first().check();
  await assertFieldsMatchState(page, 'after checking a pasted requirement');
  await page.locator('#mission-trainee-search').fill('Haru Urara');
  await page.locator('[data-action="pick-mission-trainee"]').first().click();
  await assertFieldsMatchState(page, 'after picking a different mission trainee');
  assert.match(await page.locator('[data-mission-fit]').innerText(), /0 \/ 3/);
  await page.getByText('Add a race', { exact: true }).click();
  await page.locator('[data-mission-race-search]').fill('Yasuda Kinen');
  await page.locator('[data-add-mission-race="1011"]').click();
  await assertFieldsMatchState(page, 'after adding an extra race');
  await page.locator('[data-custom-race-complete="1011"]').check();
  await assertFieldsMatchState(page, 'after checking an extra race');
  await page.locator('[data-mission-event-picker]').selectOption('206');
  await assertFieldsMatchState(page, 'after selecting an upcoming set');
  assert.equal(await page.locator('[data-mission-event="206"]').isChecked(), true);
  await page.reload();
  await page.waitForSelector('[data-mission-event="206"]');
  await assertFieldsMatchState(page, 'after reloading imported missions, custom races and an upcoming set');
  const saved = await read();
  assert.deepEqual(saved.run, previous.run, 'mission interactions preserve the planner run');
  assert.deepEqual(saved.inventory, previous.inventory);
  assert.deepEqual(saved.settings, previous.settings);
  const otherTab = await page.context().newPage();
  await otherTab.goto(new URL('missions.html', url).href);
  await otherTab.locator('[data-custom-race-complete="1011"]').uncheck();
  await page.waitForFunction(() => !document.querySelector('[data-custom-race-complete="1011"]').checked);
  await assertFieldsMatchState(page, 'after another tab changes mission progress');
  await page.locator('[data-mission-event="206"]').click();
  assert.ok(!(await read()).missions.completedCustomRaceIds.includes(1011), 'the next edit does not overwrite progress from another tab');
  await otherTab.close();
  for (const scheme of ['light', 'dark']) {
    await page.locator(`[data-theme-pick="${scheme}"]`).click();
    for (const width of [390, 768, 1280, 1440, 1680, 1920]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      assert.deepEqual(await overflowReport(), [], `mission overflow at ${width}px ${scheme}`);
    }
  }
  console.log('mission selection, paste, progress, recommendations, independence and layout ok');
}
