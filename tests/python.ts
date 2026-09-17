// The analysis tests are Python unittest modules. Run them from node:test so `npm test` covers them, and skip with a
// visible reason when the interpreter or its packages are missing, rather than failing on a spawn error.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { TestContext } from 'node:test';

const PACKAGES = ['numpy', 'openpyxl'];
let unavailable: string | null | undefined;

/** Why the analysis tests cannot run on this machine, or null when they can. Probed once per process. */
function pythonUnavailable(): string | null {
  if (unavailable !== undefined) return unavailable;
  const probe = spawnSync('python3', ['-c', `import ${PACKAGES.join(', ')}`], { encoding: 'utf8' });
  if (probe.error) unavailable = `python3 is not installed (${probe.error.message}); the analysis tests need it with ${PACKAGES.join(' and ')}`;
  else if (probe.status !== 0) unavailable = `python3 cannot import ${PACKAGES.join(' and ')}: ${probe.stderr.trim().split('\n').at(-1)}`;
  else unavailable = null;
  return unavailable;
}

/** Runs one `analysis/test_*.py` module and fails the node test with its output when it fails. */
export function runAnalysisTests(t: TestContext, pattern: string) {
  const reason = pythonUnavailable();
  if (reason) return t.skip(reason);
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'analysis', '-p', pattern], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`);
}
