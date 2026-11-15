import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from './helpers.ts';
import { readFileSync } from 'node:fs';
import { checkSkillPlaces, decodeRewards, eventOnGlobal, goalRaceKeys, isOutcomeBreak, normalizeCondition, normalizeReward, staticEventOnGlobal, validateGlobalPeriod, type ConditionRaces } from '../scripts/event-import.ts';
import { parseSourceDownload, reconcileSources, validatePageRevisions, validateSourceTables, type NormalizedTables, type PageSources, type SourceTables } from '../scripts/source-validation.ts';
import { pageRevision, pageInputs, PAGE_SOURCE_FILES, type PageRevision } from '../scripts/page-cache.ts';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
const keys = ['support-cards', 'support_effects', 'skills', 'character-cards', 'characters', 'races', 'ura-races', 'ura-objectives', 'scenarios', 'en/db-files/single_mode_rank',
  'training_events/ssr', 'training_events/sr', 'training_events/friend', 'training_events/group', 'training_events/shared', 'training_events/char', 'training_events/char_card', 'training_events/scenario', 'dict/evrew'];
const raw: SourceTables = Object.fromEntries(keys.map((key) => [key, read(`raw/${key.replaceAll('/', '__')}`)]));
const pages: PageSources = { eventNames: read('raw/event-names'), palGroupEvents: read('raw/event-data-friend-group'), charEvents: read('raw/char-events'), charEventsByCard: read('raw/char-events-by-card') };
const normalized: NormalizedTables = { cards: read('cards'), skills: read('skills'), characters: read('characters'), races: read('races'), ranks: read('ranks'), effects: read('effects'), scenarios: read('scenarios'), scenarioEvents: read('scenario-events') };

test('all normalized GameTora runtime datasets reconcile with their cached sources', () => {
  validateGlobalPeriod(raw.scenarios as { id: number; start_en?: number }[], raw.skills as { id: number; unreleased?: string[] }[]);
  validateSourceTables(raw, pages);
  reconcileSources(raw, pages, normalized);
});

test('source reconciliation detects lost records, incorrect fields and dropped reward flags', () => {
  const cases: [string, (data: NormalizedTables) => void][] = [
    ['cards ID completeness', (data) => { data.cards.pop(); }],
    ['passive', (data) => { data.cards[0]!.effectsByLb[4][1] = 999; }],
    ['Global event skills', (data) => { must(data.cards.find((card) => card.id === 30053)).eventSkills.push(202992); }],
    ['rewards', (data) => { must(data.cards.find((card) => card.id === 30071)).chainEvents.forEach((event: { choices: { outcomes: { r?: boolean }[][] }[] }) => event.choices.forEach((choice) => choice.outcomes.flat().forEach((reward) => delete reward.r))); }],
    ['name/cost', (data) => { must(data.skills.find((skill) => skill.cost != null)).cost = 999; }],
    ['aptitudes', (data) => { data.characters[0]!.aptitudes.turf = 'G'; }],
    ['objectives', (data) => { data.characters[0]!.goals.pop(); }],
    ['fan reward', (data) => { data.races[0]!.fansGain += 1; }],
    ['boundaries', (data) => { data.ranks[0]!.max += 1; }],
    ['scenario linked skill reward completeness', (data) => { data.scenarioEvents.pop(); }],
  ];
  for (const [expected, change] of cases) {
    const data = structuredClone(normalized);
    change(data);
    assert.throws(() => reconcileSources(raw, pages, data), new RegExp(expected));
  }
});

test('source validation detects duplicate IDs, unresolved references and missing outfit caches', () => {
  assert.throws(() => validateSourceTables({ ...raw, skills: [...raw.skills!, raw.skills![0]!] }, pages), /duplicates id/);
  const skills = raw.skills!.map((skill, i) => i ? skill : { ...skill, versions: [999999999] });
  assert.throws(() => validateSourceTables({ ...raw, skills }, pages), /references unknown skill/);
  assert.throws(() => validateSourceTables(raw, { ...pages, charEventsByCard: {} }), /outfit .* page is missing/);
  const races = raw['ura-races']!.map((race, i) => i ? race : { ...race, instance: 99999999 });
  assert.throws(() => validateSourceTables({ ...raw, 'ura-races': races }, pages), /references missing race instance/);
});

