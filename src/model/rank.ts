import type { Character, Rank, Skill } from '../types.ts';

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

/** Approximate rating points for a skill by rarity; aptitude scaling is ignored. */
export function skillScore(skill: Skill, trainee: Character | null): number {
  void trainee;
  if (skill.rarity === 2) return 508;
  if (skill.rarity === 1) return skill.name.includes('◎') ? 262 : 217;
  if (skill.rarity >= 3 && skill.rarity <= 5) return 170 * 3; // unique at level 3
  return 200;
}

export function rankFor(score: number, ranks: Rank[]): Rank | undefined {
  return ranks.find((r) => score >= r.min && score <= r.max);
}
export function thresholdFor(name: string, ranks: Rank[]): number {
  return ranks.find((r) => r.name === name)?.min ?? 17500;
}
