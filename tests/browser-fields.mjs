import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import playwright from 'playwright';
import { buildVersion, BUILD_VERSION_PATH, parseBuildVersion } from '../scripts/build-version.ts';
import { BLUE_SPARK_START_GAIN_BY_STARS } from '../src/model/rules.ts';
import { loadData } from '../src/data.ts';
import { startingAptitudes } from '../src/model/pink-inherit.ts';
import { effectiveLb } from '../src/model/run.ts';
import { migrate, STATE_KEY } from '../src/state.ts';
import missionCatalog from '../data/missions.json' with { type: 'json' };
const data = loadData();

/** The server the browser suites test; set URL for a server on another port. */
export const BASE_URL = process.env.URL ?? 'http://localhost:5173/';

/** Launches the engine named by BROWSER (chromium, firefox or webkit), Chromium by default. */
export function launchBrowser(options) {
  const name = process.env.BROWSER ?? 'chromium';
  if (!['chromium', 'firefox', 'webkit'].includes(name)) throw new Error(`BROWSER must be chromium, firefox or webkit, not ${name}`);
  return playwright[name].launch(options);
}

/** Resolves after the next two animation frames, once layout and paint have caught up. */
export const settled = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/**
 * Change the save as another tab would. A page gets no storage event for its own writes, so it misses this one the
 * way a frozen or back-forward-cached tab does; `edit` changes the stored state in place.
 */
export async function writeMissedSave(page, edit) {
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  edit(saved);
  await page.evaluate(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), { key: STATE_KEY, saved });
}

/** The scanner's exported inventory. The JSON is built only while the preview is open, so open it before reading. */
export async function previewJson(page) {
  const preview = page.locator('[data-preview]');
  if (!await preview.evaluate(details => details.open)) await preview.locator('summary').click();
  return JSON.parse(await page.locator('[data-json]').textContent());
}
const root = fileURLToPath(new URL('..', import.meta.url));
const servedVersions = new Map();
let ourVersion;

/**
 * Loads the app and checks that the server at `url` serves this checkout. A dev server for another worktree answers
 * on the default port with other code, and its failures then read as bugs in this tree. Vite exposes the build hash
 * the app itself reads, so the comparison costs one fetch per server; a preview build has no such module and is
 * accepted as is. A server that does not answer fails with the command that starts one.
 */
export async function openApp(page, url) {
  try {
    await page.goto(url);
  } catch (error) {
    throw new Error(`no server answered at ${url}: start \`npm run dev\` in ${root} or pass URL=<address>`, { cause: error });
  }
  await assertServesThisTree(url);
}

export async function assertServesThisTree(url) {
  if (!servedVersions.has(url)) {
    servedVersions.set(url, fetch(new URL(BUILD_VERSION_PATH, url)).then((r) => (r.ok ? r.text() : '')).then(parseBuildVersion).catch(() => null));
  }
  const theirs = await servedVersions.get(url);
  if (theirs === null) return;
  ourVersion ??= buildVersion(root);
  assert.equal(theirs, ourVersion, `the server at ${url} serves a different checkout than ${root} (served ${theirs.slice(0, 12)}, here ${ourVersion.slice(0, 12)}). ` +
    'Find its directory with `readlink /proc/<pid>/cwd` (pid from `ss -ltnp`), or start one here with `npm run dev -- --port <n> --strictPort` and pass URL=http://localhost:<n>/');
}

/** Waits for a completed search; rejects search failures and held workers. Call it explicitly before asserting on the result. */
export async function waitForPlan(page) {
  assert.notEqual(await page.evaluate(() => window.__searchHeld), true, 'release held search before asserting optimizer completion');
  await page.waitForSelector('.results');
  await page.waitForFunction(() => !document.querySelector('[data-plan-pending]'), undefined, { timeout: 45000 });
  assert.equal(await page.locator('[data-action="retry-search"]').count(), 0, 'search completed successfully');
}

/**
 * Every form field that mirrors persisted state must show that state. A <select> the user has changed ignores later
 * `selected` attribute changes on its options, so a field that lit reuses for a different card or stat would keep a
 * stale value unless its value is bound live; this catches that whatever the field.
 */
