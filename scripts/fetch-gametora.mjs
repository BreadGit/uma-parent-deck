// Fetches Umamusume Global data from GameTora's static JSON feed and normalizes
// it into data/*.json plus thumbnails under public/assets/.
//
// Load policy: one request at a time, ~1.1 s apart, generic browser user agent,
// no identifying headers. Files already on disk are never re-downloaded unless
// the manifest hash changed (data) or --force is passed (images).
//
// Usage: node scripts/fetch-gametora.mjs [--force] [--no-images]

import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://gametora.com';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const DELAY_MS = 1100;
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'data');
const ASSETS = path.join(ROOT, 'public', 'assets');
const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const IMAGES = !args.has('--no-images');

const STATIC_KEYS = [
  'support-cards', 'support_effects', 'skills', 'character-cards', 'characters',
  'races', 'ura-races', 'scenarios', 'en/db-files/single_mode_rank', 'en/db-files/support_card_level',
  'training_events/ssr', 'training_events/sr', 'training_events/friend', 'training_events/group',
  'training_events/shared', 'training_events/char_card', 'training_events/scenario', 'dict/evrew', 'status-effects',
];

let lastRequest = 0;
let requestCount = 0;
async function throttle() {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  requestCount++;
}
async function fetchTo(url, file) {
  await throttle();
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return res.status;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
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
  const status = await fetchTo(`${BASE}/data/manifests/umamusume.json`, manifestFile);
  if (status !== 200) throw new Error(`manifest ${status}`);
  const manifest = await readJson(manifestFile);
  const hashesFile = path.join(RAW, 'hashes.json');
  const hashes = (await exists(hashesFile)) ? await readJson(hashesFile) : {};
  for (const key of STATIC_KEYS) {
    const hash = manifest[key];
    if (!hash) { console.warn('manifest has no', key); continue; }
    const file = rawName(key);
    if (!FORCE && hashes[key] === hash && (await exists(file))) continue;
    console.log('fetch', key, hash);
    const st = await fetchTo(`${BASE}/data/umamusume/${key}.${hash}.json`, file);
    if (st !== 200) throw new Error(`${key} ${st}`);
    hashes[key] = hash;
  }
  await writeJson(hashesFile, hashes);
}

// ---------- normalization ----------

const RARITY = { 1: 'R', 2: 'SR', 3: 'SSR' };
// effects rows: [type, lv1, lv5, lv10, lv15, lv20, lv25, lv30, lv35, lv40, lv45, lv50]
const LEVELS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
// Level reached at each limit break by rarity.
const LB_LEVEL = { R: [20, 25, 30, 35, 40], SR: [25, 30, 35, 40, 45], SSR: [30, 35, 40, 45, 50] };
const TYPE = { intelligence: 'wit', speed: 'speed', stamina: 'stamina', power: 'power', guts: 'guts', friend: 'pal', group: 'group' };

function fillForward(row) {
  const out = [];
  let cur = 0;
  for (let i = 1; i < row.length; i++) {
    if (row[i] !== -1) cur = row[i];
    out.push(cur);
  }
  return out;
}

// Reward ids in the training_events files are offset by 36 from their index in
// dict/evrew. Verified against Special Week R (10001), Fuji Kiseki SR (20001)
// and Kitasan Black SSR (30028) whose page data is known.
const REWARD_ID_OFFSET = 36;
function decodeReward(evrew, id) {
  const r = evrew[id - REWARD_ID_OFFSET];
  if (!r) return { t: 'unknown', id };
  const [t, v, d] = r;
  const out = { t };
  if (v != null) out.v = v;
  if (d != null) out.d = d;
  return out;
}

// Event entry: [nameId, choices, strId, ...history]. choices: [[choiceId, [rewardIds]]] or "no".
function decodeEvent(evrew, entry, kind, index) {
  const choicesRaw = Array.isArray(entry[1]) ? entry[1] : [];
  const choices = choicesRaw.map((c) => {
    const rewardIds = Array.isArray(c) && Array.isArray(c[1]) ? c[1] : [];
    const outcomes = [[]];
    for (const rid of rewardIds) {
      const rw = decodeReward(evrew, rid);
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
      const out = { t: r.t };
      if (r.v != null) out.v = r.v;
      if (r.d != null) out.d = r.d;
      outcomes[outcomes.length - 1].push(out);
    }
    return { outcomes };
  });
  return { kind, index, name: ev.n, choices };
}

