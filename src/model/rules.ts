// Game and tool constants that the model relies on. Each one names a rule of the game or a fixed choice of this tool;
// tunable estimates live in settings.ts instead.

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
/** Stat given by one blue spark at career start, by its stars; the same again each time it procs at an inspiration event. */
export const BLUE_SPARK_GAIN_BY_STARS = [0, 5, 12, 21];
/** Chance a blue spark procs at an inspiration event at 0 affinity, by stars; scaled by (1 + affinity/100). */
export const BLUE_SPARK_INSPIRATION_PROC_BY_STARS = [0, 0.7, 0.8, 0.9];

// --- career calendar ---
export const SLOT_COUNT = 72;                // 3 years x 12 months x 2 halves; turn 1 = Junior early January
