// Runs a throwaway browser script with the repo's Playwright and test helpers, so a one-off written anywhere
// (a file in /tmp cannot resolve `playwright` on its own) needs no imports and no copy into the tree.
//   node tests/scratch.mjs /tmp/probe.mjs            default export: async (tools) => value, printed as JSON
//   node tests/scratch.mjs --eval 'document.title'   evaluated in the page
//   node tests/scratch.mjs --shot /tmp/shot.png      full-page screenshot after the page settles
// Options: --width N --height N (viewport, default 1440x1000), --dark, --state file.json (saved state seeded
// before load), --hold (search held pending; call tools.releaseSearch(page) to run it). URL picks the server.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { loadData } from '../src/data.ts';
import { STATE_KEY } from '../src/state.ts';
import { assertFieldsMatchState, openApp, waitForPlan } from './browser-fields.mjs';
import { holdSearch, releaseSearch } from './browser-search.mjs';

const { values: opts, positionals: [script] } = parseArgs({ allowPositionals: true, options: {
  eval: { type: 'string' }, shot: { type: 'string' }, width: { type: 'string', default: '1440' }, height: { type: 'string', default: '1000' },
  dark: { type: 'boolean', default: false }, state: { type: 'string' }, hold: { type: 'boolean', default: false },
} });
if (!script && !opts.eval && !opts.shot) {
  console.error('usage: node tests/scratch.mjs <script.mjs> | --eval <expression> | --shot <path.png> [--width N --height N --dark --state file.json --hold]');
  process.exit(2);
}
const url = process.env.URL ?? 'http://localhost:5173/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(opts.width), height: Number(opts.height) }, colorScheme: opts.dark ? 'dark' : 'light' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
if (opts.state) {
  const saved = JSON.parse(await readFile(opts.state, 'utf8'));
  await page.addInitScript(({ key, saved }) => {
    if (!localStorage.getItem('scratch-seeded')) {
      localStorage.setItem(key, JSON.stringify(saved));
      localStorage.setItem('scratch-seeded', '1');
    }
  }, { key: STATE_KEY, saved });
}
if (opts.hold) await holdSearch(page);
const settled = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const shot = (path, options = {}) => page.screenshot({ path, fullPage: true, ...options });
let code = 0;
try {
  await openApp(page, url);
  await page.waitForSelector('h1');
  let value;
  if (script) {
    const { default: run } = await import(pathToFileURL(script).href);
    value = await run({ page, browser, url, data: loadData(), STATE_KEY, errors, settled, shot, holdSearch, releaseSearch, waitForPlan, assertFieldsMatchState });
  }
  if (opts.eval) value = await page.evaluate(opts.eval);
  if (opts.shot) {
    await settled();
    await shot(opts.shot);
    console.error(`wrote ${opts.shot}`);
  }
  if (value !== undefined) console.log(JSON.stringify(value, null, 1));
} catch (error) {
  console.error(error);
  code = 1;
}
if (errors.length) {
  console.error('browser errors:', errors);
  code ||= 1;
}
await browser.close();
process.exit(code);
