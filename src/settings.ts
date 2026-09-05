import type { Focus } from './types.ts';

export interface Settings {
  // main page
  winThreshold: number;          // include a G1 when P(win) >= this
  focus: Focus;
  showUnowned: boolean;          // show cards marked "not owned" in the ranking (dimmed)
  defaultLb: { R: number; SR: number; SSR: number }; // assumed limit break for cards without an inventory entry
  affinity: number;              // legacy affinity score (double circle > 150) used for inspiration proc odds
  // advanced
  hintBase: number;              // per-card per-turn hint chance before Hint Frequency, manual-run measurement
  hintScale: number;             // multiplier applied to the hint model (independent training is unmeasured)
  hintTurnsShare: number;        // fraction of turns a card is on the trained facility (0.07 x 0.4 x 0.75 x 44 turns = 0.9 hints/run at 0% Hint Frequency, 1.3 at 40%)
  chainRatesSSR: number[];       // completion chance of chain event 1..3 for SSR
  chainRatesSR: number[];        // chain 1..2 for SR
  randomEventRate: number;       // chance a given random event fires during a run (cards with more than 2 random events are scaled so 2 fire on average)
  palChainRate: number;          // Pal card date chain completes (every date, incl. the finale skill)
  groupOutingRate: number;       // Group card member outing happens
  groupFinaleRate: number;       // Group card finale (gold skill) happens
  specialEventRate: number;      // Pal/Group unlock and New Year events (never seen in independent training)
  bigRewardRate: number;         // when an outcome is split into small/big rewards, chance of the big one
  goldSparkRate: number;         // white spark chance at run end when the gold skill is owned
  whiteSparkRate: number;        // ... when the white skill is owned
  ssStarOdds: number[];          // white spark 1/2/3 star odds at SS+
  belowSsStarOdds: number[];
  lossPenalty: number;           // total stat points lost per expected race loss
  skillScorePerSp: number;       // rank points bought per skill point (a white is 217 pts for ~150 SP after hint discounts)
  skillScoreSd: number;          // uncertainty of the skill part of the rank score
  totalTurnsOverride: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  winThreshold: 0.8,
  focus: 'stamina',
  showUnowned: true,
  defaultLb: { R: 4, SR: 4, SSR: 4 },
  affinity: 150,
  hintBase: 0.07,
  hintScale: 0.75,
  hintTurnsShare: 0.4,
  chainRatesSSR: [0.69, 0.36, 0.12],
  chainRatesSR: [0.74, 0.35],
  randomEventRate: 0.5,
  palChainRate: 0.97,
  groupOutingRate: 0.9,
  groupFinaleRate: 0.85,
  specialEventRate: 0,
  bigRewardRate: 0.3,
  goldSparkRate: 0.4,
  whiteSparkRate: 0.2,
  ssStarOdds: [0.2, 0.7, 0.1],
  belowSsStarOdds: [0.45, 0.5, 0.05],
  lossPenalty: 0,
  skillScorePerSp: 1.4,
  skillScoreSd: 400,
  totalTurnsOverride: null,
};

const KEY = 'uma-parent-deck.settings';
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings> & { version?: number };
      const merged = { ...DEFAULT_SETTINGS, ...saved };
      if ((saved.version ?? 1) < 2) merged.defaultLb = { ...merged.defaultLb, SSR: 4 }; // default SSR LB changed from 0 to 4
      if ((saved.version ?? 1) < 3) merged.showUnowned = true; // now shown by default
      return merged;
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}
export function saveSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify({ ...s, version: 3 }));
}
