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
  scenarioPickRate: number;      // the scenario's linked-skill event fires and the prioritized option is taken
  scenarioId: number;            // career scenario (3 = Our Grand Concert)
  bigRewardRate: number;         // when an outcome is split into small/big rewards, chance of the big one
  goldSparkRate: number;         // white spark chance at run end when the gold skill is owned
  whiteSparkRate: number;        // ... when the white skill is owned
  whiteSparkInheritRates: number[]; // chance per inspiration event that a 1/2/3★ white spark in the lineage gives its hint, at 0 affinity
  lineageSparkMultiplier: number;   // spark generation chance multiplier per lineage occurrence of the same spark
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
  scenarioPickRate: 1,
  scenarioId: 3,
  bigRewardRate: 0.3,
  goldSparkRate: 0.4,
  whiteSparkRate: 0.2,
  whiteSparkInheritRates: [0.03, 0.06, 0.09],
  lineageSparkMultiplier: 1.1,
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

/** User-facing note per advanced setting: what it does and where the default comes from. */
export const SETTING_HELP: Partial<Record<keyof Settings, string>> = {
  affinity: 'Legacy affinity score with the parents. Inspiration procs scale by (1 + affinity/100), so 150 (double circle) makes blue sparks proc every time. Default 150 because that is the usual target when picking parents.',
  hintBase: 'Chance per turn that a card standing on a facility shows a hint, before Hint Frequency. Default 0.07 from a 1,024-turn manual-play sample (GameWith measured 6 to 9%).',
  hintScale: 'Multiplier on the whole hint model for independent training, where hint pickup is unmeasured. Default 0.75 so a 0% Hint Frequency card lands near 0.9 hints per run, in line with the 8 hints per deck fujikiseki measured in manual runs.',
  hintTurnsShare: 'Fraction of training turns a given card is on the facility being trained. Default 0.4 as a rough blend of the ~18% appearance rate with the AI favouring facilities where cards are.',
  chainRatesSSR: 'Chance that an SSR card completes chain event 1, 2 and 3 in an independent-training run. Defaults 0.69 / 0.36 / 0.12 from Loopacord counts.',
  chainRatesSR: 'Chance that an SR card completes chain event 1 and 2. Defaults 0.74 / 0.35 from Loopacord counts.',
  randomEventRate: 'Chance a given random event fires during a run. Nobody has measured this, so 0.5 is a placeholder. Cards with more than two random events are scaled so two fire on average.',
  palChainRate: 'Chance a Pal card runs its whole date chain, which hands over the finale skill. Default 0.97: Loopacord saw 100% and See Ya Later! shows up in nearly every logged run.',
  groupOutingRate: 'Chance a Group card member outing happens. Default 0.9, assumed from the Pal chain behaviour; not measured.',
  groupFinaleRate: 'Chance the Group finale (the gold skill) happens. Default 0.85 is a guess; the finale needs every member outing first and nobody has counted it in independent training.',
  specialEventRate: 'Chance of the Pal/Group unlock and New Year events. Default 0 because Loopacord never saw the New Year event in independent training.',
  scenarioPickRate: 'Our Grand Concert has a Senior November live event with one option per linked character (Smart Falcon, Mihono Bourbon, Silence Suzuka, Agnes Tachyon) plus an unaffiliated one. Bringing that character or one of her cards upgrades her option to the gold skill. Loopacord logged the scenario pick at 100% in independent training, so the default is 1.',
  bigRewardRate: 'When an event outcome splits into a small and a big reward, the chance of the big one. Default 0.3, your estimate.',
  goldSparkRate: 'Chance a skill you own as gold becomes a white spark at run end. Default 0.4 from the mechanics document.',
  whiteSparkRate: 'Chance a skill you own as white becomes a white spark at run end. Default 0.2 from the mechanics document.',
  whiteSparkInheritRates: 'Chance, per inspiration event, that a 1/2/3★ white spark already in the lineage gives you its hint, at 0 affinity; scaled by (1 + affinity/100). Defaults 3/6/9% from the mechanics document.',
  lineageSparkMultiplier: 'Each time the same white spark already appears in the lineage, the chance of generating it again is multiplied by this. Default 1.1 from uma.guide (20% → 22% → 24.2% …).',
  ssStarOdds: 'White spark 1★ / 2★ / 3★ odds when the run ends SS or better. Defaults 0.2 / 0.7 / 0.1 from the mechanics document and uma.guide.',
  belowSsStarOdds: 'White spark star odds below SS. Defaults 0.45 / 0.5 / 0.05 from uma.guide.',
  lossPenalty: 'Total stat points removed per expected race loss, spread over the five stats. Default 0 because the effect of losses and conditions like Skin Outbreak has not been measured.',
  skillScorePerSp: 'Rank-score points bought per skill point at the end of the run. Default 1.4: a white skill is 217 points for about 150 SP after hint discounts.',
  skillScoreSd: 'Uncertainty (standard deviation) of the skill part of the rank score. Default 400, roughly two skills either way.',
  totalTurnsOverride: 'Total career turns used to scale card stats by races run. Blank uses the fitted 71.7 from decks run at 28 and 23 races.',
};
