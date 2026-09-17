import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { migrate, STATE_VERSION } from '../src/state.ts';
import { APTITUDE_KEYS } from '../src/types.ts';
import { emptyPinkLineage, type PinkSpark } from '../src/model/goal-input.ts';
import { pinkAptitudeGrades, startingAptitudes, withPinkLineage, withPinkAptitude } from '../src/model/pink-inherit.ts';
import type { Aptitudes } from '../src/model/races.ts';

const base = Object.fromEntries(APTITUDE_KEYS.map((key) => [key, 'G'])) as Aptitudes;
const inferred = (aptitude: PinkSpark['aptitude'], stars: number): PinkSpark => ({ aptitude, stars, inferred: true });
const filled = (lineage: (PinkSpark | null)[]) => lineage.filter((spark) => spark !== null);

test('editing Dirt preserves a manually entered Mile spark and derives Mile from lineage', () => {
  const native = { ...base, mile: 'C' as const };
  const current = emptyPinkLineage();
  current[4] = { aptitude: 'mile', stars: 2 };
  const result = withPinkAptitude(native, native, current, 'dirt', 'F')!;
  assert.deepEqual(result.lineage[4], current[4]);
  assert.equal(result.aptitudes.mile, 'B');
  assert.equal(result.adjustsOthers, false);
});

test('an unrelated no-op does not collapse six manual End sparks to an entered B', () => {
  const native = { ...base, end: 'C' as const, turf: 'A' as const };
  const current = Array.from({ length: 6 }, () => ({ aptitude: 'end' as const, stars: 3 }));
  const result = withPinkAptitude(native, { ...native, end: 'B' }, current, 'turf', 'A')!;
  assert.deepEqual(result.lineage, current);
  assert.equal(result.aptitudes.end, 'A');
  assert.equal(result.adjustsOthers, false);
});

test('manual lineage edits derive grades immediately and removing the last spark restores base', () => {
  const native = { ...base, mile: 'C' as const };
  const current = emptyPinkLineage();
  const next = [...current]; next[4] = { aptitude: 'mile', stars: 2 };
  const grades = withPinkLineage(native, {}, current, next);
  assert.equal(grades.mile, 'B');
  assert.equal(withPinkLineage(native, grades, next, current).mile, 'C');
  assert.equal(startingAptitudes({ ...native, mile: 'B' }, {}, next).mile, 'A', 'switching trainee uses retained manual ancestry');
});

test('starting grade choices stay at base or higher and cap at four increases and A', () => {
  assert.deepEqual(pinkAptitudeGrades('A'), ['A']);
  assert.deepEqual(pinkAptitudeGrades('C'), ['A', 'B', 'C']);
  assert.deepEqual(pinkAptitudeGrades('G'), ['C', 'D', 'E', 'F', 'G']);
  assert.equal(withPinkAptitude(base, base, emptyPinkLineage(), 'end', 'B')!.aptitudes.end, 'B');
  assert.equal(withPinkAptitude(base, base, emptyPinkLineage(), 'end', 'S'), null);
  const native = { ...base, end: 'C' as const };
  assert.equal(withPinkAptitude(native, native, emptyPinkLineage(), 'end', 'D')!.aptitudes.end, 'D');
  assert.equal(startingAptitudes(native, { end: 'G' }, emptyPinkLineage()).end, 'G');
});

test('empty ancestry needs minimum totals of 1, 4, 7, and 10 stars for starting increases', () => {
  for (const [grade, stars] of [['F', [1]], ['E', [3, 1]], ['D', [3, 3, 1]], ['C', [3, 3, 3, 1]]] as const) {
    const result = withPinkAptitude(base, base, emptyPinkLineage(), 'end', grade)!;
    assert.deepEqual(filled(result.lineage), stars.map((n) => inferred('end', n)));
    assert.equal(result.aptitudes.end, grade);
    assert.equal(result.lineage.length, 6);
  }
});