export async function assertFieldsMatchState(page, where) {
  await page.waitForSelector('.results');
  const current = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), STATE_KEY);
  const saved = migrate({ current }, data);
  const trainee = data.charByCardId.get(saved.run?.traineeCardId);
  const expectedAptitudes = trainee ? startingAptitudes(trainee.aptitudes, saved.run.aptOverrides, saved.run.pinkLineage) : null;
  const expectedLb = Object.fromEntries(data.cards.map((card) => [card.id, effectiveLb(saved.inventory, card, saved.settings.inventoryOverrides)]));
  const bad = await page.evaluate(({ gainByStars, expectedAptitudes, expectedLb, st, missionEvents }) => {
    const out = [];
    const STATS = ['speed', 'stamina', 'power', 'guts', 'wit'];
    for (const el of document.querySelectorAll('select[data-lb]')) {
      const lb = expectedLb[el.dataset.lb];
      const want = lb === null ? 'none' : String(lb);
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
      const over = expectedAptitudes?.[el.dataset.apt];
      if (over && el.value !== over) out.push(`aptitude select ${el.dataset.apt} shows ${el.value}, override ${over}`);
    }
    for (const el of document.querySelectorAll('select[data-select="trainee-stars"]')) {
      if (el.value !== String(st.run?.traineeStars ?? 3)) out.push(`trainee stars shows ${el.value}, state ${st.run?.traineeStars}`);
    }
    for (const el of document.querySelectorAll('[data-setting]')) {
      const v = st.settings?.[el.dataset.setting];
      if (el.tagName === 'SELECT' && v !== undefined && el.value !== String(v)) out.push(`setting ${el.dataset.setting} shows ${el.value}, state ${v}`);
    }
    for (const el of document.querySelectorAll('[data-inventory-override]')) {
      const lb = st.settings.inventoryOverrides[el.dataset.inventoryOverride];
      if (el.value !== (lb === null ? '' : String(lb))) out.push(`inventory override ${el.dataset.inventoryOverride} differs from state`);
    }
    for (const el of document.querySelectorAll('[data-action="toggle-card-pin"], [data-action="toggle-card-ignore"]')) {
      const list = el.dataset.action === 'toggle-card-pin' ? st.run.pinnedIds : st.run.ignoredIds;
      const want = String(list.includes(Number(el.dataset.id)));
      if (el.getAttribute('aria-pressed') !== want) out.push(`${el.dataset.action} for ${el.dataset.id} shows ${el.getAttribute('aria-pressed')}, state ${want}`);
    }
    for (const el of document.querySelectorAll('input[data-run]')) {
      if (el.checked !== !!st.run[el.dataset.run]) out.push(`run flag ${el.dataset.run} shows ${el.checked}, state ${st.run[el.dataset.run]}`);
    }
    for (const el of document.querySelectorAll('[data-setting="showUnowned"]')) {
      if (el.checked !== st.ui.showUnowned) out.push('unowned visibility differs from state');
    }
    const goal = st.run?.goal;
    const check = (el, want) => { if (el.value !== String(want)) out.push(`${JSON.stringify(el.dataset)} shows ${el.value}, state ${want}`); };
    for (const el of document.querySelectorAll('[data-goal-blue]')) {
      if (el.checked !== goal.blueStats.includes(el.dataset.goalBlue)) out.push(`blue ${el.dataset.goalBlue} differs from state`);
    }
    for (const el of document.querySelectorAll('[data-goal-stars]')) check(el, el.dataset.goalStars === 'pink' ? goal.pink.find((p) => p.aptitude === el.dataset.pinkAptitude).stars : goal.blueStars);
    for (const el of document.querySelectorAll('[data-goal-pink]')) check(el, goal.pink.find((p) => p.aptitude === el.dataset.goalPink).aptitude);
    for (const el of document.querySelectorAll('[data-target-stars]')) check(el, st.run.targets.find((r) => r.id === Number(el.dataset.targetStars)).stars);
    for (const el of document.querySelectorAll('[data-target-priority]')) check(el, st.run.targets.find((r) => r.id === Number(el.dataset.targetPriority)).priority);
    for (const el of document.querySelectorAll('[data-target-role]')) {
      const required = st.run.targets.some((r) => r.id === Number(el.dataset.id) && r.role === 'required');
      if (el.getAttribute('aria-pressed') !== String(required === (el.dataset.targetRole === 'required'))) out.push('target role differs from state');
    }
    const lineageOf = (id) => st.run.targetLineage[id] ?? [0, 0, 0, 0, 0, 0];
    for (const el of document.querySelectorAll('[data-lineage-copies]')) check(el, lineageOf(el.dataset.lineageCopies).filter((s) => s > 0).length);
    for (const el of document.querySelectorAll('[data-lineage-stars]')) {
      const l = lineageOf(el.dataset.lineageStars);
      check(el, l.reduce((a, s) => a + s, 0));
      if (el.disabled !== !l.some((s) => s > 0)) out.push(`lineage stars ${el.dataset.lineageStars} disabled differs from state`);
    }
    for (const el of document.querySelectorAll('[data-lineage-uma]')) {
      const [id, slot] = el.dataset.lineageUma.split('-');
      check(el, lineageOf(id)[Number(slot)]);
    }
    for (const el of document.querySelectorAll('[data-pink-lineage], [data-pink-lineage-stars]')) {
      const index = el.dataset.pinkLineage ?? el.dataset.pinkLineageStars;
      const spark = st.run.pinkLineage[index];
      check(el, el.hasAttribute('data-pink-lineage') ? spark?.aptitude ?? '' : spark?.stars ?? '');
      if (el.hasAttribute('data-pink-lineage-stars') && el.disabled !== !spark) out.push(`pink stars ${index} disabled differs from state`);
    }
    for (const el of document.querySelectorAll('[data-mission-complete]')) {
      if (el.checked !== st.missions.completedMissionIds.includes(el.dataset.missionComplete)) out.push(`mission ${el.dataset.missionComplete} differs from state`);
    }
    for (const el of document.querySelectorAll('[data-custom-race-complete]')) {
      if (el.checked !== st.missions.completedCustomRaceIds.includes(Number(el.dataset.customRaceComplete))) out.push(`custom race ${el.dataset.customRaceComplete} differs from state`);
    }
    for (const el of document.querySelectorAll('[data-mission-follow]')) {
      if (el.checked !== (st.missions.eventIds === null)) out.push('following current missions differs from state');
    }
    for (const el of document.querySelectorAll('[data-mission-event]')) {
      const id = Number(el.dataset.missionEvent), now = Date.now();
      const want = st.missions.eventIds === null ? missionEvents.some((event) => event.id === id && event.start <= now && now <= event.end) : st.missions.eventIds.includes(id);
      if (el.checked !== want) out.push(`mission event ${id} differs from state`);
    }
    for (const el of document.querySelectorAll('[data-mission-recommend]')) {
      if (el.getAttribute('aria-pressed') !== String(st.missions.traineeCardId === Number(el.dataset.missionRecommend))) out.push('mission trainee differs from state');
    }
    return out;
  }, { gainByStars: BLUE_SPARK_START_GAIN_BY_STARS, expectedAptitudes, expectedLb, st: saved, missionEvents: missionCatalog.events });
  assert.deepEqual(bad, [], `fields out of step with the state ${where}: ${bad.join('; ')}`);
}
