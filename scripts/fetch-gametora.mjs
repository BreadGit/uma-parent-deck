// Fetches Umamusume Global data from GameTora's static JSON feed and normalizes
// it into data/*.json plus thumbnails under public/assets/.
//
// Load policy: one request at a time, ~1.1 s apart, generic browser user agent,
// no identifying headers. Files already on disk are never re-downloaded unless
// the manifest hash changed (data) or --force is passed (images).
//
// Usage: node scripts/fetch-gametora.mjs [--force] [--no-images] [--offline | --download-only | --normalize-only]
// --offline skips every request and only re-normalizes what is already in data/raw.

import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeSupportEffects, normalizeSupportMechanics, validateSupportCards } from './support-import.ts';
import { decodeRewards, eventOnGlobal, normalizeReward, staticEventOnGlobal, validateGlobalPeriod } from './event-import.ts';
import { parseSourceDownload, reconcileSources, validatePageRevisions, validateSourceTables } from './source-validation.ts';

const BASE = 'https://gametora.com';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const DELAY_MS = 1100;
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'data');
const ASSETS = path.join(ROOT, 'public', 'assets');
const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const OFFLINE = args.has('--offline');
const DOWNLOAD_ONLY = args.has('--download-only');
const NORMALIZE_ONLY = args.has('--normalize-only');
const IMAGES = !args.has('--no-images') && !OFFLINE;

const STATIC_KEYS = [
  'support-cards', 'support_effects', 'skills', 'character-cards', 'characters',
  'races', 'ura-races', 'scenarios', 'en/db-files/single_mode_rank', 'en/db-files/support_card_level',
  'training_events/ssr', 'training_events/sr', 'training_events/friend', 'training_events/group',
  'training_events/shared', 'training_events/char', 'training_events/char_card', 'training_events/scenario', 'dict/evrew', 'status-effects', 'ura-objectives',
];

let lastRequest = 0;
let requestCount = 0;
async function throttle() {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  requestCount++;
}
async function fetchTo(url, file, jsonShape) {
  await throttle();
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return res.status;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (jsonShape) parseSourceDownload(buffer.toString('utf8'), jsonShape, url);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, buffer);
  await fs.rename(`${file}.tmp`, file);
  return 200;
}
const exists = (f) => fs.access(f).then(() => true, () => false);
const readJson = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));
const writeJson = (f, v) => fs.writeFile(f, JSON.stringify(v, null, 1) + '\n');
const rawName = (key) => path.join(RAW, key.replaceAll('/', '__') + '.json');

async function fetchStatic() {
  await fs.mkdir(RAW, { recursive: true });
  const manifestFile = path.join(RAW, 'manifest.json');
  console.log('manifest');
  const status = await fetchTo(`${BASE}/data/manifests/umamusume.json`, manifestFile, 'object');
  if (status !== 200) throw new Error(`manifest ${status}`);
  const manifest = await readJson(manifestFile);
  for (const key of STATIC_KEYS) if (typeof manifest[key] !== 'string' || !manifest[key]) throw new Error(`manifest has no valid hash for required source ${key}`);
  const hashesFile = path.join(RAW, 'hashes.json');
  const hashes = (await exists(hashesFile)) ? await readJson(hashesFile) : {};
  for (const key of STATIC_KEYS) {
    const hash = manifest[key];
    if (typeof hash !== 'string' || !hash) throw new Error(`manifest has no valid hash for required source ${key}`);
    const file = rawName(key);
    if (!FORCE && hashes[key] === hash && (await exists(file))) continue;
    console.log('fetch', key, hash);
    const st = await fetchTo(`${BASE}/data/umamusume/${key}.${hash}.json`, file, 'array');
    if (st !== 200) throw new Error(`${key} ${st}`);
    hashes[key] = hash;
  }
  await writeJson(hashesFile, hashes);
  await writeJson(path.join(RAW, 'fetch-meta.json'), { fetchedAt: new Date().toISOString() });
}

// ---------- normalization ----------

const RARITY = { 1: 'R', 2: 'SR', 3: 'SSR' };
const TYPE = { intelligence: 'wit', speed: 'speed', stamina: 'stamina', power: 'power', guts: 'guts', friend: 'pal', group: 'group' };

