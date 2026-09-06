// Fetches English event names for each Global support card from GameTora's per-card page JSON, and the full
// event data of each Global character from her page JSON (the static feed has neither names nor the grouping
// into story, choice, outing and secret events, nor the secret events' race conditions).
// One request per card (~245) and per character (~66), throttled, cached in data/raw/event-names.json and
// data/raw/char-events.json. Re-runs only fetch what is missing.
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
  await new Promise((r) => setTimeout(r, DELAY_MS));
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

// Characters: one page per character (the first Global outfit's page carries the character's events).
const CHAR_OUT = path.join(RAW, 'char-events.json');
const charCards = (await readJson(path.join(RAW, 'character-cards.json'))).filter((c) => c.release_en).sort((a, b) => a.card_id - b.card_id);
const firstOutfit = new Map();
for (const c of charCards) if (!firstOutfit.has(c.char_id)) firstOutfit.set(c.char_id, c);
const charEvents = (await exists(CHAR_OUT)) ? await readJson(CHAR_OUT) : {};
const charTodo = [...firstOutfit.values()].filter((c) => !charEvents[c.char_id]);
console.log(`${charTodo.length} characters to fetch (${firstOutfit.size - charTodo.length} cached)`);
if (charTodo.length) {
  const id = await buildId();
  let n = 0;
  for (const c of charTodo) {
    const d = await getJson(`${BASE}/_next/data/${id}/umamusume/characters/${c.url_name}.json`);
    if (!d) { console.warn('miss character', c.char_id, c.url_name); continue; }
    let en = d.pageProps?.eventData?.en;
    if (typeof en === 'string') en = JSON.parse(en);
    if (!en) { console.warn('no event data for', c.char_id); continue; }
    charEvents[c.char_id] = en;
    if (++n % 20 === 0) { await fs.writeFile(CHAR_OUT, JSON.stringify(charEvents, null, 1)); console.log(`${n}/${charTodo.length}`); }
  }
  await fs.writeFile(CHAR_OUT, JSON.stringify(charEvents, null, 1));
}
console.log('characters done', Object.keys(charEvents).length);
