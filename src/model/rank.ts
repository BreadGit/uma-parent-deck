import type { Character, Data, Skill } from '../types.ts';
import type { Settings } from '../settings.ts';
import { phi } from './stats.ts';

// Per-point rating rate x10 for each 50-stat band from 1 to 1200 (GameWith / daftuyda), then per 10 above 1200.
const R1 = [5, 8, 10, 13, 16, 18, 21, 24, 26, 28, 29, 30, 31, 33, 34, 35, 39, 41, 42, 43, 52, 55, 66, 68, 68];
const R2_START = 79; // per-10 band rates above 1200 rise roughly linearly to ~182 at 2000
export function statScore(value: number): number {
  let total = 0;
  const v = Math.max(0, Math.floor(value));
  for (let band = 0; band < R1.length; band++) {
    const lo = band * 50, hi = Math.min(v, (band + 1) * 50);
    if (hi <= lo) break;
    total += (hi - lo) * R1[band]!;
  }
  if (v > 1200) {
    const bands = Math.ceil((v - 1200) / 10);
    for (let b = 0; b < bands; b++) {
      const rate = R2_START + Math.round((182 - R2_START) * (b / 79));
      const lo = 1200 + b * 10, hi = Math.min(v, lo + 10);
      total += (hi - lo) * rate;
    }
  }
  return Math.round(total / 10);
}

const UNIQUE_SKILL_SCORE = 170 * 3;      // the trainee's unique skill at level 3
const SS_FALLBACK_MIN = 17500;           // used only if ranks.json lacks an SS row

/** Approximate rating points for a skill by rarity; aptitude scaling is ignored. */
export function skillScore(skill: Skill): number {
  if (skill.rarity === 2) return 508;
  if (skill.rarity === 1) return skill.name.includes('◎') ? 262 : 217;
  if (skill.rarity >= 3 && skill.rarity <= 5) return UNIQUE_SKILL_SCORE;
  return 200;
}

export function thresholdFor(name: string, ranks: Data['ranks']): number {
  return ranks.find((r) => r.name === name)?.min ?? SS_FALLBACK_MIN;
}

export interface RankEstimate { score: number; sd: number; pSS: number; ssMin: number }

/**
 * Rank score of a predicted run: stat rating over the final stats, plus skills bought with the estimated SP,
 * the trainee's unique skill and a share of her innate skills (settings.innateSkillBuyShare). The spread comes from the per-stat run-to-run
 * spread pushed through the rating curve, plus the skill uncertainty setting.
 */
export function rankEstimate(finalMean: number[], sd: number[], sp: number, trainee: Character | null, data: Data, settings: Settings): RankEstimate {
  const statPts = finalMean.reduce((a, v) => a + statScore(v), 0);
  const innate = trainee ? trainee.innateSkills.reduce((a, id) => { const sk = data.skillById.get(id); return a + (sk ? skillScore(sk) * settings.innateSkillBuyShare : 0); }, 0) : 0;
  const skillPts = sp * settings.skillScorePerSp + (trainee ? UNIQUE_SKILL_SCORE : 0) + innate;
  const score = statPts + skillPts;
  const dScore = finalMean.map((v, i) => (statScore(v + 10) - statScore(v - 10)) / 20 * (sd[i] ?? 0));
  const sdScore = Math.sqrt(dScore.reduce((a, d) => a + d * d, 0) + Math.pow(settings.skillScoreSd, 2));
  const ssMin = thresholdFor('SS', data.ranks);
  return { score, sd: sdScore, pSS: 1 - phi((ssMin - score) / Math.max(1, sdScore)), ssMin };
}
