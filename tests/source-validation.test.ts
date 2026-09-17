import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeRewards, eventOnGlobal, normalizeReward, staticEventOnGlobal, validateGlobalPeriod } from '../scripts/event-import.ts';
import { parseSourceDownload, reconcileSources, validatePageRevisions, validateSourceTables, type NormalizedTables, type PageSources, type SourceTables } from '../scripts/source-validation.ts';
import { fingerprint, pageRevision, type PageRevision } from '../scripts/page-cache.ts';

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
    ['Global event skills', (data) => { data.cards.find((card) => card.id === 30053)!.eventSkills.push(202992); }],
    ['rewards', (data) => { data.cards.find((card) => card.id === 30071)!.chainEvents.forEach((event: { choices: { outcomes: { r?: boolean }[][] }[] }) => event.choices.forEach((choice) => choice.outcomes.flat().forEach((reward) => delete reward.r))); }],
    ['name/cost', (data) => { data.skills.find((skill) => skill.cost != null)!.cost = 999; }],
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
  for (const id of [10008, 10061, 20029, 30053, 30095]) {
    const card = normalized.cards.find((card) => card.id === id)!;
    assert.ok(!card.eventSkills.includes(202992));
    assert.ok(!JSON.stringify(card.randomEvents).includes('202992'));
  }
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
  const files = ['training_events__ssr', 'training_events__sr', 'training_events__friend', 'training_events__group', 'training_events__shared', 'training_events__char', 'training_events__char_card', 'dict__evrew'];
  const sources = Object.fromEntries(files.map((key) => [key, fingerprint(raw[key.replace('__', '/')])]));
  const revisions: Record<string, PageRevision> = {};
  const uniqueTexts = read('raw/unique-effect-texts');
  for (const card of raw['support-cards']!.filter((card) => card.release_en)) {
    const payload = { names: pages.eventNames[card.support_id], ...(['friend', 'group'].includes(card.type) ? { full: pages.palGroupEvents[card.support_id] } : {}) };
    revisions[`support:${card.support_id}`] = pageRevision({ card, sources }, payload);
    if (card.unique?.effects.some((effect: { type: number }) => effect.type >= 100)) revisions[`unique:${card.support_id}`] = pageRevision({ card, sources }, uniqueTexts[card.support_id]);
  }
  const seen = new Set();
  for (const card of raw['character-cards']!.filter((card) => card.release_en).sort((a, b) => a.card_id - b.card_id)) {
    const first = !seen.has(card.char_id); seen.add(card.char_id);
    revisions[`${first ? 'character' : 'outfit'}:${first ? card.char_id : card.card_id}`] = pageRevision({ card, sources }, first ? pages.charEvents[card.char_id] : pages.charEventsByCard[card.card_id]);
  }
  assert.doesNotThrow(() => validatePageRevisions(raw, pages, uniqueTexts, revisions));
  assert.doesNotThrow(() => validatePageRevisions(raw, pages, uniqueTexts));
  assert.throws(() => validatePageRevisions(raw, pages, uniqueTexts, {}), /page cache does not match/);
  assert.throws(() => validatePageRevisions(raw, { ...pages, eventNames: {} }, uniqueTexts, revisions), /page cache does not match/);
});
