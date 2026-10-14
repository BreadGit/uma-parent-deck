import { isGold, isNormal, perStat, STAT_INDEXES, type AptKey, type Character, type Data, type Grade, type PerStat, type Skill } from '../types.ts';
import type { Settings } from '../settings.ts';
import type { Aptitudes } from './races.ts';
import { APTITUDE_BUCKET_MULTIPLIER, MAX_STAT_VALUE, SKILL_SCORE, UNIQUE_LEVEL_CHECKS, UNIQUE_SKILL_LEVEL_MAX, UNIQUE_SKILL_SCORE_PER_LEVEL, UNIQUE_SKILL_START_LEVEL_BY_STARS } from './rules.ts';
import type { StatMass } from './stat-outcomes.ts';
import { isCircle } from './sparks.ts';

/**
 * Rating points per stat value, the game's table as reproduced by UmaTools (umakonga formula): per-point rates in
 * 50-point blocks up to 1200, 10-point blocks to 2000 and 25-point blocks to 2500, accumulated then divided by ten.
 */
const STAT_SCORES: number[] = (() => {
  const R1 = [5, 8, 10, 13, 16, 18, 21, 24, 26, 28, 29, 30, 31, 33, 34, 35, 39, 41, 42, 43, 52, 55, 66, 68, 68];
  const R2 = [79, 80, 81, 83, 84, 85, 86, 88, 89, 90, 92, 93, 94, 96, 97, 98, 100, 101, 102, 103, 105, 106, 107, 109, 110, 111, 113, 114, 115, 117, 118, 119, 121, 122, 123, 124, 126, 127, 128,
    130, 131, 132, 134, 135, 136, 138, 139, 140, 141, 143, 144, 145, 147, 148, 149, 151, 152, 153, 155, 156, 157, 159, 160, 161, 162, 164, 165, 166, 168, 169, 170, 172, 173, 174, 176, 177, 178, 179, 181, 182, 182];
  const sc = [0];
  let raw = 0, idx = 0;
  for (let c = 1; c <= 1200; c++) {
    if (c <= 49) idx = 0; else if (c <= 99) idx = 1; else if (c % 50 === 0) idx++;
    raw += R1[idx]!;
    sc[c] = Math.round(raw / 10);
  }
  raw = 38413; idx = 0;
  for (let c = 1201; c <= 2000; c++) {
    if (c <= 1209) idx = 0; else if (c <= 1219) idx = 1; else if (c % 10 === 0) idx++;
    raw += R2[idx]!;
    sc[c] = Math.round(raw / 10);
  }
  raw = 142796; idx = 0;
  let rate = 183;
  for (let c = 2001; c <= MAX_STAT_VALUE; c++) {
    if (idx >= 25) { rate++; idx = 0; }
    raw += rate; idx++;
    sc[c] = Math.round(raw / 10);
  }
  return sc;
})();
export function statScore(value: number): number {
  const v = Math.max(0, Math.min(MAX_STAT_VALUE, Math.round(value)));
  return STAT_SCORES[v] ?? 0;
}

/** Skill tags that condition a skill on an aptitude, as GameTora tags them. */
const TAG_APTITUDE: Record<string, AptKey> = { sho: 'sprint', mil: 'mile', med: 'medium', lng: 'long', dir: 'dirt', tur: 'turf', run: 'front', ldr: 'pace', btw: 'late', cha: 'end' };
const APT_GROUP: Record<AptKey, string> = { turf: 'surface', dirt: 'surface', sprint: 'distance', mile: 'distance', medium: 'distance', long: 'distance', front: 'style', pace: 'style', late: 'style', end: 'style' };
type Bucket = keyof typeof APTITUDE_BUCKET_MULTIPLIER;
const bucketOf = (g: Grade | undefined): Bucket => (g === 'S' || g === 'A' ? 'good' : g === 'B' || g === 'C' ? 'average' : g === 'D' || g === 'E' || g === 'F' ? 'bad' : 'terrible');

/**
 * Rating multiplier for a skill from the trainee's aptitude for its conditions: the best bucket within each
 * aptitude group the skill mentions, multiplied across groups (UmaTools). An unconditioned skill scores its base.
 */
