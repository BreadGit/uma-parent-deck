import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { migrate } from '../src/state.ts';
import { APTITUDE_KEYS, emptyPinkLineage, type PinkSpark } from '../src/model/goal-input.ts';
import { inferPinkLineage } from '../src/model/pink-inherit.ts';
import type { Aptitudes } from '../src/model/races.ts';

const base = Object.fromEntries(APTITUDE_KEYS.map((key) => [key, 'G'])) as Aptitudes;
const inferred = (aptitude: PinkSpark['aptitude'], stars: number): PinkSpark => ({ aptitude, stars, inferred: true });
const filled = (lineage: (PinkSpark | null)[]) => lineage.filter((spark) => spark !== null);

test('starting grade increases require 1, 4, 7, or 10 stars and never more than four grades', () => {
  for (const [grade, stars] of [['F', [1]], ['E', [3, 1]], ['D', [3, 3, 1]], ['C', [3, 3, 3, 1]]] as const) {
    const result = inferPinkLineage(base, { ...base, end: grade }, emptyPinkLineage());
    assert.deepEqual(filled(result.lineage), stars.map((n) => inferred('end', n)));
    assert.deepEqual(result.issues, []);
    assert.equal(result.lineage.length, 6);
  }
  for (const grade of ['B', 'A', 'S'] as const) {
    const result = inferPinkLineage(base, { ...base, end: grade }, emptyPinkLineage());
    assert.deepEqual(filled(result.lineage), []);
    assert.match(result.issues.join(' '), /at most four grades, up to A/);
  }
  const capped = inferPinkLineage({ ...base, end: 'C' }, { ...base, end: 'A' }, emptyPinkLineage());
  assert.deepEqual(filled(capped.lineage), [inferred('end', 3), inferred('end', 1)]);
});

test('manual stars count toward a raised grade and stay on their entered umas', () => {
  const current = emptyPinkLineage();
  current[3] = { aptitude: 'end', stars: 2 };
  current[5] = { aptitude: 'turf', stars: 3 };
  const before = structuredClone(current);
  const result = inferPinkLineage(base, { ...base, end: 'E' }, current);
  assert.deepEqual(result.lineage[3], current[3]);
  assert.deepEqual(result.lineage[5], current[5]);
  assert.deepEqual(result.lineage[0], inferred('end', 2));
  assert.deepEqual(current, before);
  assert.deepEqual(result.issues, []);
  const lowered = inferPinkLineage(base, base, result.lineage);
  assert.deepEqual(lowered.lineage, current, 'lowering to base clears only inferred sparks');
});

test('inferred sparks update and stay stable when other aptitudes change', () => {
  const grades = { ...base, end: 'E' as const };
  const first = inferPinkLineage(base, grades, emptyPinkLineage());
  assert.deepEqual(inferPinkLineage(base, grades, first.lineage), first);
  const second = inferPinkLineage(base, { ...grades, mile: 'F' }, first.lineage);
  assert.deepEqual(second.lineage.slice(0, 2), first.lineage.slice(0, 2));
  assert.deepEqual(second.lineage[2], inferred('mile', 1));
  const fewer = inferPinkLineage(base, { ...grades, end: 'F' }, second.lineage);
  assert.deepEqual(filled(fewer.lineage), [inferred('end', 1)]);
  const belowBase = inferPinkLineage({ ...base, end: 'B' }, { ...base, end: 'C' }, fewer.lineage);
  assert.deepEqual(filled(belowBase.lineage), []);
});

test('inference shares six slots across aptitudes without replacing manual sparks or creating a partial set', () => {
  const full = inferPinkLineage(base, { ...base, end: 'D', mile: 'D' }, emptyPinkLineage());
  assert.equal(filled(full.lineage).length, 6);
  assert.deepEqual(full.issues, []);
  const over = inferPinkLineage(base, { ...base, end: 'C', mile: 'C' }, full.lineage);
  assert.deepEqual(over.lineage, emptyPinkLineage());
  assert.match(over.issues.join(' '), /8 additional pink sparks.*6 lineage slots/);
  const manual = Array.from({ length: 6 }, () => ({ aptitude: 'turf' as const, stars: 3 }));
  const blocked = inferPinkLineage(base, { ...base, end: 'F' }, manual);
  assert.deepEqual(blocked.lineage, manual);
  assert.match(blocked.issues.join(' '), /1 additional pink sparks.*0 lineage slots/);
});

test('old manual ancestry stays manual and inferred provenance survives saved-state migration', () => {
  const data = loadData();
  const lineage = [inferred('end', 3), { aptitude: 'mile', stars: 2 }, null, null, null, null];
  const saved = migrate({ current: { version: 10, run: { pinkLineage: lineage } } }, data);
  assert.equal(saved.version, 11);
  assert.deepEqual(saved.run.pinkLineage, lineage);
  assert.deepEqual(migrate({ current: saved }, data), saved);
});
