import assert from 'node:assert/strict';

/**
 * A lookup a test's premise depends on, such as a card, character or skill found in the vendored data. Fails at the lookup
 * rather than with a TypeError further down when a data refresh removes it. Describe `what` when the failing line alone
 * would not say which value was missing, such as a lookup inside a helper or loop.
 */
export function must<T>(value: T | null | undefined, what = 'the looked-up value'): T {
  assert.ok(value != null, `expected ${what}`);
  return value;
}
