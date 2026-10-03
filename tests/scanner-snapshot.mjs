// Recognition on every fixture in tests/fixtures/scanner/, compared with the checked-in snapshot beside them. The
// recognizer is pure, so any change to its output shows here slot by slot; a refactor must leave it identical.
// After an intended change, regenerate the snapshot with `UPDATE_SNAPSHOT=1 node tests/scanner-snapshot.mjs` and
// review its diff. Needs the dev server (it imports the scanner modules from /src).
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { assertServesThisTree } from './browser-fields.mjs';

const base = process.env.URL ?? 'http://localhost:5173/';
const fixtures = new URL('fixtures/scanner/', import.meta.url);
const snapshotFile = new URL('detections.json', fixtures);
const names = (await readdir(fixtures)).filter(name => name.endsWith('.jpg')).sort();
// User-labelled failures from a second inventory: clear artwork should not need confirmation. These are independent of
// the snapshot, so regenerating it cannot accept a misreading. The screenshots retain the obstructing game toolbar; only
// visible cards are listed.
const labelled = {
  'inventory-b-4436.jpg': [[30062, 4], [30106, 0]],
  'inventory-b-4437.jpg': [[30054, 0]],
  'inventory-b-4438.jpg': [[30125, 0], [30145, 2]],
  'inventory-b-4439.jpg': [[20006, 4]],
  'inventory-b-4440.jpg': [[20021, 4]],
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(new URL('scanner.html', base).href);
  await assertServesThisTree(base);
  const actual = await page.evaluate(async names => {
    const load = path => import(/* @vite-ignore */ path).catch(error => {
      throw new Error(`could not import ${path}; the snapshot needs the Vite dev server (${error})`);
    });
    const [{ loadReferences, pixels, screenshotCanvas }, { createRecognizer }, { cards }] = await Promise.all([
      load('/src/scanner/images.ts'), load('/src/scanner/recognize.ts'), load('/@id/__x00__virtual:scanner-catalog')]);
    const recognize = createRecognizer(await loadReferences(cards));
    const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
    const result = {};
    for (const name of names) {
      const blob = await (await fetch(`/tests/fixtures/scanner/${name}`)).blob();
      const { detections, ignoredR } = recognize(pixels(await screenshotCanvas(new File([blob], name, { type: blob.type }))));
      result[name] = { ignoredR, detections: detections.map(({ box, candidates, lb, confident }) => ({
        cardId: candidates[0]?.id ?? null, lb, confident, error: candidates[0] ? round(candidates[0].error, 4) : null,
        box: [box.x, box.y, box.width, box.height].map(v => round(v, 2)),
      })) };
    }
    return result;
  }, names);
  for (const [name, cards] of Object.entries(labelled)) for (const [id, lb] of cards) {
    assert.ok(actual[name].detections.some(d => d.cardId === id && d.lb === lb && d.confident), `${name}: ${id} at ${lb}LB is read with confidence`);
  }
  if (process.env.UPDATE_SNAPSHOT) {
    // One detection per line keeps the snapshot's diff readable slot by slot.
    const fixture = ({ ignoredR, detections }) => `{ "ignoredR": ${ignoredR}, "detections": [\n${detections.map(d => `  ${JSON.stringify(d)}`).join(',\n')}\n ] }`;
    await writeFile(snapshotFile, `{\n${Object.entries(actual).map(([name, f]) => `"${name}": ${fixture(f)}`).join(',\n')}\n}\n`);
    console.log(`Scanner snapshot: wrote ${names.length} fixtures to ${snapshotFile.pathname}`);
  } else {
    const expected = JSON.parse(await readFile(snapshotFile, 'utf8'));
    const changes = [];
    for (const name of new Set([...Object.keys(expected), ...names])) {
      const was = expected[name], now = actual[name];
      if (!was || !now) { changes.push(`${name}: ${was ? 'fixture removed' : 'not in the snapshot'}`); continue; }
      if (was.ignoredR !== now.ignoredR) changes.push(`${name}: R cards ignored ${was.ignoredR} → ${now.ignoredR}`);
      for (let slot = 0; slot < Math.max(was.detections.length, now.detections.length); slot++) {
        const a = was.detections[slot], b = now.detections[slot];
        if (!a || !b) { changes.push(`${name} slot ${slot}: ${a ? 'no longer detected' : `new ${JSON.stringify(b)}`}`); continue; }
        for (const key of Object.keys(a)) {
          if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) changes.push(`${name} slot ${slot} ${key}: ${JSON.stringify(a[key])} → ${JSON.stringify(b[key])}`);
        }
      }
    }
    assert.deepEqual(changes, [], `recognition changed (regenerate with UPDATE_SNAPSHOT=1 if intended):\n${changes.join('\n')}`);
    console.log(`Scanner snapshot: ${names.length} fixtures match ${snapshotFile.pathname.split('/').slice(-3).join('/')}.`);
  }
} finally { await browser.close(); }
