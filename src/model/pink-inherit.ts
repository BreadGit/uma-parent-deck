import type { AptKey, Grade } from '../types.ts';
import { APTITUDE_KEYS, APTITUDE_LABELS, type PinkSpark } from './goal-input.ts';
import { PINK_SPARK_START_STARS, STARS_PER_SPARK_MAX } from './rules.ts';

const GRADES: Grade[] = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];
type Aptitudes = Record<AptKey, Grade>;
export interface PinkInference { lineage: (PinkSpark | null)[]; issues: string[] }

/**
 * Estimate the minimum stars behind raised starting grades. Several lineages can explain the same grade.
 * Keep manually entered sparks on their umas, then pack missing stars into as few inferred sparks as possible.
 * Unassigned slots remain unknown. If the six slots cannot fit all increases, do not infer a partial set.
 */
export function inferPinkLineage(base: Aptitudes, entered: Aptitudes, current: (PinkSpark | null)[]): PinkInference {
  const lineage = current.map((spark) => spark?.inferred ? null : spark);
  const issues: string[] = [];
  const wanted: PinkSpark[] = [];
  for (const key of APTITUDE_KEYS) {
    const steps = GRADES.indexOf(entered[key]) - GRADES.indexOf(base[key]);
    if (steps <= 0) continue;
    const minimum = PINK_SPARK_START_STARS[steps];
    if (minimum === undefined || entered[key] === 'S') {
      issues.push(`${APTITUDE_LABELS[key]} ${base[key]} to ${entered[key]} cannot be inferred from starting pink sparks. Starting inheritance raises at most four grades, up to A.`);
      continue;
    }
    const manualStars = lineage.reduce((total, spark) => total + (spark?.aptitude === key ? spark.stars : 0), 0);
    for (let missing = Math.max(0, minimum - manualStars); missing > 0;) {
      const stars = Math.min(STARS_PER_SPARK_MAX, missing);
      wanted.push({ aptitude: key, stars, inferred: true });
      missing -= stars;
    }
  }
  const slots = lineage.flatMap((spark, i) => spark === null ? [i] : []);
  if (wanted.length > slots.length) {
    issues.push(`The entered aptitude increases need ${wanted.length} additional pink sparks, but only ${slots.length} lineage slots are available. Check the grades or edit the manual pink sparks.`);
    return { lineage, issues };
  }
  // Preserve matching inferred sparks on their umas before filling remaining free slots.
  for (const i of [...slots]) {
    const old = current[i];
    const match = wanted.findIndex((spark) => spark.aptitude === old?.aptitude && spark.stars === old.stars);
    if (match < 0) continue;
    lineage[i] = wanted.splice(match, 1)[0]!;
    slots.splice(slots.indexOf(i), 1);
  }
  wanted.forEach((spark, i) => { lineage[slots[i]!] = spark; });
  return { lineage, issues };
}

/** Reject grades that exceed inheritance limits; allow lower grades to repair an older invalid setup. */
export function withPinkAptitude(base: Aptitudes, entered: Aptitudes, current: (PinkSpark | null)[], key: AptKey, grade: Grade): PinkInference | null {
  if (!GRADES.includes(grade) || grade === 'S') return null;
  const inferred = inferPinkLineage(base, { ...entered, [key]: grade }, current);
  const lowersGrade = GRADES.indexOf(grade) < GRADES.indexOf(entered[key]);
  return inferred.issues.length && !lowersGrade ? null : inferred;
}
