// Game and tool constants that the model relies on. Each one names a rule of the game or a fixed choice of this tool;
// tunable estimates live in settings.ts instead.
import type { Grade } from '../types.ts';

// --- deck ---
export const DECK_SIZE = 6;
export const BORROWED_SLOTS = 1;             // one of the six must be a friend's card
export const BORROWED_LB = 4;                // a friend's card is assumed fully limit broken

// --- prioritized skills (independent training) ---
export const PRIORITIZED_SKILLS_MAX = 10;    // Cygames: "Up to ten skills can be prioritized"

// --- legacies (parents) ---
export const PARENTS = 2;
export const UMAS_PER_PARENT_SIDE = 3;       // the parent plus her two grandparents
export const STARS_PER_SPARK_MAX = 3;
export const MAX_PARENT_STARS = UMAS_PER_PARENT_SIDE * STARS_PER_SPARK_MAX;   // 9 blue stars per side
export const MAX_BLUE_STARS = PARENTS * MAX_PARENT_STARS;                     // 18 across the lineage
export const LINEAGE_MAX_PER_SIDE = UMAS_PER_PARENT_SIDE;                     // copies of one white spark per side
export const INSPIRATION_EVENTS = 2;         // early April of Classic and Senior year
/** Stat given by one blue spark at career start, by its stars. Fixed values; the legacy screen shows their sum per side. */
export const BLUE_SPARK_START_GAIN_BY_STARS = [0, 5, 12, 21];
/**
 * Stat a blue spark gives when it procs at an inspiration event, by stars: a random roll inside these bounds
 * (Crazyfellow's guide, corroborated by GameWith). The distribution is unknown; higher stars skew toward the top.
 * The expected value used by the tool is a setting (blueInspirationGainMean).
 */
export const BLUE_SPARK_INSPIRATION_RANGE_BY_STARS: [number, number][] = [[0, 0], [1, 10], [1, 16], [1, 28]];
/** Stat cap raised at career start by one blue spark, by stars (GameTora, Grand Live scenario page). */
export const BLUE_SPARK_START_UNCAP_BY_STARS = [0, 4, 9, 16];
/** Chance a blue spark procs at an inspiration event at 0 affinity, by stars; scaled by (1 + individual affinity/100). */
export const BLUE_SPARK_INSPIRATION_PROC_BY_STARS = [0, 0.7, 0.8, 0.9];
/** Overall affinity symbol thresholds: ◎ above AFFINITY_GREAT, ○ above AFFINITY_GOOD, △ otherwise. The overall value is the sum of the six individual scores. */
export const AFFINITY_GREAT = 150;
export const AFFINITY_GOOD = 50;

// --- scenario ---
export const OUR_GRAND_CONCERT = 3;
export const SUPPORTED_SCENARIOS = [OUR_GRAND_CONCERT];
/** Base stat caps per scenario (speed, stamina, power, guts, wit). Grand Live: GameTora scenario page. */
export const SCENARIO_STAT_CAPS: Record<number, number[]> = { [OUR_GRAND_CONCERT]: [1600, 1300, 1300, 1500, 1300] };
/** Our Grand Concert's completion reward: 18 or more songs give the gold skill, 17 or fewer the white one. */
export const SCENARIO_COMPLETION_SKILLS: Record<number, { gold: number; white: number; songsForGold: number }> = {
  [OUR_GRAND_CONCERT]: { gold: 210071 /* I Wanna Win with You */, white: 210072 /* On the Way to Our Dream */, songsForGold: 18 },
};

// --- training ---
/** Combined support bond a "per N total bond" unique effect (type 109) tops out at: 20% at 600 for Ikuno Dictus. */
export const UNIQUE_TOTAL_BOND_CAP = 600;
/** Highest facility level, where a "per facility level" unique effect (type 111) is at full strength. */
export const FACILITY_LEVEL_MAX = 5;

// --- career calendar ---
export const SLOT_COUNT = 72;                // 3 years x 12 months x 2 halves; turn 1 = Junior early January

// --- independent training race odds (Shoppo_ura's July 2026 data, linked from Crazyfellow's guide) ---
/** Win chance starts at 110% for A/A (Cygames) and loses these amounts per aptitude grade; S counts as A. Surface E is 50, distance E is 40. */
export const RACE_WIN_BASE = 1.1;
export const SURFACE_PENALTY: Record<Grade, number> = { S: 0, A: 0, B: 0.1, C: 0.2, D: 0.3, E: 0.5, F: 0.6, G: 0.9 };
export const DISTANCE_PENALTY: Record<Grade, number> = { S: 0, A: 0, B: 0.1, C: 0.2, D: 0.3, E: 0.4, F: 0.6, G: 0.9 };
/** Penalty by position in a streak of consecutive races (index = races in a row); the last entry applies to longer streaks. */
export const STREAK_PENALTY = [0, 0, 0, 0.05, 0.2, 0.3, 0.5];

// --- event outcomes ---
/** Chance a final chain event hands over the gold skill instead of its white form, by the stat of the card's type at the time (mechanics document). */
export const GOLD_ROLL_BY_STAT: [number, number][] = [[1000, 0.9], [800, 0.8], [700, 0.75], [600, 0.65], [400, 0.6], [0, 0.3]];

// --- rating ---
/** Rating points per unique-skill level: 120 for a 1★ or 2★ trainee, 170 from 3★ (UmaTools, GameWith). */
export const UNIQUE_SKILL_SCORE_PER_LEVEL = { lowStar: 120, highStar: 170 };
/** Initial unique level by trainee stars. At 3★ the upgraded unique starts at Lv1 (https://altema.jp/umamusume/koyuskill). */
export const UNIQUE_SKILL_START_LEVEL_BY_STARS = [0, 1, 2, 1, 2, 3];
export const UNIQUE_SKILL_LEVEL_MAX = 6;
/**
 * The three in-career unique-skill level-ups (URA rule, unchanged in Grand Live): fans needed before the slot (the
 * check fires at the start of that turn, so races in earlier slots count), with the lower thresholds for
 * dirt-oriented trainees; the April one also needs a green bond with the chairperson.
 */
export const UNIQUE_LEVEL_CHECKS: { slot: number; fans: number; dirtFans: number; bond: boolean }[] = [
  { slot: 50, fans: 60000, dirtFans: 40000, bond: false },   // Senior early February
  { slot: 54, fans: 70000, dirtFans: 60000, bond: true },    // Senior early April
  // Christmas precedes Arima Kinen. Playthrough with screenshots: https://kubinaga1230.hatenablog.com/entry/2023/01/09/174600
  { slot: 71, fans: 120000, dirtFans: 80000, bond: false },  // Senior late December, before that turn's race
];
/** Base rating of a skill by rarity, before the aptitude bucket: white, ◎ and gold (GameWith). */
export const SKILL_SCORE = { white: 217, circle: 262, gold: 508 };
/** Rating multiplier by the trainee's aptitude for a skill's condition (UmaTools buckets: S/A, B/C, D/E/F, G). */
export const APTITUDE_BUCKET_MULTIPLIER = { good: 1.1, average: 0.9, bad: 0.8, terrible: 0.7 };
