// Fetches English event names for each Global support card from GameTora's per-card page JSON.
// The static events feed only carries obfuscated names; the page JSON has them in plain text.
// One request per card (~245), throttled, cached in data/raw/event-names.json. Re-runs only fetch new cards.
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://gametora.com';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const DELAY_MS = 1100;
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(RAW, 'event-names.json');
const exists = (f) => fs.access(f).then(() => true, () => false);
const readJson = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));

let last = 0;
async function getJson(url) {
  const wait = last + DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  return res.json();
}

async function buildId() {
  const html = await (await fetch(`${BASE}/umamusume/supports`, { headers: { 'User-Agent': UA } })).text();
  const m = html.match(/"buildId":"([^"]+)"/);
  if (!m) throw new Error('buildId not found');
  return m[1];
}

const FULL = path.join(RAW, 'event-data-friend-group.json'); // full event data for Pal and Group cards (their outings are not in the static feed)
const cards = (await readJson(path.join(RAW, 'support-cards.json'))).filter((c) => c.release_en);
const names = (await exists(OUT)) ? await readJson(OUT) : {};
const full = (await exists(FULL)) ? await readJson(FULL) : {};
const isPalGroup = (c) => c.type === 'friend' || c.type === 'group';
const todo = cards.filter((c) => !names[c.support_id] || (isPalGroup(c) && !full[c.support_id]));
console.log(`${todo.length} cards to fetch (${cards.length - todo.length} cached)`);
if (todo.length) {
  const id = await buildId();
  let n = 0;
  for (const c of todo) {
    const d = await getJson(`${BASE}/_next/data/${id}/umamusume/supports/${c.url_name}.json`);
    if (!d) { console.warn('miss', c.support_id); continue; }
    let en = d.pageProps?.eventData?.en;
    if (typeof en === 'string') en = JSON.parse(en);
    const pick = (arr) => (arr ?? []).map((e) => e.n);
    // Group cards keep their chain events under "special" instead of "arrows".
    const chain = en?.arrows?.length ? pick(en.arrows) : pick(en?.special);
    names[c.support_id] = { chain, random: pick(en?.random), special: pick(en?.special), dates: pick(en?.dates) };
    if (isPalGroup(c)) full[c.support_id] = en;
    if (++n % 20 === 0) { await fs.writeFile(OUT, JSON.stringify(names, null, 1)); await fs.writeFile(FULL, JSON.stringify(full, null, 1)); console.log(`${n}/${todo.length}`); }
  }
  await fs.writeFile(OUT, JSON.stringify(names, null, 1));
  await fs.writeFile(FULL, JSON.stringify(full, null, 1));
}
console.log('done', Object.keys(names).length);
