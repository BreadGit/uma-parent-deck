import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshDue, contentForComparison } from '../scripts/data-refresh.ts';

test('refresh schedule has a weekly fallback and delayed confirmed-release checks', () => {
  assert.equal(refreshDue(new Date('2026-10-05T12:37:00Z'), []), true);
  assert.equal(refreshDue(new Date('2026-10-06T12:37:00Z'), []), false);
  const releases = [{ at: '2026-10-06T10:00:00Z', source: 'https://example.com/official-announcement' }];
  assert.equal(refreshDue(new Date('2026-10-06T12:37:00Z'), releases), false);
  assert.equal(refreshDue(new Date('2026-10-06T14:00:00Z'), releases), true);
  assert.equal(refreshDue(new Date('2026-10-07T12:37:00Z'), releases), true);
  assert.equal(refreshDue(new Date('2026-10-08T15:00:00Z'), releases), false);
  assert.throws(() => refreshDue(new Date(), [{ ...releases[0]!, at: '2026-10-06' }]));
});

test('refresh comparison ignores check times but detects changed mission content and artwork', () => {
  const old = Buffer.from(JSON.stringify({ fetchedAt: '2026-10-01', events: [{ id: 1 }] }));
  const checked = Buffer.from(JSON.stringify({ fetchedAt: '2026-10-02', events: [{ id: 1 }] }));
  const changed = Buffer.from(JSON.stringify({ fetchedAt: '2026-10-02', events: [{ id: 2 }] }));
  assert.equal(contentForComparison('data/missions.json', old), contentForComparison('data/missions.json', checked));
  assert.notEqual(contentForComparison('data/missions.json', old), contentForComparison('data/missions.json', changed));
  assert.notDeepEqual(contentForComparison('public/assets/card.webp', old), contentForComparison('public/assets/card.webp', changed));
  assert.equal(contentForComparison('data/raw/manifest.json', old), contentForComparison('data/raw/manifest.json', changed));
});