// Event entry: [nameId, choices, strId, ...history]. choices: [[choiceId, [rewardIds]]] or "no".
function decodeEvent(evrew, entry, kind, index) {
  entry = staticEventOnGlobal(entry);
  const choicesRaw = Array.isArray(entry[1]) ? entry[1] : [];
  const choices = choicesRaw.map((c) => {
    const rewardIds = Array.isArray(c) && Array.isArray(c[1]) ? c[1] : [];
    const outcomes = [[]];
    for (const rw of rewardIds.flatMap((rid) => decodeRewards(evrew, rid))) {
      if (rw.t === 'di') { outcomes.push([]); continue; }
      outcomes[outcomes.length - 1].push(rw);
    }
    return { outcomes };
  });
  return { kind, index, choices };
}

// Page-format event ({i, n, c: [{o, r: [{t, v, d}]}]}) -> normalized event with outcomes split at 'di'.
function decodePageEvent(ev, kind, index) {
  const choices = (ev.c ?? []).map((ch) => {
    const outcomes = [[]];
    for (const r of ch.r ?? []) {
      if (r.t === 'di') { outcomes.push([]); continue; }
      outcomes[outcomes.length - 1].push(normalizeReward(r));
    }
    return { outcomes };
  });
  return { kind, index, name: ev.n, choices };
}

function normalizeCards(raw, eventNames, palGroupEvents, uniqueTexts = {}) {
  validateSupportCards(raw['support-cards']);
  const evrew = raw['dict/evrew'];
  const randomNamesByChar = new Map();
  for (const c of raw['support-cards']) {
    const n = eventNames[c.support_id];
    if (n?.random?.length && !randomNamesByChar.has(c.char_id)) randomNamesByChar.set(c.char_id, n.random);
  }
  const chainByCard = new Map();
  for (const file of ['training_events/ssr', 'training_events/sr', 'training_events/friend', 'training_events/group']) {
    for (const [id, events] of raw[file]) chainByCard.set(id, events);
  }
  const randomByChar = new Map(raw['training_events/shared'].map(([id, ev]) => [id, ev]));
  const cards = [];
  for (const c of raw['support-cards']) {
    if (!c.release_en) continue;
    const rarity = RARITY[c.rarity];
    const mechanics = normalizeSupportMechanics(c, uniqueTexts[c.support_id]);
    const hintOthers = [];
    for (const h of c.hints?.hint_others ?? []) {
      if (h && typeof h === 'object' && 'hint_type' in h) hintOthers.push({ type: h.hint_type, value: h.hint_value });
    }
    const names = eventNames[c.support_id] ?? {};
    // Pal/Group cards have no chain events; the static feed lists their special events under that key without rewards.
    const chainEvents = palGroupEvents[c.support_id] ? [] : (chainByCard.get(c.support_id) ?? []).map((e, i) => ({ ...decodeEvent(evrew, e, 'chain', i + 1), ...(names.chain?.[i] ? { name: names.chain[i] } : {}) }));
    const rnames = randomNamesByChar.get(c.char_id) ?? [];
    let randomEvents = (randomByChar.get(c.char_id) ?? []).map((e, i) => ({ ...decodeEvent(evrew, e, 'random', i + 1), ...(rnames[i] ? { name: rnames[i] } : {}) }));
    // Pal and Group cards: outings (dates / member outings + finale) and special events come from the page data.
    let recreationEvents = [];
    let specialEvents = [];
    const pg = palGroupEvents[c.support_id];
    if (pg) {
      const outings = pg.dates ?? pg.dates_random ?? [];
      recreationEvents = outings.map(eventOnGlobal).filter(Boolean).map((e, i) => decodePageEvent(e, 'recreation', i + 1));
      specialEvents = (pg.special ?? []).map(eventOnGlobal).filter(Boolean).map((e, i) => decodePageEvent(e, 'special', i + 1));
      randomEvents = (pg.random ?? []).map(eventOnGlobal).filter(Boolean).map((e, i) => decodePageEvent(e, 'random', i + 1));
    }
    cards.push({
      id: c.support_id,
      urlName: c.url_name,
      charId: c.char_id,
      charName: c.char_name,
      title: c.title_en ?? '',
      name: `${c.title_en ?? ''} ${c.char_name}`.trim(),
      rarity,
      type: TYPE[c.type] ?? c.type,
      releaseEn: c.release_en,
      obtained: c.obtained ?? null,
      ...mechanics,
      hintSkills: ids(c.hints?.hint_skills),
      eventSkills: ids(c.event_skills_en ?? c.event_skills),
      hintOthers,
      chainEvents,
      randomEvents,
      recreationEvents,
      specialEvents,
    });
  }
  return cards.sort((a, b) => a.id - b.id);
}

