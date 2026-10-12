import assert from 'node:assert/strict';
import { after } from 'node:test';
import { loadData } from '../src/data.ts';
import { defaultState, STATE_KEY } from '../src/state.ts';
import { BASE_URL as url, launchBrowser, openApp, waitForPlan } from './browser-fields.mjs';
import { holdSearch } from './browser-search.mjs';
import { planRun } from '../src/model/run.ts';

const data = loadData();

const browser = await launchBrowser();

after(() => browser.close());

/**
 * A page with real optimizer integration; use it for search-quality and publication assertions. `init` runs in the
 * page before the app, as the held search does, so a test can replace browser APIs from the first load.
 */
async function fresh(t, saved, { held = false, settle = !held, touch = false, init, clock = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: touch, isMobile: touch });
  t.after(() => context.close());
  if (saved) await context.addInitScript(({ key, saved }) => {
    if (!localStorage.getItem('regression-seeded')) {
      localStorage.setItem(key, JSON.stringify(saved));
      localStorage.setItem('regression-seeded', '1');
    }
  }, { key: STATE_KEY, saved });
  const page = await context.newPage();
  if (clock) await page.clock.install();
  if (held) await holdSearch(page);
  if (init) await page.addInitScript(init);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (e) => { if (e.type() === 'error') errors.push(e.text()); });
  t.after(() => assert.deepEqual(errors, [], 'browser errors'));
  await openApp(page, url);
  await page.waitForSelector('#target-search-required');
  if (settle) await waitForPlan(page);
  return page;
}

/** A page with search held pending, for inputs, migration and immediate-estimate checks. */
const editor = (t, saved, options = {}) => fresh(t, saved, { ...options, held: true });

const state = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);

async function pick(page, selector, query, action) {
  await page.fill(selector, query);
  await page.locator(`[data-action="${action}"]`).first().click();
}

const trainee = (page, query = 'special dreamer') => pick(page, '#trainee-search', query, 'pick-trainee');

const target = (page, query) => pick(page, '#target-search-preferred', query, 'add-target');

const pin = (page, query) => pick(page, '#card-search', query, 'pin-card');

const coverage = (page, skill) => page.locator('table').filter({ has: page.locator('th', { hasText: 'Gold hint' }) }).locator('tbody tr').filter({ has: page.locator('td:first-child', { hasText: skill }) });

const inventoryFile = (inventory) => ({ name: 'inventory.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(inventory)) });

const noCards = () => Object.fromEntries(data.cards.map((c) => [c.id, null]));

const predictions = (page) => page.locator('h2', { hasText: 'Predicted run' });

/** The app's own <dialog> replaces window.confirm and alert. */
const confirmDialog = async (page) => { await page.waitForSelector('dialog[data-dialog][open]'); await page.click('[data-dialog-confirm]'); };

const openAgenda = (page) => page.click('details[data-agenda] > summary');

/** Prediction details opens on request; open it before reading or clicking anything inside. */
const openDetails = async (page) => { await page.waitForSelector('.results'); const closed = page.locator('details[data-prediction-details]:not([open]) > summary'); if (await closed.count()) await closed.click(); };

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

// Share fixtures exercise the same inputs and saved-state boundary as the UI, without importing browser modules.
const waitForShare = (page) => page.waitForFunction(() => /(^|&)run=/.test(location.hash.slice(1)));

const navigateShare = (page, href) => page.evaluate((next) => {
  history.pushState(null, '', next);
  dispatchEvent(new PopStateEvent('popstate'));
}, href);

function shareFixture() {
  const saved = defaultState(data);
  saved.run.traineeCardId = 100101;
  saved.run.traineeStars = 4;
  saved.run.targets = [{ id: 201601, role: 'required', stars: 3, priority: 0 }];
  saved.run.targetLineage = { 201601: [3, 2, 0, 3, 0, 0] };
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

export { data, browser, fresh, editor, state, trainee, target, pin, coverage, inventoryFile, noCards, predictions, confirmDialog, openAgenda, openDetails, fujiState, fujiReferencePercent, waitForShare, navigateShare, shareFixture, holdNextShareStream };
