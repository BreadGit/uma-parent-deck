// Layout assertions use real browser geometry, with native anchoring both enabled and disabled.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, after } from 'node:test';
import { chromium } from 'playwright';
import ts from 'typescript';

const source = await readFile(new URL('../src/ui/scroll-anchor.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
const browser = await chromium.launch();
after(() => browser.close());
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const top = (page, id) => page.locator(`#${id}`).evaluate((el) => el.getBoundingClientRect().top);

async function fixture(t, width, native = true) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  t.after(() => page.close());
  await page.setContent(`<style>html { overflow-anchor: ${native ? 'auto' : 'none'}; } body { margin: 0; } #above { height: 900px; } li { height: 48px; } #tail { height: 1600px; }</style>
    <main id="fixture"><div id="above"></div><h3 id="heading">Prioritized skills</h3><ol>
    ${Array.from({length: 15}, (_, i) => `<li data-wl-key="${i}" id="row${i}"><button id="control${i}">Skill ${i}</button></li>`).join('')}
    </ol><div id="tail"></div></main>`);
  await page.evaluate(async (url) => { const { installScrollAnchor } = await import(url); window.drawAnchored = installScrollAnchor(document.querySelector('#fixture')); }, moduleUrl);
  await page.evaluate(() => { const el = document.querySelector('#control3'); el.focus({ preventScroll: true }); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 200); });
  await page.waitForTimeout(220);
  return page;
}

for (const width of [390, 1440]) for (const native of [true, false]) {
  test(`keep a focused control steady as content grows and shrinks at ${width}px, native anchoring ${native}`, async (t) => {
    const page = await fixture(t, width, native);
    const before = await top(page, 'control3');
    for (const height of [1150, 650, 950]) {
      await page.evaluate((height) => window.drawAnchored(() => { document.querySelector('#above').style.height = `${height}px`; }), height);
      await settle(page);
      assert.ok(Math.abs(await top(page, 'control3') - before) <= 1);
    }
    assert.equal(await page.evaluate(() => document.activeElement.id), 'control3');
  });
}

test('a removed focused row falls back to a nearby surviving row', async (t) => {
  const page = await fixture(t, 390, false);
  const before = await top(page, 'row4');
  await page.evaluate(() => window.drawAnchored(() => document.querySelector('#row3').remove()));
  await settle(page);
  assert.ok(Math.abs(await top(page, 'row4') - before) <= 1);
});

test('an offscreen focused control does not pull the reader back to it', async (t) => {
  const page = await fixture(t, 390, false);
  await page.evaluate(() => document.querySelector('#control14').focus({ preventScroll: true }));
  const before = await top(page, 'control3');
  await page.evaluate(() => window.drawAnchored(() => { document.querySelector('#above').style.height = '1200px'; }));
  await settle(page);
  assert.ok(Math.abs(await top(page, 'control3') - before) <= 1);
});

test('manual scrolling suspends correction, then anchoring resumes after scrolling stops', async (t) => {
  const page = await fixture(t, 390, false);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(50);
  const before = await page.evaluate(() => scrollY);
  await page.evaluate(() => window.drawAnchored(() => { document.querySelector('#above').style.height = '1100px'; }));
  await settle(page);
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - before) <= 1, 'the render does not scroll against wheel input');
  await page.waitForTimeout(220);
  const anchor = await top(page, 'control3');
  await page.evaluate(() => window.drawAnchored(() => { document.querySelector('#above').style.height = '1000px'; }));
  await settle(page);
  assert.ok(Math.abs(await top(page, 'control3') - anchor) <= 1);
});

test('a reader at the page top stays at the top', async (t) => {
  const page = await fixture(t, 390, false);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(220);
  await page.evaluate(() => window.drawAnchored(() => { document.querySelector('#above').style.height = '1200px'; }));
  assert.equal(await page.evaluate(() => scrollY), 0);
});

test('a focused control clipped inside another scroll area cannot move the page', async (t) => {
  const page = await fixture(t, 390, false);
  await page.evaluate(() => {
    const clip = document.createElement('div');
    clip.style.cssText = 'position:fixed;top:100px;left:0;width:20px;height:10px;overflow:hidden';
    const spacer = document.createElement('div');
    spacer.id = 'clipped-spacer'; spacer.style.height = '100px';
    const button = document.createElement('button');
    button.style.cssText = 'width:10px;height:20px;padding:0';
    clip.append(spacer, button);
    document.querySelector('#fixture').prepend(clip);
    button.focus({ preventScroll: true });
  });
  const before = await page.evaluate(() => scrollY);
  await page.evaluate(() => window.drawAnchored(() => { document.querySelector('#clipped-spacer').style.height = '300px'; }));
  await settle(page);
  assert.equal(await page.evaluate(() => scrollY), before);
});

test('reordering rows inside an independent scroll area does not scroll the outer page', async (t) => {
  const page = await fixture(t, 390, false);
  await page.evaluate(() => { document.querySelector('ol').style.cssText = 'max-height:250px;overflow:auto'; });
  await page.waitForTimeout(220);
  const before = await page.evaluate(() => scrollY);
  await page.evaluate(() => window.drawAnchored(() => document.querySelector('ol').append(document.querySelector('#row3'))));
  await settle(page);
  assert.equal(await page.evaluate(() => scrollY), before);
});
