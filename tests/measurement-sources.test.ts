import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import modelJson from '../data/stat-model.json' with { type: 'json' };

test('measurement extraction matches complete source tables and preserves eligibility boundaries', () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'analysis', '-p', 'test_measurement_sources.py'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`);
});

test('the fitted model matches its saved measurement and card inputs', () => {
  for (const [path, expected] of Object.entries(modelJson.sourceAudit.inputs)) {
    const actual = createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex');
    assert.equal(actual, expected, `${path} changed; run npm run fit`);
  }
  assert.equal(modelJson.observed.length, modelJson.sourceAudit.loopacord.eligibleRows);
  const references = modelJson.observed.map((row) => row.sourceRef);
  assert.equal(new Set(references).size, references.length);
  assert.ok(modelJson.observed.every((row) => row.source === 'loopacord' && row.raceReference === 28 && row.runs >= 10));
});