function normalizeSkills(raw) {
  const out = [];
  for (const s of raw.skills) {
    const en = s.loc?.en ?? {};
    out.push({
      id: s.id,
      name: s.name_en ?? s.enname ?? s.jpname,   // official Global name when known
      altName: s.enname && s.enname !== s.name_en ? s.enname : null,
      nameJp: s.jpname ?? null,
      rarity: s.rarity,
      cost: en.cost ?? s.cost ?? null,
      iconId: en.iconid ?? s.iconid ?? null,
      versions: s.versions ?? [],
      tags: en.type ?? s.type ?? [],
      unreleasedEn: Array.isArray(s.unreleased) && s.unreleased.includes('en'),
      hintCards: (en.sup_hint ?? []).flat(),
      eventCards: (en.sup_e ?? []).flat(),
      innateChars: en.char ?? [],
      eventChars: en.char_e ?? [],
      desc: s.desc_en ?? s.endesc ?? '',
    });
  }
  return out.sort((a, b) => a.id - b.id);
}

const APT_KEYS = ['turf', 'dirt', 'sprint', 'mile', 'medium', 'long', 'front', 'pace', 'late', 'end'];
// The feed occasionally carries a skill id as a string (Super Creek's event skill 201352); ids are numbers here.
const ids = (list) => (list ?? []).map(Number);

// ---------- character events (from the per-character page JSON, data/raw/char-events.json) ----------

// Sets of races behind GameTora's crown shorthands, by Global race name and career year.
const CROWNS = {
  triple_crown: [['Satsuki Sho', 2], ['Tokyo Yushun (Japanese Derby)', 2], ['Kikuka Sho', 2]],
  triple_tiara: [['Oka Sho', 2], ['Japanese Oaks', 2], ['Shuka Sho', 2]],
  spring_triple_crown: [['Osaka Hai', 3], ['Tenno Sho (Spring)', 3], ['Takarazuka Kinen', 3]],
  autumn_triple_crown_senior: [['Tenno Sho (Autumn)', 3], ['Japan Cup', 3], ['Arima Kinen', 3]],
};
/**
 * A page condition -> a form the model can evaluate against the agenda. Race references are instance ids with an
 * optional "|year"; they become { raceId, year? } via the raw races table. Anything else is kept verbatim as
 * { type: 'unknown', raw } so the model can apply its fallback rate.
 */
function normalizeCondition(cond, instances, raceIdByName) {
  // Only G1s are on the tool's calendar; a condition naming any other race cannot be scored, so it stays unknown.
  const ref = (v) => {
    const [id, year] = String(v).split('|');
    const race = instances.get(Number(id));
    if (!race || race.grade !== 100) return null;
    return year ? { raceId: race.race_id, year: Number(year) } : { raceId: race.race_id };
  };
  const refs = (list) => { const out = list.map(ref); return out.every(Boolean) ? out : null; };
  const unknown = { type: 'unknown', raw: cond };
  const [type, ...args] = cond;
  switch (type) {
    case 'win': case 'pick_and_win': { const r = ref(args[0]); return r ? { type: 'win', races: [r] } : unknown; }
    case 'participate': { const r = ref(args[0]); return r ? { type: 'participate', race: r } : unknown; }
    case 'do_not_participate': { const r = ref(args[0]); return r ? { type: 'do_not_participate', race: r } : unknown; }
    case 'win_or': { const r = refs(args); return r ? { type: 'win_any', races: r } : unknown; }
    case 'win_all': { const r = refs(args[0] ?? []); return r ? { type: 'win_all', races: r } : unknown; }
    case 'win_n_of': { const r = refs(args[1] ?? []); return r ? { type: 'win_n_of', n: Number(args[0]), races: r } : unknown; }
    case 'date': return { type: 'date' }; // a timing condition: always satisfiable
    default: {
      const crown = CROWNS[type];
      if (crown) {
        const races = crown.map(([name, year]) => ({ raceId: raceIdByName.get(name), year })).filter((r) => r.raceId != null);
        if (races.length === crown.length) return { type: 'win_all', races };
      }
      return unknown;
    }
  }
}
const PAGE_GROUPS = [['nochoice', 'story'], ['wchoice', 'choice'], ['outings', 'outing'], ['secret', 'secret']];
/**
 * A character's events on Global, grouped by kind, with skill rewards decoded like card events. The character's
 * page carries the events every outfit shares; each outfit's own page carries that outfit's events under
 * `version` (a story or choice event by its option count), so those come from `outfitPage`.
 */