test('successful HTTP responses must contain the expected JSON shape before caching', () => {
  assert.throws(() => parseSourceDownload('<html>Error page</html>', 'array', 'skills'), SyntaxError);
  assert.throws(() => parseSourceDownload('{"error":"unavailable"}', 'array', 'skills'), /expected JSON array/);
  assert.throws(() => parseSourceDownload('null', 'object', 'manifest'), /expected JSON object/);
  assert.deepEqual(parseSourceDownload('[{"id":1}]', 'array', 'skills'), [{ id: 1 }]);
});

test('Global historical rewards exclude future hints and preserve the applicable earlier snapshot', () => {
  const current = [1, [[2, [100]]], 3, [9, [['pre_first_anni', [1, [[2, [101]]], 3]], ['pre_2024_wedding', [1, [[2, [102]]], 3]]]]];
  assert.deepEqual(staticEventOnGlobal(current), [1, [[2, [102]]], 3]);
  const event = { c: [{ r: [{ t: 'sk', d: 2 }] }], history: [{ period: 'pre_2nd_anni', data: { c: [{ r: [{ t: 'sk', d: 1 }] }] } }] };
  assert.equal(eventOnGlobal(event)!.c[0]!.r[0]!.d, 1);
  assert.equal(eventOnGlobal({ did_not_exist: 'pre_2nd_anni' }), null);
  assert.throws(() => eventOnGlobal({ did_not_exist: 'pre_unknown_update' }), /Unknown event history period/);
  const older = { c: [{ r: [{ t: 'sk', d: 2 }] }], history: [{ period: 'pre_2021_12_27', data: { c: [{ r: [{ t: 'sk', d: 1 }] }] } }] };
  assert.equal(eventOnGlobal(older)!.c[0]!.r[0]!.d, 2, 'Global already has changes made before the first anniversary');
  const newer = { c: [{ r: [{ t: 'sk', d: 2 }] }], history: [{ period: 'pre_tracen_ken', data: { c: [{ r: [{ t: 'sk', d: 1 }] }] } }] };
  assert.equal(eventOnGlobal(newer)!.c[0]!.r[0]!.d, 1, 'Global does not have the Tracen-ken changes yet');
  for (const id of [10008, 10061, 20029, 30053, 30095]) {
    const card = must(normalized.cards.find((card) => card.id === id));
    assert.ok(!card.eventSkills.includes(202992), `card ${id} lists the future hint`);
    assert.ok(!JSON.stringify(card.randomEvents).includes('202992'), `card ${id} random events reward the future hint`);
  }
});

