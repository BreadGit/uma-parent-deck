import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageCacheMatches, pageRevision, pageEvents } from '../scripts/page-cache.ts';

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
