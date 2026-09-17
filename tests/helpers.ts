import assert from 'node:assert/strict';

/**
 * A lookup a test's premise depends on, such as a card, character or skill found in the vendored data. Fails with what was
 * expected rather than with a TypeError further down when a data refresh removes it.
 */
export function must<T>(value: T | null | undefined, what: string): T {
  assert.ok(value != null, `expected ${what}`);
  return value;
}
