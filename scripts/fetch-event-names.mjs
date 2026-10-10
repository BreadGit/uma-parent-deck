// Fetches English event names for each Global support card from GameTora's per-card page JSON, and the full
// event data of each Global character from her page JSON (the static feed has neither names nor the grouping
// into story, choice, outing and secret events, nor the secret events' race conditions).
// One request per card (~245) and per character (~66), throttled, cached in data/raw/event-names.json and
// data/raw/char-events.json. Source revisions invalidate stale page caches.
import path from 'node:path';
import { GAMETORA, createThrottle, requestSource } from './source-request.ts';
import { exists, readJson, writeJson } from './json-file.ts';
import { fingerprint, pageCacheMatches, pageRevision, pageInput, pageEvents, uniqueEffectText, UNLOCK_LINE } from './page-cache.ts';

const BASE = GAMETORA.base;
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(RAW, 'event-names.json');
const FORCE = process.argv.includes('--force');
const REVISION_OUT = path.join(RAW, 'page-source-revisions.json');
const revisions = (await exists(REVISION_OUT)) ? await readJson(REVISION_OUT) : {};
const sourceFiles = ['training_events__ssr', 'training_events__sr', 'training_events__friend', 'training_events__group',
  'training_events__shared', 'training_events__char', 'training_events__char_card', 'dict__evrew'];
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (key) => [key, fingerprint(await readJson(path.join(RAW, `${key}.json`)))])));
const inputFor = (key, card) => pageInput(key, card, sourceHashes);
const current = (key, card, payload) => !FORCE && pageCacheMatches(revisions[key], inputFor(key, card), payload);
const remember = (key, card, payload) => { revisions[key] = pageRevision(inputFor(key, card), payload); };

const throttle = createThrottle();
async function getJson(url) {
  const res = await requestSource(url, throttle.wait, GAMETORA.userAgent);
  if (!res.ok) throw new Error(`Page fetch ${res.status}: ${url}`);
  return res.json();
}

/** A page's HTML, throttled like getJson. */
async function getText(url) {
  const res = await requestSource(url, throttle.wait, GAMETORA.userAgent);
  if (!res.ok) throw new Error(`Page fetch ${res.status}: ${url}`);
  return res.text();
}

async function buildId() {
  await new Promise((r) => setTimeout(r, GAMETORA.delayMs));
  const html = await getText(`${BASE}/umamusume/supports`);
  const m = html.match(/"buildId":"([^"]+)"/);
  if (!m) throw new Error('buildId not found');
  return m[1];
}

const FULL = path.join(RAW, 'event-data-friend-group.json'); // full event data for Pal and Group cards (their outings are not in the static feed)
const cards = (await readJson(path.join(RAW, 'support-cards.json'))).filter((c) => c.release_en);
const names = (await exists(OUT)) ? await readJson(OUT) : {};
const full = (await exists(FULL)) ? await readJson(FULL) : {};
const isPalGroup = (c) => c.type === 'friend' || c.type === 'group';
const supportPayload = (c) => ({ names: names[c.support_id], ...(isPalGroup(c) ? { full: full[c.support_id] } : {}) });
const todo = cards.filter((c) => !names[c.support_id] || (isPalGroup(c) && !full[c.support_id]) || !current(`support:${c.support_id}`, c, supportPayload(c)));
async function saveSupports() { await writeJson(OUT, names); await writeJson(FULL, full); await writeJson(REVISION_OUT, revisions); }
console.log(`${todo.length} cards to fetch (${cards.length - todo.length} cached)`);
if (todo.length) {
  const id = await buildId();
  let n = 0;
  for (const c of todo) {
    const d = await getJson(`${BASE}/_next/data/${id}/umamusume/supports/${c.url_name}.json`);
    const en = pageEvents(d.pageProps?.eventData?.en, 'support', `support ${c.support_id}`);
    const pick = (arr) => (arr ?? []).map((e) => e.n);
    // Group cards keep their chain events under "special" instead of "arrows".
    const chain = en?.arrows?.length ? pick(en.arrows) : pick(en?.special);
    names[c.support_id] = { chain, random: pick(en?.random), special: pick(en?.special), dates: pick(en?.dates) };
    if (isPalGroup(c)) full[c.support_id] = en;
    remember(`support:${c.support_id}`, c, supportPayload(c));
    if (++n % 20 === 0) { await saveSupports(); console.log(`${n}/${todo.length}`); }
  }
  await saveSupports();
}
console.log('done', Object.keys(names).length);

