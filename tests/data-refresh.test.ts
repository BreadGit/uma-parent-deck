import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedSources, contentForComparison } from '../scripts/data-refresh.ts';
import recorded from '../data/raw/hashes.json' with { type: 'json' };

test('a refresh is due when a recorded source file has a new hash in the GameTora manifest', () => {
  const manifest = { 'support-cards': 'a1', skills: 'b1', 'unused/source': 'c1' };
  assert.deepEqual(changedSources(manifest, { 'support-cards': 'a1', skills: 'b1' }), []);
  assert.deepEqual(changedSources({ ...manifest, 'unused/source': 'c2' }, { 'support-cards': 'a1', skills: 'b1' }), [], 'a file the snapshot does not use');
  assert.deepEqual(changedSources({ ...manifest, skills: 'b2' }, { 'support-cards': 'a1', skills: 'b1' }), ['skills']);
  assert.deepEqual(changedSources({ skills: 'b1' }, { 'support-cards': 'a1', skills: 'b1' }), ['support-cards'], 'a file removed from the manifest');
  assert.deepEqual(changedSources(Object.fromEntries(Object.keys(recorded).map(key => [key, 'new'])), recorded), Object.keys(recorded));
  assert.throws(() => changedSources([], { skills: 'b1' }), /not an object/);
  assert.throws(() => changedSources(manifest, {}), /records no source files/);
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
