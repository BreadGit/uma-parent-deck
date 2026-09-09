import type { AptKey, Grade } from '../types.ts';
import { APTITUDE_KEYS, type PinkSpark } from './goal-input.ts';
import { PINK_SPARK_START_STARS, STARS_PER_SPARK_MAX } from './rules.ts';

const GRADES: Grade[] = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];
type Aptitudes = Record<AptKey, Grade>;
export interface PinkInference { lineage: (PinkSpark | null)[]; issues: string[] }

/** Starting inheritance can add at most four grades, ending at A. */
export function pinkAptitudeGrades(base: Grade): Grade[] {
  const from = Math.min(GRADES.indexOf(base), GRADES.indexOf('A'));
  return GRADES.slice(from, Math.min(GRADES.indexOf('A'), from + PINK_SPARK_START_STARS.length - 1) + 1).reverse();
}

export function normalizeStartingAptitudes(base: Aptitudes, entered: Partial<Aptitudes>): Aptitudes {
  return Object.fromEntries(APTITUDE_KEYS.map((key) => {
    const range = pinkAptitudeGrades(base[key]);
    const index = GRADES.indexOf(entered[key] ?? base[key]);
    const low = GRADES.indexOf(range[range.length - 1]!);
    const high = GRADES.indexOf(range[0]!);
    return [key, GRADES[Math.max(low, Math.min(high, index))]!];
  })) as Aptitudes;
}

const starsFor = (lineage: (PinkSpark | null)[], key: AptKey) => lineage.reduce((n, spark) => n + (spark?.aptitude === key ? spark.stars : 0), 0);
const gradeFromStars = (base: Grade, stars: number): Grade => {
  const steps = PINK_SPARK_START_STARS.filter((minimum) => stars >= minimum).length - 1;
  return GRADES[Math.min(GRADES.indexOf('A'), GRADES.indexOf(base) + steps)]!;
};

/** Allocate one aptitude's sparks; reclaim the weakest other sparks only after using free slots. */
function allocateGrade(base: Grade, current: (PinkSpark | null)[], key: AptKey, grade: Grade) {
  if (gradeFromStars(base, starsFor(current, key)) === grade) return { lineage: [...current], reclaimed: false };
  const steps = GRADES.indexOf(grade) - GRADES.indexOf(base);
  const minimum = PINK_SPARK_START_STARS[steps]!;
  const existing = current.filter((spark) => spark?.aptitude === key).map((spark) => spark!.stars);
  const total = existing.reduce((n, stars) => n + stars, 0);
  const pack = (total: number) => {
    const packed: number[] = [];
    for (let n = total; n > 0;) {
      const stars = Math.min(STARS_PER_SPARK_MAX, n);
      packed.push(stars); n -= stars;
    }
    return packed;
  };
  let wanted = total < minimum ? [...existing, ...pack(minimum - total)] : pack(minimum);
  if (wanted.length > current.length) wanted = pack(minimum);
  const slots: number[] = [];
  const lineage = current.map((spark, i) => {
    if (spark?.aptitude !== key) return spark;
    const match = wanted.indexOf(spark.stars);
    if (match >= 0) { wanted.splice(match, 1); return spark; }
    slots.push(i); return null;
  });
  slots.push(...current.flatMap((spark, i) => spark === null ? [i] : []));
  const others = lineage.map((spark, i) => ({ spark, i })).filter((x) => x.spark && x.spark.aptitude !== key)
    .sort((a, b) => a.spark!.stars - b.spark!.stars || b.i - a.i);
  let reclaimed = false;
  for (const { i } of others) {
    if (slots.length >= wanted.length) break;
    lineage[i] = null; slots.push(i); reclaimed = true;
  }
  wanted.forEach((stars, i) => { lineage[slots[i]!] = { aptitude: key, stars, inferred: true }; });
  return { lineage, reclaimed };
}

export interface PinkAptitudeChange extends PinkInference { aptitudes: Aptitudes; adjustsOthers: boolean }

/** Honor the chosen grade, then derive every starting grade from the rebalanced six-spark lineage. */
export function withPinkAptitude(base: Aptitudes, entered: Aptitudes, current: (PinkSpark | null)[], key: AptKey, grade: Grade): PinkAptitudeChange | null {
  if (!pinkAptitudeGrades(base[key]).includes(grade)) return null;
  const previous = normalizeStartingAptitudes(base, entered);
  let lineage = [...current];
  // Fill older grade-only inputs first. The explicitly selected aptitude gets the final allocation.
  for (const other of APTITUDE_KEYS) {
    if (other !== key) lineage = allocateGrade(base[other], lineage, other, previous[other]).lineage;
  }
  const selected = allocateGrade(base[key], lineage, key, grade);
  lineage = selected.lineage;
  const aptitudes = Object.fromEntries(APTITUDE_KEYS.map((other) => [other, gradeFromStars(base[other], starsFor(lineage, other))])) as Aptitudes;
  const changedOtherSpark = current.some((spark, i) => spark && spark.aptitude !== key && (lineage[i]?.aptitude !== spark.aptitude || lineage[i]?.stars !== spark.stars));
  return { lineage, aptitudes, issues: [], adjustsOthers: selected.reclaimed || changedOtherSpark || APTITUDE_KEYS.some((other) => other !== key && aptitudes[other] !== previous[other]) };
}
