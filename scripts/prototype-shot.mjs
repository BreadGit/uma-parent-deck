// PROTOTYPE, throwaway: seeds a populated run and screenshots the result column at 1920x1080 for each layout variant.
// Usage: node scripts/prototype-shot.mjs [variant ...]   (URL=http://localhost:5176/ by default)
import { chromium } from 'playwright';
import { loadData } from '../src/data.ts';
import { defaultState, STATE_KEY } from '../src/state.ts';

const url = process.env.URL ?? 'http://localhost:5176/';
// each argument is "<sidebar><results>" with an optional state: 11, 21:closed (sidebar hidden), 12:open (details shown)
const variants = process.argv.slice(2).length ? process.argv.slice(2) : ['11'];
const data = loadData();
const saved = defaultState(data);
saved.run.traineeCardId = 100101;
saved.run.targets = [
  { id: 201601, role: 'required', stars: 2, priority: 0 },
  { id: 200352, role: 'required', stars: 2, priority: 0 },
  { id: 201562, role: 'preferred', stars: 2, priority: 0 },
  { id: 201032, role: 'preferred', stars: 2, priority: 0 },
];
saved.run.goal = { blueStats: ['speed'], blueStars: 3, pink: [{ aptitude: 'any', stars: 2 }] };
saved.ui.theme = process.env.THEME ?? 'light';

const browser = await chromium.launch();
for (const variant of variants) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await context.addInitScript(({ key, saved }) => { localStorage.setItem(key, JSON.stringify(saved)); }, { key: STATE_KEY, saved });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const [key, mode] = variant.split(':');
  await page.goto(key === 'base' ? url : `${url}?sidebar=${key[0]}&results=${key[1]}`);
  await page.waitForSelector('#target-search');
  await page.waitForFunction(() => !document.querySelector('[data-plan-pending]'), undefined, { timeout: 60000 });
  if (mode === 'closed') await page.locator('[data-action="proto-sidebar"]').first().click();
  if (mode === 'open') {
    await page.locator('[data-action="proto-details"]').click();
    await page.evaluate(() => { for (const d of document.querySelectorAll('.results details')) if (!d.matches('[data-agenda]') && !d.closest('.ranking-table')) d.open = true; });
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // the header stays in view: a user screenshots without scrolling when the four panels fit under it
  if (mode !== 'closed' && key !== 'base') await page.evaluate(() => window.scrollTo(0, 0));
  else await page.evaluate(() => {
    const first = [...document.querySelectorAll('.results section.panel')].find((s) => s.getClientRects().length);
    window.scrollTo(0, first.getBoundingClientRect().top + window.scrollY - 8);
  });
  const metrics = await page.evaluate(() => {
    const visible = [...document.querySelectorAll('.results section.panel')].filter((s) => s.getClientRects().length);
    const find = (t) => visible.find((s) => s.querySelector('h2')?.textContent.startsWith(t));
    const box = (t) => { const b = find(t)?.getBoundingClientRect(); return b ? { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), width: Math.round(b.width) } : null; };
    const sidebar = document.querySelector('.inputs, .proto-rail')?.getBoundingClientRect();
    return { deck: box('Suggested deck'), estimate: box('Parent goal estimate'), priorities: box('Prioritized skills'), prediction: box('Predicted run'), sidebarWidth: sidebar && sidebar.width ? Math.round(sidebar.width) : 0, overflow: document.documentElement.scrollWidth > window.innerWidth };
  });
  const path = `/tmp/proto/${key}${mode ? '-' + mode : ''}-${saved.ui.theme}.png`;
  await page.screenshot({ path });
  console.log(variant, path, JSON.stringify(metrics), errors.length ? errors : '');
  await context.close();
}
await browser.close();
