import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('card evaluation keeps held-out cards separate and fits known numeric relationships', () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'analysis', '-p', 'test_card_regression.py'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`);
});