function normalizeCharEvents(pageEvents, outfitPage, instances, raceIdByName) {
  const out = [];
  const counters = { story: 0, choice: 0, outing: 0, secret: 0 };
  const push = (raw, kind) => {
    if (!raw || typeof raw !== 'object') return;
    const ev = eventOnGlobal(raw);
    if (!ev) return;
    const event = decodePageEvent(ev, kind, ++counters[kind]);
    if (kind === 'secret') event.conditions = (ev.conditions ?? []).map((c) => normalizeCondition(c, instances, raceIdByName));
    out.push(event);
  };
  for (const [group, kind] of PAGE_GROUPS) for (const raw of pageEvents?.[group] ?? []) push(raw, kind);
  for (const raw of outfitPage?.version ?? []) push(raw, Array.isArray(raw?.c) && raw.c.length > 1 ? 'choice' : 'story');
  return out;
}

function normalizeCharacters(raw, charEvents, charEventsByCard, races) {
  const instances = new Map(raw.races.map((r) => [r.id, r]));
  const raceIdByName = new Map(races.map((r) => [r.name, r.raceId]));
  // Career goals per character: race objectives with their calendar slot (turn 1 = Junior early January).
  const goalsByChar = new Map();
  for (const entry of raw['ura-objectives'] ?? []) {
    const goals = [];
    for (const o of entry.objectives ?? []) {
      if (o.cond_type !== 1 || !o.races?.length || o.turn > 72) continue;
      // cond_value is the placement the objective requires (1 = win, 5 = top five); 0 means taking part is enough
      goals.push({ slot: o.turn - 1, required: Number(o.cond_value ?? 0), races: o.races.map((r) => ({ raceId: r.id, name: r.name_en, distance: r.distance, surface: r.terrain === 2 ? 'dirt' : 'turf', grade: r.grade, fansNeeded: r.fans_needed ?? 0, fansGain: r.fans_gained ?? 0 })) });
    }
    // Route variants may repeat the same objective. Preserve distinct race choices, count repeated races once.
    const seen = new Set();
    const uniqueGoals = goals.map((g) => ({ ...g, races: g.races.filter((r) => {
      const key = `${g.slot}:${r.raceId}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }) })).filter((g) => g.races.length);
    goalsByChar.set(entry.char_id, uniqueGoals);
  }
  const out = [];
  for (const c of raw['character-cards']) {
    if (!c.release_en) continue;
    const aptitudes = {};
    APT_KEYS.forEach((k, i) => (aptitudes[k] = c.aptitude[i]));
    out.push({
      cardId: c.card_id,
      charId: c.char_id,
      name: c.name_en,
      title: c.title_en_gl ?? c.title ?? '',
      rarity: c.rarity,
      releaseEn: c.release_en,
      aptitudes,
      growth: c.stat_bonus,
      baseStats: c.base_stats,
      twoStarStats: c.two_star_stats ?? null,
      threeStarStats: c.three_star_stats ?? null,
      fourStarStats: c.four_star_stats ?? null,
      fiveStarStats: c.five_star_stats ?? null,
      innateSkills: ids(c.skills_innate),
      awakeningSkills: ids(c.skills_awakening_en ?? c.skills_awakening),
      eventSkills: ids(c.skills_event),
      uniqueSkills: ids(c.skills_unique),
      // shared events from the character's page; the outfit's own events from its page (the base outfit's page is the character's)
      events: normalizeCharEvents(charEvents[c.char_id], charEventsByCard[c.card_id] ?? charEvents[c.char_id], instances, raceIdByName),
      goals: goalsByChar.get(c.char_id) ?? [],
    });
  }
  return out.sort((a, b) => a.cardId - b.cardId);
}

const distanceCategory = (m) => (m <= 1400 ? 'sprint' : m <= 1800 ? 'mile' : m <= 2400 ? 'medium' : 'long');
/** Fans a first place gives, by race id, from the objectives data (the calendar's own fans_gain is an index into a fan table, not a count). */
function fansByRace(raw) {
  const byId = new Map(), byIndex = new Map();
  for (const entry of raw['ura-objectives'] ?? []) for (const o of entry.objectives ?? []) for (const r of o.races ?? []) if (r.fans_gained) byId.set(r.id, r.fans_gained);
  const races = new Map(raw.races.map((r) => [r.id, r]));
  for (const cal of raw['ura-races'] ?? []) { const r = races.get(cal.instance); if (r && byId.has(r.race_id)) byIndex.set(cal.fans_gain, byId.get(r.race_id)); }
  return { byId, byIndex };
}
function normalizeRaces(raw) {
  const races = new Map(raw.races.map((r) => [r.id, r]));
  const fans = fansByRace(raw);
  const out = [];
  for (const cal of raw['ura-races']) {
    const r = races.get(cal.instance);
    if (!r || r.grade !== 100) continue;
    out.push({
      calendarId: cal.id,
      raceInstanceId: r.id,
      raceId: r.race_id,
      name: r.name_en,
      distance: r.distance,
      category: distanceCategory(r.distance),
      surface: r.terrain === 2 ? 'dirt' : 'turf',
      year: cal.year,
      month: cal.month,
      half: cal.half,
      fansNeeded: cal.fans_needed,
      // fans for a win: the objectives' count for this race, else the count of a race sharing the same fan-set index
      fansGain: fans.byId.get(r.race_id) ?? fans.byIndex.get(cal.fans_gain) ?? 0,
      unreleasedEn: Array.isArray(r.unreleased_servers) && r.unreleased_servers.includes('en'),
    });
  }
  return out.sort((a, b) => a.year - b.year || a.month - b.month || a.half - b.half || a.name.localeCompare(b.name));
}

const RANK_NAMES = ['G', 'G+', 'F', 'F+', 'E', 'E+', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S', 'S+', 'SS', 'SS+'];
function normalizeRanks(raw) {
  return raw['en/db-files/single_mode_rank'].map((r, i) => {
    let name;
    if (i < RANK_NAMES.length) name = RANK_NAMES[i];
    else {
      const j = i - RANK_NAMES.length; // UG, UG1..UG9, UF, UF1..UF9, ...
      const letter = 'GFEDCBAS'[Math.floor(j / 10)] ?? '?';
      const n = j % 10;
      name = `U${letter}${n === 0 ? '' : n}`;
    }
    return { id: r.id, name, min: r.min_value, max: r.max_value };
  });
}

// Scenario events whose options are tied to a character: pick a linked option while training that character or
// carrying one of her cards and the gold skill is hinted; otherwise the normal version. Codes: sl = linked
// character id, nl/nsl = the not-linked branch.
function normalizeScenarioEvents(raw) {
  const evrew = raw['dict/evrew'];
  const out = [];
  for (const entry of raw['training_events/scenario']) {
    const scenarioId = entry[0];
    for (const group of entry.slice(1)) {
      for (const e of group) {
        if (!Array.isArray(e) || !Array.isArray(e[1])) continue;
        const choices = [];
        for (const ch of e[1]) {
          if (!Array.isArray(ch) || !Array.isArray(ch[1])) continue;
          const rw = ch[1].flatMap((id) => decodeRewards(evrew, id));
          const linked = rw.find((r) => r.t === 'sl');
          const skills = rw.filter((r) => r.t === 'sk').map((r) => r.d);
          if (linked && skills.length >= 2) choices.push({ linkedCharId: linked.d, goldSkill: skills[0], whiteSkill: skills[1] });
          else if (!linked && skills.length === 1 && e[1].some((c) => Array.isArray(c) && Array.isArray(c[1]) && c[1].flatMap((id) => decodeRewards(evrew, id)).some((r) => r.t === 'sl'))) choices.push({ linkedCharId: null, skill: skills[0] });
        }
        if (choices.some((c) => c.linkedCharId != null)) out.push({ scenarioId, eventId: e[0], strId: String(e[2]), choices });
      }
    }
  }
  return out;
}

function normalizeScenarios(raw) {
  return raw.scenarios.filter((s) => s.start_en).map((s) => ({
    id: s.id, name: s.name_en, fullName: s.name_en_full ?? s.name_en, urlName: s.url_name,
    linkedChars: (s.scenario_linked_characters ?? []).map((c) => ({ charId: c.char_id, name: c.name_en })),
    startEn: s.start_en,
  }));
}

async function normalize() {
  const raw = {};
  for (const key of STATIC_KEYS) raw[key] = await readJson(rawName(key));
  const namesFile = path.join(RAW, 'event-names.json');
  const eventNames = (await exists(namesFile)) ? await readJson(namesFile) : {};
  const pgFile = path.join(RAW, 'event-data-friend-group.json');
  const palGroupEvents = (await exists(pgFile)) ? await readJson(pgFile) : {};
  const utFile = path.join(RAW, 'unique-effect-texts.json');
  const uniqueTexts = (await exists(utFile)) ? await readJson(utFile) : {};
  const ceFile = path.join(RAW, 'char-events.json');
  const charEvents = (await exists(ceFile)) ? await readJson(ceFile) : {};
  const ceCardFile = path.join(RAW, 'char-events-by-card.json');
  const charEventsByCard = (await exists(ceCardFile)) ? await readJson(ceCardFile) : {};
  const pages = { eventNames, palGroupEvents, charEvents, charEventsByCard };
  const revisionFile = path.join(RAW, 'page-source-revisions.json');
  validatePageRevisions(raw, pages, uniqueTexts, (await exists(revisionFile)) ? await readJson(revisionFile) : undefined);
  validateGlobalPeriod(raw.scenarios, raw.skills);
  validateSourceTables(raw, pages);
  const cards = normalizeCards(raw, eventNames, palGroupEvents, uniqueTexts);
  const kita = cards.find((c) => c.id === 30028);
  const kitaLast = kita?.chainEvents[2]?.choices[0]?.outcomes.flat().some((r) => r.t === 'sk' && r.d === 200331);
  if (!kitaLast) throw new Error('event reward decoding self-check failed (Kitasan Black chain 3 should hint 200331)');
  const skills = normalizeSkills(raw);
  const races = normalizeRaces(raw);
  const characters = normalizeCharacters(raw, charEvents, charEventsByCard, races);
  const sw = characters.find((c) => c.charId === 1001);
  if (!sw?.events.some((e) => e.kind === 'secret' && e.conditions.some((c) => c.type === 'win'))) throw new Error('character event decoding self-check failed (Special Week should have a secret event with a win condition)');
  const ranks = normalizeRanks(raw);
  const effects = normalizeSupportEffects(raw.support_effects);
  const scenarios = normalizeScenarios(raw);
  const scenarioEvents = normalizeScenarioEvents(raw);
  reconcileSources(raw, pages, { cards, skills, characters, races, ranks, effects, scenarios, scenarioEvents });
  await writeJson(path.join(OUT, 'scenario-events.json'), scenarioEvents);
  await writeJson(path.join(OUT, 'cards.json'), cards);
  await writeJson(path.join(OUT, 'skills.json'), skills);
  await writeJson(path.join(OUT, 'characters.json'), characters);
  await writeJson(path.join(OUT, 'races.json'), races);
  await writeJson(path.join(OUT, 'ranks.json'), ranks);
  await writeJson(path.join(OUT, 'effects.json'), effects);
  await writeJson(path.join(OUT, 'scenarios.json'), scenarios);
  const fetchMeta = path.join(RAW, 'fetch-meta.json');
  const previousMeta = path.join(OUT, 'meta.json');
  const fetchedAt = (await exists(fetchMeta)) ? (await readJson(fetchMeta)).fetchedAt : (await exists(previousMeta)) ? (await readJson(previousMeta)).fetchedAt : null;
  await writeJson(previousMeta, { fetchedAt, source: 'https://gametora.com', cards: cards.length, skills: skills.length, characters: characters.length, races: races.length });
  console.log(`cards ${cards.length}, skills ${skills.length}, characters ${characters.length}, G1 calendar entries ${races.length}`);
  return { cards, skills, characters };
}

async function fetchImages({ cards, skills, characters }) {
  const jobs = [];
  for (const c of cards) jobs.push([`/images/umamusume/supports/support_card_s_${c.id}.png`, `supports/${c.id}.png`]);
  for (const c of cards.filter(c => c.rarity !== 'R')) jobs.push([`https://media.gametora.com/umamusume/supports/full/small/${c.id}.png`, `supports/full/${c.id}.png`]);
  for (const c of characters) jobs.push([`/images/umamusume/characters/thumb/chara_stand_${c.charId}_${c.cardId}.png`, `characters/${c.cardId}.png`]);
  for (const r of [1, 2, 3]) jobs.push([`/images/umamusume/icons/utx_txt_rarity_0${r}.png`, `icons/rarity_${r}.png`]);
  jobs.push(['/images/umamusume/icons/hint.png', 'icons/hint.png']);
  // support card type icons: 00 speed, 01 stamina, 02 power, 03 guts, 04 wit, 05 pal, 06 group
  for (const [i, t] of ['speed', 'stamina', 'power', 'guts', 'wit', 'pal', 'group'].entries()) jobs.push([`/images/umamusume/icons/utx_ico_obtain_0${i}.png`, `icons/type_${t}.png`]);
  jobs.push(['/images/umamusume/ui/sp.png', 'icons/sp.png']);
  // Skill icons only for skills that some Global card or character can give.
  const usedIcons = new Set();
  const skillById = new Map(skills.map((s) => [s.id, s]));
  const add = (id) => { const s = skillById.get(id); if (s?.iconId) usedIcons.add(s.iconId); };
  for (const c of cards) { c.hintSkills.forEach(add); c.eventSkills.forEach(add); }
  for (const c of characters) { c.innateSkills.forEach(add); c.awakeningSkills.forEach(add); c.eventSkills.forEach(add); }
  for (const s of skills) if (!s.unreleasedEn && s.iconId && (s.rarity === 1 || s.rarity === 2)) usedIcons.add(s.iconId);
  for (const ic of usedIcons) jobs.push([`/images/umamusume/skill_icons/utx_ico_skill_${ic}.png`, `skills/${ic}.png`]);
  let done = 0, skipped = 0, missing = 0;
  for (const [src, dst] of jobs) {
    const file = path.join(ASSETS, dst);
    if (!FORCE && (await exists(file))) { skipped++; continue; }
    const st = await fetchTo(src.startsWith('https://') ? src : BASE + src, file);
    if (st === 200) done++; else { missing++; console.warn('missing', src, st); }
  }
  console.log(`images: downloaded ${done}, already present ${skipped}, missing ${missing}`);
}

if (process.argv[1] && await fs.realpath(path.resolve(process.argv[1])) === new URL(import.meta.url).pathname) {
  if ([OFFLINE, DOWNLOAD_ONLY, NORMALIZE_ONLY].filter(Boolean).length > 1) throw new Error('Choose only one of --offline, --download-only and --normalize-only.');
  if (!OFFLINE && !NORMALIZE_ONLY) await fetchStatic();
  if (!DOWNLOAD_ONLY) {
    const norm = await normalize();
    if (IMAGES) await fetchImages(norm);
  }
  console.log(`requests made: ${requestCount}`);
}

export { normalizeCards, normalizeSkills, normalizeCharacters, normalizeRaces, normalizeRanks, normalizeScenarios, normalizeScenarioEvents };
