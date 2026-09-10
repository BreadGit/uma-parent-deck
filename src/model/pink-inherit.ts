import { APTITUDE_KEYS, APT_GRADES as GRADES, type AptKey, type Grade } from '../types.ts';
import type { PinkSpark } from './goal-input.ts';
import { PINK_SPARK_START_STARS, STARS_PER_SPARK_MAX } from './rules.ts';

type Aptitudes = Record<AptKey, Grade>;

/** Starting inheritance can add at most four grades, ending at A. */
export function pinkAptitudeGrades(base: Grade): Grade[] {
  const from = Math.min(GRADES.indexOf(base), GRADES.indexOf('A'));
  return GRADES.slice(from, Math.min(GRADES.indexOf('A'), from + PINK_SPARK_START_STARS.length - 1) + 1).reverse();
}

/** Known sparks determine starting grades. Out-of-range overrides remain explicit planning inputs. */
export function startingAptitudes(base: Aptitudes, entered: Partial<Aptitudes>, lineage: (PinkSpark | null)[]): Aptitudes {
  return Object.fromEntries(APTITUDE_KEYS.map((key) => {
    const grade = entered[key] ?? base[key];
    const stars = starsFor(lineage, key);
    return [key, stars && pinkAptitudeGrades(base[key]).includes(grade) ? gradeFromStars(base[key], stars) : grade];
  })) as Aptitudes;
}

/** Refresh grades for edited or reclaimed sparks, including an aptitude whose last spark was removed. */
export function withPinkLineage(base: Aptitudes, entered: Partial<Aptitudes>, current: (PinkSpark | null)[], lineage: (PinkSpark | null)[]): Aptitudes {
  const retained = { ...entered };
  for (const key of APTITUDE_KEYS) {
    if (starsFor(current, key) !== starsFor(lineage, key) && pinkAptitudeGrades(base[key]).includes(retained[key] ?? base[key])) delete retained[key];
  }
  return startingAptitudes(base, retained, lineage);
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

export interface PinkAptitudeChange { lineage: (PinkSpark | null)[]; aptitudes: Aptitudes; adjustsOthers: boolean }

/** Honor the chosen grade, then derive every starting grade from the rebalanced six-spark lineage. */
export function withPinkAptitude(base: Aptitudes, entered: Aptitudes, current: (PinkSpark | null)[], key: AptKey, grade: Grade): PinkAptitudeChange | null {
  if (grade === 'S' || !GRADES.includes(grade)) return null;
  if (!pinkAptitudeGrades(base[key]).includes(grade)) {
    return { lineage: [...current], aptitudes: { ...startingAptitudes(base, entered, current), [key]: grade }, adjustsOthers: false };
  }
  const selected = allocateGrade(base[key], current, key, grade);
  const aptitudes = withPinkLineage(base, entered, current, selected.lineage);
  aptitudes[key] = grade;
  return { lineage: selected.lineage, aptitudes, adjustsOthers: selected.reclaimed };
}
