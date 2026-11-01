import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageCacheMatches, pageRevision, pageInputs, pageEvents, uniqueEffectText, PAGE_SOURCE_FILES, type PageCard } from '../scripts/page-cache.ts';

test('unique effect descriptions retain inline values and conditions after an unlock line', () => {
  const page = '<h3>Unique Effect</h3><div>Unlocked at level 40</div><div>Gain <span>Training Effectiveness</span> <b>(10)</b> when the bond gauge is at least <span>80</span></div><div>Next effect</div>';
  assert.equal(uniqueEffectText(page), 'Gain Training Effectiveness (10) when the bond gauge is at least 80');
  assert.throws(() => uniqueEffectText('<h3>Unique Effect</h3>'));
  const card = { support_id: 30081, char_id: 1081 }, payload = 'Gain Training Effectiveness';
  assert.equal(pageCacheMatches(pageRevision({ card, events: {}, rewards: [] }, payload), pageInputs(feed())('unique:30081', card), payload), false,
    'descriptions cached by the truncating parser must be fetched again');
});

/** A static feed with two support cards of different characters and one character card; reward IDs start at 36. */
function feed(): Record<string, unknown[]> {
  const files: Record<string, unknown[]> = Object.fromEntries(PAGE_SOURCE_FILES.map((file) => [file, []]));
  files.training_events__ssr = [[30001, [[557, [[28, [36]]], 830001001, [9, [['pre_first_anni', [557, [[28, [37]]], 830001001]]]]]]], [30002, [[600, [[29, [38]]], 830002001]]]];
  files.training_events__shared = [[1001, [[87, [[30, [39]]], 801001001]]], [1002, [[88, [[31, [40]]], 801002001]]]];
  files.training_events__char = [[1001, ['in'], [[1646, [[28, [41]]], '501001113']], [], [], []]];
  files.training_events__char_card = [[100101, [[1658, [[1589, [42]]], '501001513']]], [100102, [[1659, [[1590, [43]]], '501001514']]]];
  files.dict__evrew = [['sk', '+1', 200762], ['bo', '+5'], ['gu', '+15'], ['po', '+10'], ['sp', '+5'], ['mo', '+1'], ['in', '+5'], ['st', '+5']];
  return files;
}
const changed = (files: Record<string, unknown[]>, file: string, edit: (rows: any[]) => void) => {
  const copy = structuredClone(files);
  edit(copy[file]!);
  return copy;
};

test('a page cache follows its own card events and the rewards they use, not the rest of the feed', () => {
  const files = feed();
  const support: PageCard = { support_id: 30001, char_id: 1001 };
  const outfit: PageCard = { card_id: 100101, char_id: 1001 };
  const matches = (key: string, card: PageCard, edited: Record<string, unknown[]>) =>
    pageCacheMatches(pageRevision(pageInputs(files)(key, card), 'payload'), pageInputs(edited)(key, card), 'payload');
  assert.ok(matches('support:30001', support, files));
  assert.ok(matches('support:30001', support, changed(files, 'training_events__ssr', (rows) => { rows[1][1][0][0] = 601; })), 'another card\'s events');
  assert.ok(matches('support:30001', support, changed(files, 'training_events__shared', (rows) => { rows[1][1][0][0] = 89; })), 'another character\'s random events');
  assert.ok(matches('support:30001', support, changed(files, 'dict__evrew', (rows) => { rows[2] = ['gu', '+30']; })), 'a reward only another card uses');
  assert.ok(matches('support:30001', support, changed(files, 'dict__evrew', (rows) => { rows.push(['sk', '+2', 200763]); })), 'a new reward');
  assert.ok(!matches('support:30001', support, changed(files, 'training_events__ssr', (rows) => { rows[0][1].push([558, [[28, [36]]], 830001002]); })), 'its chain events');
  assert.ok(!matches('support:30001', support, changed(files, 'training_events__shared', (rows) => { rows[0][1][0][0] = 90; })), 'its character\'s random events');
  assert.ok(!matches('support:30001', support, changed(files, 'dict__evrew', (rows) => { rows[1] = ['bo', '+10']; })), 'a reward of an earlier event version');
  assert.ok(!matches('support:30001', support, changed(files, 'training_events__ssr', (rows) => { rows.splice(0, 1); })), 'its events removed from the feed');
  assert.ok(matches('outfit:100101', outfit, changed(files, 'training_events__char_card', (rows) => { rows[1][1][0][0] = 1660; })), 'another outfit\'s events');
  assert.ok(!matches('outfit:100101', outfit, changed(files, 'training_events__char', (rows) => { rows[0][2][0][0] = 1647; })), 'its character\'s events');
  assert.ok(!matches('character:1001', outfit, changed(files, 'dict__evrew', (rows) => { rows[6] = ['in', '+10']; })), 'a reward of its outfit events');
  assert.ok(matches('unique:30001', support, changed(files, 'training_events__ssr', (rows) => { rows[0][1][0][0] = 559; })), 'a unique effect text depends on the card alone');
  assert.throws(() => pageInputs(files)('skill:1', support), /Unknown page cache key/);
});

test('page caches expire after source changes or payload corruption', () => {
  const input = { card: { id: 1, unique: { value: 5 } }, events: 'first-revision' };
  const payload = { random: [{ n: 'An event', c: [{ r: [{ t: 'sk', d: 123 }] }] }] };
  const revision = pageRevision(input, payload);
  assert.ok(pageCacheMatches(revision, input, payload));
  assert.ok(!pageCacheMatches(undefined, input, payload), 'legacy caches have no verified input revision');
  assert.ok(!pageCacheMatches(revision, { ...input, events: 'new-revision' }, payload));
  assert.ok(!pageCacheMatches(revision, { ...input, card: { id: 1, unique: { value: 10 } } }, payload));
  assert.ok(!pageCacheMatches(revision, input, {}));
  assert.ok(!pageCacheMatches(revision, input, null));
});

test('missing or changed page event structures cannot become successful cache entries', () => {
  const event = { n: 'An event', c: [{ r: [{ t: 'sk', d: 123 }] }] };
  assert.deepEqual(pageEvents(JSON.stringify({ random: [event] }), 'support', 'test'), { random: [event] });
  for (const value of [null, {}, { random: [] }, { random: {} }, { random: [{ n: 'No rewards' }] },
    { random: [event], future_events: [event] }, { random: [{ ...event, c: [{ r: [{ skill: 123 }] }] }] }]) {
    assert.throws(() => pageEvents(value, 'support', 'test'));
  }
});

test('all saved character and pal/group page payloads pass event validation', () => {
  for (const [file, kind] of [['event-data-friend-group', 'support'], ['char-events', 'character'], ['char-events-by-card', 'character']] as const) {
    const data = JSON.parse(readFileSync(new URL(`../data/raw/${file}.json`, import.meta.url), 'utf8'));
    for (const [id, value] of Object.entries(data)) assert.doesNotThrow(() => pageEvents(value, kind, `${file}/${id}`));
  }
});