// Characters: one page per character (the first Global outfit's page carries the character's events).
const CHAR_OUT = path.join(RAW, 'char-events.json');
const charCards = (await readJson(path.join(RAW, 'character-cards.json'))).filter((c) => c.release_en).sort((a, b) => a.card_id - b.card_id);
const firstOutfit = new Map();
for (const c of charCards) if (!firstOutfit.has(c.char_id)) firstOutfit.set(c.char_id, c);
const charEvents = (await exists(CHAR_OUT)) ? await readJson(CHAR_OUT) : {};
const charTodo = [...firstOutfit.values()].filter((c) => !current(`character:${c.char_id}`, c, charEvents[c.char_id]));
console.log(`${charTodo.length} characters to fetch (${firstOutfit.size - charTodo.length} cached)`);
if (charTodo.length) {
  const id = await buildId();
  let n = 0;
  for (const c of charTodo) {
    const d = await getJson(`${BASE}/_next/data/${id}/umamusume/characters/${c.url_name}.json`);
    const en = pageEvents(d.pageProps?.eventData?.en, 'character', `character ${c.char_id}`);
    charEvents[c.char_id] = en;
    remember(`character:${c.char_id}`, c, en);
    if (++n % 20 === 0) { await writeJson(CHAR_OUT, charEvents); await writeJson(REVISION_OUT, revisions); console.log(`${n}/${charTodo.length}`); }
  }
  await writeJson(CHAR_OUT, charEvents);
  await writeJson(REVISION_OUT, revisions);
}
console.log('characters done', Object.keys(charEvents).length);

// Alternate outfits: their own page carries the outfit's events, which the base page lacks. Keyed by card id.
const CARD_OUT = path.join(RAW, 'char-events-by-card.json');
const byCard = (await exists(CARD_OUT)) ? await readJson(CARD_OUT) : {};
const altTodo = charCards.filter((c) => firstOutfit.get(c.char_id) !== c && !current(`outfit:${c.card_id}`, c, byCard[c.card_id]));
console.log(`${altTodo.length} alternate outfits to fetch (${charCards.length - firstOutfit.size - altTodo.length} cached)`);
if (altTodo.length) {
  const id = await buildId();
  let n = 0;
  for (const c of altTodo) {
    const d = await getJson(`${BASE}/_next/data/${id}/umamusume/characters/${c.url_name}.json`);
    const en = pageEvents(d.pageProps?.eventData?.en, 'character', `outfit ${c.card_id}`);
    byCard[c.card_id] = en;
    remember(`outfit:${c.card_id}`, c, en);
    if (++n % 10 === 0) { await writeJson(CARD_OUT, byCard); await writeJson(REVISION_OUT, revisions); console.log(`${n}/${altTodo.length}`); }
  }
  await writeJson(CARD_OUT, byCard);
  await writeJson(REVISION_OUT, revisions);
}
console.log('outfits done', Object.keys(byCard).length);

// Compound unique effects (types 100 and up) have no definition in the static feed; GameTora renders their text
// on the card page from the same payload. Keep that rendered text per card so the tool can show and decode it.
const UNIQUE_OUT = path.join(RAW, 'unique-effect-texts.json');
const uniqueTexts = (await exists(UNIQUE_OUT)) ? await readJson(UNIQUE_OUT) : {};
// an earlier version of this script kept the UNLOCK_LINE as the text, so a cached entry that is only that line is refetched
const compound = cards.filter((c) => c.release_en && c.unique?.effects.some((u) => u.type >= 100)
  && (!uniqueTexts[c.support_id] || UNLOCK_LINE.test(uniqueTexts[c.support_id]) || !current(`unique:${c.support_id}`, c, uniqueTexts[c.support_id])));
console.log(`${compound.length} compound unique effects to fetch (${Object.keys(uniqueTexts).length} cached)`);
for (const c of compound) {
  const page = await getText(`${BASE}/umamusume/supports/${c.url_name}`);
  uniqueTexts[c.support_id] = uniqueEffectText(page);
  remember(`unique:${c.support_id}`, c, uniqueTexts[c.support_id]);
}
await writeJson(UNIQUE_OUT, uniqueTexts);
await writeJson(REVISION_OUT, revisions);
console.log('unique texts done', Object.keys(uniqueTexts).length);