test('page conditions resolve objective, placing and date forms against G1s and the trainee\'s own goals', () => {
  const instances = new Map([[101901, { race_id: 1019, grade: 100, name_en: 'Japan Cup' }], [202601, { race_id: 2026, grade: 200, name_en: 'Mainichi Okan' }], [303401, { race_id: 3034, grade: 300, name_en: 'Hakodate Sprint S.' }],
    [100501, { race_id: 1005, grade: 100, name_en: 'Satsuki Sho' }], [102801, { race_id: 1028, grade: 100, name_en: 'Satsuki Sho' }], [102501, { race_id: 1025, grade: 100, name_en: 'Takarazuka Kinen' }]]);
  const calendar = new Map([['Japan Cup', 1019], ['Satsuki Sho', 1005], ['Tokyo Yushun (Japanese Derby)', 1010], ['Kikuka Sho', 1015], ['Takarazuka Kinen', 1012]]);
  const races: ConditionRaces = { instances, raceIdByName: calendar, goalRaces: goalRaceKeys([{ slot: 66, races: [{ raceId: 2026 }] }, { slot: 35, races: [{ raceId: 3034 }] }, { slot: 59, races: [{ raceId: 1025 }] }]) };
  const win = (raceId: number, year?: number) => ({ type: 'win', races: [year ? { raceId, year } : { raceId }] });
  assert.deepEqual(normalizeCondition(['obj_win', '101901|3'], races), win(1019, 3));
  assert.deepEqual(normalizeCondition(['obj_race_place', '101901|3', [1, 3]], races), win(1019, 3), 'a placing range that includes first counts as a win');
  assert.deepEqual(normalizeCondition(['race_place', 101901, [1]], races), win(1019));
  assert.equal(normalizeCondition(['obj_race_place', '101901|3', [2, 3]], races).type, 'unknown', 'a finish below first cannot be scored');
  assert.equal(normalizeCondition(['race_place', 101901, [2, null]], races).type, 'unknown');
  assert.deepEqual(normalizeCondition(['obj_participate', 101901], races), { type: 'participate', race: { raceId: 1019 } });
  assert.deepEqual(normalizeCondition(['obj_win', '202601|3'], races), win(2026, 3), 'a G2 goal in that year is on the agenda');
  assert.deepEqual(normalizeCondition(['win', 202601], races), win(2026), 'a goal race counts for any year');
  assert.equal(normalizeCondition(['win', '303401|3'], races).type, 'unknown', 'the goal is in the Classic year, so a Senior-year running cannot be scheduled');
  assert.equal(normalizeCondition(['win', 999901], races).type, 'unknown');
  assert.deepEqual(normalizeCondition(['win', 102801], races), win(1005), 'a G1 held at another venue runs as the calendar race of its name');
  assert.deepEqual(normalizeCondition(['obj_win', '102501|3'], races), win(1025, 3), 'a venue variant the trainee has as a goal stays that goal');
  assert.deepEqual(normalizeCondition(['date_range', [2, 5, 1], [2, 8, 1]], races), { type: 'date' });
  assert.deepEqual(normalizeCondition(['between_dates', [2, 6, 1], [3, 12, 2], ['s_gn_race_w', 1, 100, '0+']], races), { type: 'date' });
  assert.equal(normalizeCondition(['between_dates', [2, 6, 1], [3, 12, 2], ['s_gn_race_w', 1, 100, '3+']], races).type, 'unknown');
  assert.deepEqual(normalizeCondition(['triple_crown'], races), { type: 'win_all', races: [{ raceId: 1005, year: 2 }, { raceId: 1010, year: 2 }, { raceId: 1015, year: 2 }] });
  assert.deepEqual(normalizeCondition(['win_n_of', 1, [101901, '202601|3']], races), { type: 'win_n_of', n: 1, races: [{ raceId: 1019 }, { raceId: 2026, year: 3 }] });
  assert.equal(normalizeCondition(['win_n_of', 0, [101901]], races).type, 'unknown', 'a win count that only picks a branch cannot be scored');
  assert.deepEqual(normalizeCondition(['beat_rival', '101901|3', 1014], races), { type: 'unknown', raw: ['beat_rival', '101901|3', 1014] });
});

test('event rewards split into outcomes at either break marker, and skills on a later place branch stop the import', () => {
  assert.ok(isOutcomeBreak({ t: 'di' }) && isOutcomeBreak({ t: 'di_s' }) && !isOutcomeBreak({ t: 'nl' }));
  const branches = (r: { t: string; d?: unknown }[]) => ({ n: 'After the race', c: [{ r }] });
  assert.doesNotThrow(() => checkSkillPlaces(branches([{ t: 'pl', d: [1] }, { t: 'sk', d: 1 }, { t: 'nl' }, { t: 'pl', d: [2, 3] }, { t: 'rr' }])));
  assert.doesNotThrow(() => checkSkillPlaces(branches([{ t: 'pl', d: [2, 3] }, { t: 'rr' }, { t: 'nl' }, { t: 'sk', d: 1 }])), 'a branch ends at nl');
  assert.throws(() => checkSkillPlaces(branches([{ t: 'pl', d: [1] }, { t: 'rr' }, { t: 'nl' }, { t: 'pl', d: [2, 3] }, { t: 'sk', d: 1 }])), /\[2,3\] place branch/);
  assert.throws(() => checkSkillPlaces(branches([{ t: 'pl', d: [2] }, { t: 'sr', d: [{ d: 1 }] }])), /place branch/);
});