test('an existing manual spark contributes to an increase and stays on its uma', () => {
  const native = { ...base, turf: 'A' as const };
  const current = emptyPinkLineage();
  current[3] = { aptitude: 'end', stars: 2 };
  current[5] = { aptitude: 'turf', stars: 3 };
  const before = structuredClone(current);
  const result = withPinkAptitude(native, { ...native, end: 'F' }, current, 'end', 'E')!;
  assert.deepEqual(result.lineage[3], current[3]);
  assert.deepEqual(result.lineage[5], current[5]);
  assert.deepEqual(result.lineage[0], inferred('end', 2));
  assert.equal(result.adjustsOthers, false);
  assert.deepEqual(current, before);
  assert.deepEqual(withPinkAptitude(native, result.aptitudes, result.lineage, 'end', 'E')!.lineage, result.lineage);
  const lowered = withPinkAptitude(native, result.aptitudes, result.lineage, 'end', 'G')!;
  assert.equal(lowered.lineage.filter((spark) => spark?.aptitude === 'end').length, 0);
  assert.deepEqual(lowered.lineage[5], current[5]);
});

test('dimmed choices reclaim the weakest other sparks and honor the selected grade', () => {
  const first = withPinkAptitude(base, base, emptyPinkLineage(), 'mile', 'D')!;
  const full = withPinkAptitude(base, first.aptitudes, first.lineage, 'end', 'D')!;
  const before = structuredClone(full.lineage);
  const changed = withPinkAptitude(base, full.aptitudes, full.lineage, 'end', 'C')!;
  assert.equal(changed.adjustsOthers, true);
  assert.equal(changed.aptitudes.end, 'C');
  assert.equal(changed.aptitudes.mile, 'E');
  assert.equal(filled(changed.lineage).length, 6);
  assert.deepEqual(full.lineage, before);
  const lower = withPinkAptitude(base, full.aptitudes, full.lineage, 'mile', 'E')!;
  assert.equal(lower.adjustsOthers, false);
  assert.equal(filled(lower.lineage).length, 5);
  const higher = withPinkAptitude(base, lower.aptitudes, lower.lineage, 'end', 'C')!;
  assert.equal(higher.adjustsOthers, false);
  assert.equal(filled(higher.lineage).length, 6);
});

test('manual sparks can be reassigned while affected aptitudes never fall below base', () => {
  const native = { ...base, turf: 'A' as const, end: 'C' as const };
  const manual = Array.from({ length: 6 }, () => ({ aptitude: 'turf' as const, stars: 3 }));
  const changed = withPinkAptitude(native, native, manual, 'end', 'A')!;
  assert.equal(changed.adjustsOthers, true);
  assert.equal(changed.aptitudes.turf, 'A');
  assert.equal(changed.aptitudes.end, 'A');
  assert.deepEqual(changed.lineage.slice(0, 4), manual.slice(0, 4));
  assert.equal(changed.lineage.filter((spark) => spark?.aptitude === 'end').length, 2);
  const tiny = Array.from({ length: 6 }, () => ({ aptitude: 'end' as const, stars: 1 }));
  const packed = withPinkAptitude(base, { ...base, end: 'E' }, tiny, 'end', 'C')!;
  assert.equal(packed.aptitudes.end, 'C');
  assert.equal(packed.lineage.length, 6);
  assert.ok(filled(packed.lineage).length <= 6, 'six slots at most');
});

test('editing a grade preserves unrelated grade-only planning overrides', () => {
  const old = { ...base, end: 'A' as const, mile: 'A' as const };
  const repaired = withPinkAptitude(base, old, emptyPinkLineage(), 'end', 'C')!;
  assert.equal(repaired.aptitudes.end, 'C');
  assert.equal(repaired.aptitudes.mile, 'A');
  assert.equal(filled(repaired.lineage).length, 4);
});

test('saved planning grades and inferred provenance survive reloads', () => {
  const data = loadData();
  const lineage = [inferred('end', 3), { aptitude: 'mile', stars: 2 }, null, null, null, null];
  const saved = migrate({ current: { version: 11, run: { traineeCardId: 100101, pinkLineage: lineage, aptOverrides: { turf: 'G', end: 'G', dirt: 'A' } } } }, data);
  assert.equal(saved.version, STATE_VERSION);
  assert.deepEqual(saved.run.aptOverrides, { turf: 'G', end: 'G', dirt: 'A' });
  assert.deepEqual(saved.run.pinkLineage, lineage);
  assert.deepEqual(migrate({ current: saved }, data), saved);
});