export function aptitudeMultiplier(skill: Skill, apt: Aptitudes | null): number {
  if (!apt) return 1;
  const best = new Map<string, number>();
  for (const tag of skill.tags) {
    const key = TAG_APTITUDE[tag];
    if (!key) continue;
    const m = APTITUDE_BUCKET_MULTIPLIER[bucketOf(apt[key])];
    const group = APT_GROUP[key];
    best.set(group, Math.max(best.get(group) ?? 0, m));
  }
  let f = 1;
  for (const m of best.values()) f *= m;
  return f;
}

/** Individual evaluation points, with an explicit rarity fallback for unverified skills. Unique skills score by level elsewhere. */
export function skillScore(skill: Skill, apt: Aptitudes | null = null): number {
  const base = skill.rating ?? (isGold(skill) ? SKILL_SCORE.gold : isCircle(skill) ? SKILL_SCORE.circle : isNormal(skill) ? SKILL_SCORE.white : 200);
  return Math.round(base * aptitudeMultiplier(skill, apt));
}

export function uniqueSkillScore(stars: number, level: number): number {
  return (stars <= 2 ? UNIQUE_SKILL_SCORE_PER_LEVEL.lowStar : UNIQUE_SKILL_SCORE_PER_LEVEL.highStar) * level;
}

/** A trainee whose own dirt aptitude beats her turf aptitude uses the lower fan thresholds (Haru Urara, Smart Falcon). Pass the character's table, not the run's overrides. */
const dirtOriented = (apt: Aptitudes) => bucketOf(apt.dirt) === 'good' && bucketOf(apt.turf) !== 'good';
/**
 * Expected unique-skill level at run end: the initial level for the trainee's stars, plus one for each fan check
 * the agenda's expected fans reach (the April check also needs the chairperson bond, given as a setting).
 */
export function uniqueSkillLevel(stars: number, apt: Aptitudes, fansBefore: (slot: number) => number, settings: Settings): number {
  let level = UNIQUE_SKILL_START_LEVEL_BY_STARS[stars] ?? 1;
  for (const c of UNIQUE_LEVEL_CHECKS) {
    const met = fansBefore(c.slot) >= (dirtOriented(apt) ? c.dirtFans : c.fans) ? 1 : 0;
    level += met * (c.bond ? settings.uniqueAprilBondRate : 1);
  }
  return Math.min(UNIQUE_SKILL_LEVEL_MAX, level);
}

const SS_FALLBACK_MIN = 17500;           // used only if ranks.json lacks an SS row
export function ssThreshold(ranks: Data['ranks']): number {
  return ranks.find((r) => r.name === 'SS')?.min ?? SS_FALLBACK_MIN;
}

export interface RankMoments { score: number; sd: number; ssMin: number; uniqueLevel: number; uniquePts: number; statPts: number; skillPts: number }

export interface RankEstimate extends RankMoments { pSS: number }

/** Skill points in the rank score: estimated SP spending plus the trainee's unique skill at its level. */
export function skillPointsOf(purchasedScore: number, trainee: Character | null, stars: number, uniqueLevel: number): number {
  return purchasedScore + (trainee ? uniqueSkillScore(stars, uniqueLevel) : 0);
}

/** Rank moments from displayed stats and an estimated skill-spending rating. */
export function rankMoments(masses: PerStat<readonly StatMass[]>, purchasedScore: number, trainee: Character | null, stars: number, uniqueLevel: number, data: Data, settings: Settings): RankMoments {
  const ratingMeans = perStat((_, i) => masses[i].reduce((sum, x) => sum + statScore(x.value) * x.probability, 0));
  const statPts = ratingMeans.reduce((sum, v) => sum + v, 0);
  let statVariance = 0;
  for (const i of STAT_INDEXES) statVariance += masses[i].reduce((v, x) => v + (statScore(x.value) - ratingMeans[i]) ** 2 * x.probability, 0);
  const uniquePts = trainee ? uniqueSkillScore(stars, uniqueLevel) : 0;
  const skillPts = skillPointsOf(purchasedScore, trainee, stars, uniqueLevel);
  const score = statPts + skillPts;
  const sdScore = Math.sqrt(statVariance + settings.skillScoreSd ** 2);
  const ssMin = ssThreshold(data.ranks);
  return { score, sd: sdScore, ssMin, uniqueLevel, uniquePts, statPts, skillPts };
}