test('Global release boundary changes force review of the historical-period assumption', () => {
  const scenarios = [{ id: 3, start_en: 1 }, { id: 5 }];
  const skills = [{ id: 202992, unreleased: ['en'] }];
  assert.doesNotThrow(() => validateGlobalPeriod(scenarios, skills));
  assert.throws(() => validateGlobalPeriod([{ id: 3, start_en: 1 }, { id: 5, start_en: 2 }], skills), /content-period canary changed/);
  assert.throws(() => validateGlobalPeriod(scenarios, [{ id: 202992, unreleased: [] }]), /content-period canary changed/);
});

test('reward decoding retains source flags, numeric skill references and bundled rewards', () => {
  assert.deepEqual(decodeRewards([['sk', '+1', '201352', true]], 36), [{ t: 'sk', v: '+1', d: 201352, r: true }]);
  assert.deepEqual(decodeRewards([[null, null, null, [{ t: '5s', v: '+3' }, { t: 'pt', v: '+45' }]]], 36), [{ t: '5s', v: '+3' }, { t: 'pt', v: '+45' }]);
  assert.deepEqual(normalizeReward({ t: 'sr', d: [{ d: '201352', v: '+1' }], r: true }), { t: 'sr', d: [{ d: 201352, v: '+1' }], r: true });
  assert.throws(() => decodeRewards([], 36), /no valid dictionary entry/);
  assert.throws(() => normalizeReward({ t: 'sk', d: 'wrong' }), /invalid skill ID/);
  assert.throws(() => normalizeReward({ t: 'sk', d: 201352, condition: 'new mechanic' }), /unsupported structure/);
});

test('recorded page revisions reject interrupted refreshes and stale page payloads', () => {
  const inputFor = pageInputs(Object.fromEntries(PAGE_SOURCE_FILES.map((key) => [key, raw[key.replace('__', '/')]!])));
  const revisions: Record<string, PageRevision> = {};
  const uniqueTexts = read('raw/unique-effect-texts');
  for (const card of raw['support-cards']!.filter((card) => card.release_en)) {
    const payload = { names: pages.eventNames[card.support_id], ...(['friend', 'group'].includes(card.type) ? { full: pages.palGroupEvents[card.support_id] } : {}) };
    revisions[`support:${card.support_id}`] = pageRevision(inputFor(`support:${card.support_id}`, card), payload);
    if (card.unique?.effects.some((effect: { type: number }) => effect.type >= 100)) revisions[`unique:${card.support_id}`] = pageRevision(inputFor(`unique:${card.support_id}`, card), uniqueTexts[card.support_id]);
  }
  const seen = new Set();
  for (const card of raw['character-cards']!.filter((card) => card.release_en).sort((a, b) => a.card_id - b.card_id)) {
    const first = !seen.has(card.char_id); seen.add(card.char_id);
    const key = `${first ? 'character' : 'outfit'}:${first ? card.char_id : card.card_id}`;
    revisions[key] = pageRevision(inputFor(key, card), first ? pages.charEvents[card.char_id] : pages.charEventsByCard[card.card_id]);
  }
  assert.doesNotThrow(() => validatePageRevisions(raw, pages, uniqueTexts, revisions));
  assert.doesNotThrow(() => validatePageRevisions(raw, pages, uniqueTexts));
  assert.throws(() => validatePageRevisions(raw, pages, uniqueTexts, {}), /page cache does not match/);
  assert.throws(() => validatePageRevisions(raw, { ...pages, eventNames: {} }, uniqueTexts, revisions), /page cache does not match/);
});
