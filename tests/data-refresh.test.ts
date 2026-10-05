import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshDue, releasesFrom, contentForComparison } from '../scripts/data-refresh.ts';
import calendar from '../docs/umamusume/release-calendar.json' with { type: 'json' };

test('refresh schedule has a weekly fallback and delayed confirmed-release checks', () => {
  assert.equal(refreshDue(new Date('2026-10-05T12:37:00Z'), []), true);
  assert.equal(refreshDue(new Date('2026-10-06T12:37:00Z'), []), false);
  const releases = [{ at: '2026-10-06T10:00:00Z', source: 'https://example.com/official-announcement' }];
  assert.equal(refreshDue(new Date('2026-10-06T12:37:00Z'), releases), false);
  assert.equal(refreshDue(new Date('2026-10-06T14:00:00Z'), releases), true);
  assert.equal(refreshDue(new Date('2026-10-07T12:37:00Z'), releases), true);
  assert.equal(refreshDue(new Date('2026-10-07T14:00:00Z'), releases), false);
  assert.equal(refreshDue(new Date('2026-10-08T12:37:00Z'), releases), false);
});

test('the daily scheduled run refreshes once for each confirmed release', () => {
  const dailyRuns = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map(day => new Date(`${day}T12:37:00Z`));
  for (let minute = 0; minute < 24 * 60; minute += 15) {
    const at = new Date(Date.parse('2026-10-06T00:00:00Z') + minute * 60_000).toISOString();
    const releases = [{ at, source: 'https://example.com/official-announcement' }];
    assert.equal(dailyRuns.filter(run => refreshDue(run, releases)).length, 1, at);
  }
});

test('the checked-in release calendar is valid and malformed entries are rejected', () => {
  assert.doesNotThrow(() => releasesFrom(calendar));
  const release = { at: '2026-10-06T10:00:00Z', source: 'https://example.com/official-announcement' };
  assert.deepEqual(releasesFrom({ releases: [release] }), [release]);
  for (const bad of [{ ...release, at: '2026-10-06' }, { ...release, at: 'not a dateZ' }, { ...release, source: 'http://example.com' }, { at: release.at }]) {
    assert.throws(() => releasesFrom({ releases: [bad] }), JSON.stringify(bad));
  }
  assert.throws(() => releasesFrom({}));
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

test('refresh comparison ignores fitting roundoff but retains source and model changes', () => {
  const original = Buffer.from('{"fit":{"rmse":2.6134651659180705},"slope":0.8456547015729503}');
  const refitted = Buffer.from('{"fit":{"rmse":2.6134651659180737},"slope":0.8456547015729488}');
  const changed = Buffer.from('{"fit":{"rmse":2.6134651659180737},"slope":0.845655}');
  assert.equal(contentForComparison('data/stat-model.json', original), contentForComparison('data/stat-model.json', refitted));
  assert.notEqual(contentForComparison('data/stat-model.json', original), contentForComparison('data/stat-model.json', changed));
  assert.notDeepEqual(contentForComparison('data/raw/support-cards.json', original), contentForComparison('data/raw/support-cards.json', refitted));
});
