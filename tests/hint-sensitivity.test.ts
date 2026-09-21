import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../src/data.ts';
import { defaultState } from '../src/state.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { encodeShare, sharedChoices } from '../src/share.ts';

test('hint sensitivity uses a complete settings export or explicitly chosen defaults', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'uma-hint-sensitivity-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const saved = defaultState(loadData());
  saved.run.traineeCardId = 100501;
  saved.run.pinnedIds = [30028, 30052, 20031, 20005, 30017, 30078];
  saved.settings.hintScale = 1.5;
  saved.settings.hintBase = .12;
  saved.settings.goalTieTolerance = .07;
  saved.settings.chainRatesSSR = [.8, .5, .2];
  saved.settings.focus = 'balanced';
  saved.settings.winThreshold = .9;
  const code = await encodeShare(sharedChoices(saved));
  const settingsPath = join(dir, 'settings.json'), inventoryPath = join(dir, 'inventory.json');
  writeFileSync(inventoryPath, JSON.stringify(saved.inventory));
  const run = (...args: string[]) => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/hint-sensitivity.mjs', import.meta.url)),
    '--run', code, '--inventory', inventoryPath, '--multipliers', '1', ...args], { encoding: 'utf8', timeout: 30000 });

  const missing = run();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Share codes do not include advanced settings/);
  const conflicting = run('--settings', settingsPath, '--default-settings');
  assert.equal(conflicting.status, 1);
  assert.match(conflicting.stderr, /Choose --settings/);

  // The share owns focus and win threshold, matching a share import into the app.
  writeFileSync(settingsPath, JSON.stringify({ ...saved.settings, focus: 'stamina', winThreshold: .8 }));
  const custom = run('--settings', settingsPath, '--multipliers', '0.5,1,2');
  assert.equal(custom.status, 0, custom.stderr);
  const result = JSON.parse(custom.stdout);
  assert.equal(result.settingsSource, 'file');
  assert.deepEqual(result.baselineSettings, saved.settings);
  assert.equal(result.baselineHintScale, 1.5);
  assert.deepEqual(result.results.map((r: { hintScale: number }) => r.hintScale), [.75, 1.5, 3]);
  assert.equal(result.results[1].sameDeck, true);

  const defaults = run('--default-settings');
  assert.equal(defaults.status, 0, defaults.stderr);
  const defaultResult = JSON.parse(defaults.stdout);
  assert.equal(defaultResult.settingsSource, 'defaults');
  assert.deepEqual(defaultResult.baselineSettings, { ...DEFAULT_SETTINGS, focus: 'balanced', winThreshold: .9 });
  assert.equal(defaultResult.baselineHintScale, .75);

  for (const [snapshot, message] of [
    [{ hintScale: 1.5 }, /Missing or invalid setting/],
    [{ ...saved.settings, hintScale: 11 }, /Missing or invalid setting: hintScale/],
    [{ ...saved.settings, hintSclae: 1.5 }, /Unknown settings: hintSclae/],
    [[], /Expected a settings object/],
  ] as const) {
    writeFileSync(settingsPath, JSON.stringify(snapshot));
    const invalid = run('--settings', settingsPath);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, message);
    assert.equal(invalid.stdout, '', 'invalid snapshots must not produce a misleading report');
  }
});