function normalizeCards(raw, eventNames, palGroupEvents) {
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
    const effects = {};
    for (const row of c.effects) effects[row[0]] = fillForward(row);
    const effectsByLb = LB_LEVEL[rarity].map((lvl) => {
      const idx = LEVELS.indexOf(lvl);
      const e = {};
      for (const [type, vals] of Object.entries(effects)) if (vals[idx] > 0) e[type] = vals[idx];
      if (c.unique && lvl >= c.unique.level) {
        for (const u of c.unique.effects) e[`u${u.type}`] = u.value;
      }
      return e;
    });
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
      recreationEvents = outings.map((e, i) => decodePageEvent(e, 'recreation', i + 1));
      specialEvents = (pg.special ?? []).map((e, i) => decodePageEvent(e, 'special', i + 1));
      randomEvents = (pg.random ?? []).map((e, i) => decodePageEvent(e, 'random', i + 1));
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
      effects,
      effectsByLb,
      unique: c.unique ?? null,
      hintSkills: c.hints?.hint_skills ?? [],
      eventSkills: c.event_skills ?? [],
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
function normalizeCharacters(raw) {
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
      fourStarStats: c.four_star_stats ?? null,
      fiveStarStats: c.five_star_stats ?? null,
      innateSkills: c.skills_innate ?? [],
      awakeningSkills: c.skills_awakening_en ?? c.skills_awakening ?? [],
      eventSkills: c.skills_event ?? [],
      uniqueSkills: c.skills_unique ?? [],
    });
  }
  return out.sort((a, b) => a.cardId - b.cardId);
}

const distanceCategory = (m) => (m <= 1400 ? 'sprint' : m <= 1800 ? 'mile' : m <= 2400 ? 'medium' : 'long');
function normalizeRaces(raw) {
  const races = new Map(raw.races.map((r) => [r.id, r]));
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
      fansGain: cal.fans_gain,
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

function normalizeEffects(raw) {
  return raw.support_effects.map((e) => ({ id: e.id, name: e.name_en, symbol: e.symbol ?? 'none', calc: e.calc ?? 'add' }));
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
          const rw = ch[1].map((id) => decodeReward(evrew, id));
          const linked = rw.find((r) => r.t === 'sl');
          const skills = rw.filter((r) => r.t === 'sk').map((r) => r.d);
          if (linked && skills.length >= 2) choices.push({ linkedCharId: linked.d, goldSkill: skills[0], whiteSkill: skills[1] });
          else if (!linked && skills.length === 1 && e[1].some((c) => Array.isArray(c) && Array.isArray(c[1]) && c[1].map((id) => decodeReward(evrew, id)).some((r) => r.t === 'sl'))) choices.push({ linkedCharId: null, skill: skills[0] });
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
  const cards = normalizeCards(raw, eventNames, palGroupEvents);
  const kita = cards.find((c) => c.id === 30028);
  const kitaLast = kita?.chainEvents[2]?.choices[0]?.outcomes.flat().some((r) => r.t === 'sk' && r.d === 200331);
  if (!kitaLast) throw new Error('event reward decoding self-check failed (Kitasan Black chain 3 should hint 200331)');
  const skills = normalizeSkills(raw);
  const characters = normalizeCharacters(raw);
  const races = normalizeRaces(raw);
  const ranks = normalizeRanks(raw);
  const effects = normalizeEffects(raw);
  const scenarios = normalizeScenarios(raw);
  const scenarioEvents = normalizeScenarioEvents(raw);
  await writeJson(path.join(OUT, 'scenario-events.json'), scenarioEvents);
  await writeJson(path.join(OUT, 'cards.json'), cards);
  await writeJson(path.join(OUT, 'skills.json'), skills);
  await writeJson(path.join(OUT, 'characters.json'), characters);
  await writeJson(path.join(OUT, 'races.json'), races);
  await writeJson(path.join(OUT, 'ranks.json'), ranks);
  await writeJson(path.join(OUT, 'effects.json'), effects);
  await writeJson(path.join(OUT, 'scenarios.json'), scenarios);
  await writeJson(path.join(OUT, 'meta.json'), { fetchedAt: new Date().toISOString(), source: 'https://gametora.com', cards: cards.length, skills: skills.length, characters: characters.length, races: races.length });
  console.log(`cards ${cards.length}, skills ${skills.length}, characters ${characters.length}, G1 calendar entries ${races.length}`);
  return { cards, skills, characters };
}

async function fetchImages({ cards, skills, characters }) {
  const jobs = [];
  for (const c of cards) jobs.push([`/images/umamusume/supports/support_card_s_${c.id}.png`, `supports/${c.id}.png`]);
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
    const st = await fetchTo(BASE + src, file);
    if (st === 200) done++; else { missing++; console.warn('missing', src, st); }
  }
  console.log(`images: downloaded ${done}, already present ${skipped}, missing ${missing}`);
}

await fetchStatic();
const norm = await normalize();
if (IMAGES) await fetchImages(norm);
console.log(`requests made: ${requestCount}`);
