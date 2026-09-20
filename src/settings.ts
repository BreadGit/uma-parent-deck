import type { Focus } from './types.ts';
import { OUR_GRAND_CONCERT, SUPPORTED_SCENARIOS, WHITE_GENERATION_BANDS } from './model/rules.ts';

export interface Settings {
  goalTieTolerance: number;     // relative required-goal window in which preferred extras can decide
  // main page
  winThreshold: number;          // include a G1 when P(win) >= this
  focus: Focus;
  defaultLb: { R: number; SR: number; SSR: number }; // assumed limit break for cards without an inventory entry
  // advanced: independent-training rates the game does not publish
  affinity: number;              // individual affinity score assumed for every uma in the lineage; each spark procs at (1 + affinity/100)
  hintBase: number;              // per-card per-turn hint chance before Hint Frequency, manual-run measurement
  hintScale: number;             // multiplier applied to the hint model (independent training is unmeasured)
  hintTurnsShare: number;        // fraction of turns a card is on the trained facility (0.07 x 0.4 x 0.75 x 44 turns = 0.9 hints/run at 0% Hint Frequency, 1.3 at 40%)
  chainRatesSSR: number[];       // completion chance of chain event 1..3 for SSR
  chainRatesSR: number[];        // chain 1..2 for SR
  randomEventRate: number;       // chance a given random event fires during a run (cards with more than 2 random events are scaled so 2 fire on average)
  palChainRate: number;          // Pal card date chain completes (every date, incl. the finale skill)
  groupOutingRate: number;       // Group card member outing happens
  groupFinaleRate: number;       // Group card finale (gold skill) happens
  specialEventRate: number;      // assumed rate for Pal/Group unlock and New Year events
  scenarioPickRate: number;      // the scenario's linked-skill event fires and the prioritized option is taken
  scenarioSongsRate: number;     // the run learns enough songs for the scenario's gold completion skill
  concertGreatSuccessRate: number; // promotional and ordinary final concerts reach great success
  charStoryEventRate: number;    // the trainee's own story and choice events play during the run
  charOutingRate: number;        // one of the trainee's own outing events happens
  charUndecodedEventRate: number; // a skill GameTora lists for the trainee's events without a decoded event behind it (outfit-specific events)
  charConditionFallbackRate: number; // a secret-event condition the tool cannot evaluate (rival results, streaks) is met
  scenarioId: number;            // career scenario (3 = Our Grand Concert)
  goldRollStat: number;          // the stat of a card's type assumed when its final chain event rolls gold against white
  goldSparkRate: number;         // white spark chance at run end when the gold skill is owned
  circleSparkRate: number;       // ... when the ◎ form is owned
  whiteSparkRate: number;        // ... when the white skill is owned
  pinkInspirationRates: number[]; // per-event activation rates for 1/2/3-star pink sparks at zero affinity
  whiteStarsBelowB: number[];    // approximate 1/2/3-star distribution below rank B
  whiteStarsUE: number[];        // approximate 1/2/3-star distribution at UE and above
  whiteSparkInheritRates: number[]; // chance per inspiration event that a 1/2/3★ white spark in the lineage gives its hint, at 0 affinity
  lineageSparkMultiplier: number;   // spark generation chance multiplier per lineage occurrence of the same spark
  blueInspirationGainMean: number[]; // assumed mean stat roll when a 1/2/3★ blue spark procs at an inspiration event
  uniqueAprilBondRate: number;   // the April unique-skill level-up's chairperson bond check passes
  lossPenalty: number;           // total stat points lost per expected race loss
  skillScoreSd: number;          // uncertainty of the skill part of the rank score
  totalTurnsOverride: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  goalTieTolerance: 0.02,
  winThreshold: 0.8,
  focus: 'stamina',
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
  scenarioSongsRate: 0.9,
  concertGreatSuccessRate: 1,
  charStoryEventRate: 1,
  charOutingRate: 0.5,
  charUndecodedEventRate: 0.5,
  charConditionFallbackRate: 0.5,
  scenarioId: OUR_GRAND_CONCERT,
  goldRollStat: 700,
  goldSparkRate: 0.4,
  circleSparkRate: 0.25,
  whiteSparkRate: 0.2,
  pinkInspirationRates: [0.01, 0.03, 0.05],
  whiteStarsBelowB: [0.9, 0.1, 0],
  whiteStarsUE: [0.175, 0.7, 0.125],
  whiteSparkInheritRates: [0.03, 0.06, 0.09],
  lineageSparkMultiplier: 1.1,
  blueInspirationGainMean: [5.5, 8.5, 14.5],
  uniqueAprilBondRate: 0.5,
  lossPenalty: 0,
  skillScoreSd: 400,
  totalTurnsOverride: null,
};

/** Settings kept when the advanced panel is reset: the ones on the main page. */
export const MAIN_PAGE_SETTINGS = ['winThreshold', 'focus', 'defaultLb'] as const satisfies readonly (keyof Settings)[];

/** What each setting accepts. Values that fail the spec are rejected in favour of the current value. */
export type SettingSpec =
  | { kind: 'number'; min: number; max: number }
  | { kind: 'number-or-null'; min: number; max: number }
  | { kind: 'list'; length: number; min: number; max: number; sum?: number }
  | { kind: 'enum'; values: readonly (string | number)[] }   // the saved value must be one of these, same type included
  | { kind: 'boolean' }
  | { kind: 'lb-defaults' };
const rate: SettingSpec = { kind: 'number', min: 0, max: 1 };
const odds: SettingSpec = { kind: 'list', length: 3, min: 0, max: 1 };
const starDistribution: SettingSpec = { ...odds, sum: 1 };
/** Overall affinity thresholds the game shows: ◎ above 150, ○ above 50, △ otherwise; the overall value is the sum of the six individual scores. */
/** The race count the stat model was measured at; a total-turn override below it would scale card stats by zero or a negative number. */
export const RACES_REFERENCE = 28;
export const SETTING_SPEC: Record<keyof Settings, SettingSpec> = {
  winThreshold: rate,
  focus: { kind: 'enum', values: ['balanced', 'stamina', 'sprint'] },
  defaultLb: { kind: 'lb-defaults' },
  affinity: { kind: 'number', min: 0, max: 1000 },
  hintBase: rate,
  hintScale: { kind: 'number', min: 0, max: 10 },
  hintTurnsShare: rate,
  chainRatesSSR: odds,
  chainRatesSR: { kind: 'list', length: 2, min: 0, max: 1 },
  randomEventRate: rate,
  palChainRate: rate,
  groupOutingRate: rate,
  groupFinaleRate: rate,
  specialEventRate: rate,
  scenarioPickRate: rate,
  scenarioSongsRate: rate,
  concertGreatSuccessRate: rate,
  charStoryEventRate: rate,
  charOutingRate: rate,
  charUndecodedEventRate: rate,
  charConditionFallbackRate: rate,
  scenarioId: { kind: 'enum', values: SUPPORTED_SCENARIOS },
  goldRollStat: { kind: 'number', min: 0, max: 2500 },
  goalTieTolerance: rate,
  goldSparkRate: rate,
  circleSparkRate: rate,
  whiteSparkRate: rate,
  pinkInspirationRates: odds,
  whiteStarsBelowB: starDistribution,
  whiteStarsUE: starDistribution,
  whiteSparkInheritRates: odds,
  lineageSparkMultiplier: { kind: 'number', min: 0, max: 10 },
  blueInspirationGainMean: { kind: 'list', length: 3, min: 0, max: 30 },
  uniqueAprilBondRate: rate,
  lossPenalty: { kind: 'number', min: 0, max: 10000 },
  skillScoreSd: { kind: 'number', min: 0, max: 100000 },
  totalTurnsOverride: { kind: 'number-or-null', min: RACES_REFERENCE + 1, max: 200 },
};

const inRange = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** True when `value` satisfies the setting's spec. */
export function isValidSetting(key: keyof Settings, value: unknown): boolean {
  const spec = SETTING_SPEC[key];
  switch (spec.kind) {
    case 'number': return inRange(value, spec.min, spec.max);
    case 'number-or-null': return value === null || inRange(value, spec.min, spec.max);
    case 'list': return Array.isArray(value) && value.length === spec.length && value.every((v) => inRange(v, spec.min, spec.max))
      && (spec.sum === undefined || Math.abs(value.reduce((sum, p) => sum + p, 0) - spec.sum) < 1e-9);
    case 'enum': return (typeof value === 'string' || typeof value === 'number') && spec.values.includes(value);
    case 'boolean': return typeof value === 'boolean';
    case 'lb-defaults': return !!value && typeof value === 'object' && (['R', 'SR', 'SSR'] as const).every((r) => inRange((value as Record<string, unknown>)[r], 0, 4));
  }
}

/**
 * Parse a form value (text or checkbox state) for a setting. Returns undefined when it does not satisfy the spec,
 * so the caller keeps the current value.
 */
export function parseSetting(key: keyof Settings, raw: string | boolean): Settings[keyof Settings] | undefined {
  const spec = SETTING_SPEC[key];
  let value: unknown;
  switch (spec.kind) {
    case 'boolean': value = typeof raw === 'boolean' ? raw : raw === 'true'; break;
    case 'enum': value = spec.values.find((v) => String(v) === String(raw)); break; // the spec's own value, so a numeric enum parses to a number
    case 'number-or-null': value = raw === '' ? null : Number(raw); break;
    case 'number': value = Number(raw); break;
    case 'list': value = String(raw).split(/[,\s]+/).filter(Boolean).map(Number); break;
    case 'lb-defaults': return undefined; // not editable from a single field
  }
  return isValidSetting(key, value) ? (value as Settings[keyof Settings]) : undefined;
}

/** Merge saved settings over the defaults, dropping any saved value that fails its spec. */
export function sanitizeSettings(saved: Partial<Record<keyof Settings, unknown>>): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = saved[key];
    if (v !== undefined && isValidSetting(key, v)) (out as unknown as Record<string, unknown>)[key] = v;
  }
  return structuredClone(out);
}

/** User-facing note per advanced setting: what it does and where the default comes from. */
export const SETTING_HELP: Partial<Record<keyof Settings, string>> = {
  concertGreatSuccessRate: 'Assumed chance of great success for each promotional concert and an ordinary final concert. Default 1 assumes great success; independent-training rates are unmeasured. Fan rewards use mee1080/umasim manual JP observations, without a deck Fan Bonus on concerts. The 18-song setting approximates the chance of the special final concert (9,000 fans); the source also requires two new songs in the final period.',
  goalTieTolerance: 'How much required-goal chance you will trade for more preferred sparks on successful parents. A fraction, not percentage points: the default 0.02 allows a 2% relative difference. If the best chance found is 10%, decks at 9.8% or above can win on preferred extras. Zero allows only exact ties. Larger values give preferred sparks more influence. This is a preference, not a measure of model accuracy.',
  affinity: "Individual affinity score assumed for each of the six umas in the lineage (two parents, four grandparents). A blue or white spark procs at an inspiration event at its base chance times (1 + score/100), so 150 makes every blue spark proc. The game never shows individual scores, only their sum as ◎ (over 150), ○ (over 50) or △, and a ◎ made of six weak links procs far less than 150 each would; a compatibility calculator (GameTora, umaishow) gives the individual values. Default 150 is the optimistic assumption this tool has always used.",
  hintBase: 'Chance per turn that a card standing on a facility shows a hint, before Hint Frequency. Default 0.07 from a 1,024-turn manual-play sample (GameWith measured 6 to 9%). Nobody has measured hint pickup in independent training, so the whole hint model is an estimate.',
  hintScale: 'Multiplier on the whole hint model for independent training, where hint pickup is unmeasured. Default 0.75 so a 0% Hint Frequency card lands near 0.9 hints per run, in line with the 8 hints per deck fujikiseki measured in manual runs. Prioritized skills are assumed not to change which hints the run takes: that is documented for Auto-Train, not for independent training.',
  hintTurnsShare: 'Fraction of training turns a given card is on the facility being trained. Default 0.4 as a rough blend of the ~18% appearance rate with the AI favouring facilities where cards are. Unmeasured in independent training.',
  chainRatesSSR: 'Chance that an SSR card reaches chain event 1, 2 and 3 in an independent-training run. Each stage needs the one before it, so a skill offered by two stages is counted once. Defaults 0.69 / 0.36 / 0.12 summarize 102 Loopacord runs with one 23-race deck. Applying those rates to other decks and schedules is an assumption.',
  chainRatesSR: 'Chance that an SR card reaches chain event 1 and 2. Defaults 0.74 / 0.35 summarize 102 Loopacord runs with one 23-race deck. The second-stage rate averages two cards without a separate success roll. Applying those rates to other decks and schedules is an assumption.',
  randomEventRate: 'Chance a given random event fires during a run. Nobody has measured this, so 0.5 is a placeholder. Cards with more than two random events are scaled so two fire on average.',
  palChainRate: 'Chance a Pal card runs its whole date chain, which hands over the finale skill. Default 0.97 is an assumption; Loopacord recorded 102 completions in 102 runs with one 23-race deck.',
  groupOutingRate: 'Chance a Group card member outing happens. Default 0.9, assumed from the Pal chain behaviour; not measured.',
  groupFinaleRate: 'Chance the Group finale (the gold skill) happens. Default 0.85 is a guess; the finale needs every member outing first and nobody has counted it in independent training.',
  specialEventRate: 'Assumed chance of Pal/Group unlock and New Year events. Loopacord recorded the Pal dating-before-Classic event in 0 of 102 runs. Extending that observation to every event in this group is an assumption behind the default 0.',
  scenarioPickRate: 'Our Grand Concert has a Senior November live event with one option per linked character (Smart Falcon, Mihono Bourbon, Silence Suzuka, Agnes Tachyon) plus an unaffiliated one. Bringing that character or one of her cards upgrades her option to the gold skill. Loopacord logged the scenario pick at 100% in independent training, so the default is 1.',
  scenarioSongsRate: 'Chance the run learns 18 or more of the 22 lesson songs by late December of the Senior year, which turns the scenario completion reward into I Wanna Win with You instead of On the Way to Our Dream. Not measured; 0.9 is an assumption based on the 16-song November event firing in every logged run.',
  charStoryEventRate: "Chance a given one of the trainee's own no-choice or choice events plays during an independent-training run. GameTora's page groups fixed career events and random character events together and the tool cannot tell them apart, so this one rate covers both. Default 1 assumes every one plays. Unmeasured.",
  charOutingRate: "Chance a given one of the trainee's own outing events happens. It needs the run to take her out at the right time, which nobody has counted in independent training, so 0.5 is a placeholder.",
  charUndecodedEventRate: "Chance the run obtains a skill GameTora lists for the trainee's events when none of her decoded events (shared or outfit-specific) gives it, so the trigger is unknown; 0.5 is a placeholder.",
  charConditionFallbackRate: "Secret events fire once their conditions are met. Race wins and participation are scored from the agenda; conditions the tool cannot evaluate (beating a named rival, win streaks, strategy used) get this chance instead. 0.5 is a placeholder.",
  goldRollStat: "Some final chain events hand over the gold skill or its white form depending on the stat of the card's type when the event fires: 30% gold below 400, 60% from 400, 65% from 600, 75% from 700, 80% from 800, 90% from 1000 (mechanics document). The tool cannot predict the stat at that moment, so this is the value it assumes. Default 700.",
  goldSparkRate: 'Chance a skill you own as gold becomes a white spark at run end. Default 0.4 from the mechanics document.',
  circleSparkRate: 'Chance a skill you own in its ◎ form becomes a white spark at run end. Default 0.25 (Crazyfellow\'s guide: 25% against 20% for the ○ form).',
  whiteSparkRate: 'Chance a skill you own as white becomes a white spark at run end. Default 0.2 from the mechanics document.',
  pinkInspirationRates: 'Activation chance per inspiration event for 1/2/3-star pink sparks at zero individual affinity. Defaults 1/3/5% follow Crazyfellow and the inspected uma.moe model in docs/umamusume/refs/aptitude-inheritance.md. Hidden aptitude-point rolls below B remain unmeasured.',
  whiteStarsBelowB: 'Approximate 1/2/3-star white spark distribution below rank B. Defaults 90/10/0% come from Crazyfellow, as recorded in docs/umamusume/refs/hakuraku-spark-generation.md. Values must sum to one.',
  whiteStarsUE: 'Approximate 1/2/3-star white spark distribution at rank UE and above. Defaults 17.5/70/12.5% come from Crazyfellow, as recorded in docs/umamusume/refs/hakuraku-spark-generation.md. Values must sum to one.',
  whiteSparkInheritRates: 'Chance, per inspiration event, that a 1/2/3★ white spark already in the lineage gives you its hint, at 0 affinity; scaled by (1 + individual affinity/100) of the uma carrying it. Defaults 3/6/9% from Polaris\'s zero-affinity data via Crazyfellow\'s guide.',
  lineageSparkMultiplier: 'Each time the same white spark already appears in the lineage, the chance of generating it again is multiplied by this. Default 1.1 from uma.guide (20% → 22% → 24.2% …), supported by a 26.5-million-trainee dataset.',
  blueInspirationGainMean: 'Assumed average stat gain when a 1★ / 2★ / 3★ blue spark procs at an inspiration event. The game rolls a random value between 1 and 10, 1 and 16, and 1 and 28 respectively, and higher stars are said to roll near the top more often, but the distribution has not been measured. Defaults are the midpoints of those ranges; they are an assumption, not a game rule.',
  uniqueAprilBondRate: "The unique skill gains a level at three fan checks: Senior early February (60,000 fans), early April (70,000 fans and a green bond with the chairperson) and late December (120,000 fans); dirt-oriented trainees need 40,000 / 60,000 / 80,000. Fans include earlier calendar placing rewards with the deck Fan Bonus and earlier concerts. Finales arrive too late for these checks. The April bond check is not predicted, so this is the chance it passes. 0.5 is a placeholder.",
  lossPenalty: 'Total stat points removed per expected race loss, spread over the five stats. Default 0 because the effect of losses and conditions like Skin Outbreak has not been measured.',
  skillScoreSd: 'Uncertainty (standard deviation) of the skill part of the rank score. Default 400, roughly two skills either way.',
  totalTurnsOverride: `Total career turns used to scale card stats and SP by races run, as (T - races) / (T - ${RACES_REFERENCE}). Blank uses the value fitted from the 28-race and 23-race measurements. Values of ${RACES_REFERENCE} or less are rejected because they would divide by zero or flip the sign.`,
};

/** How the advanced settings panel lays a setting out: a number field, or a comma-separated list. */
export interface SettingField { key: keyof Settings; label: string; kind: 'number' | 'list'; step?: number }
export interface SettingGroup { title: string; fields: SettingField[] }
const n = (key: keyof Settings, label: string, step = 0.01): SettingField => ({ key, label, kind: 'number', step });
const list = (key: keyof Settings, label: string): SettingField => ({ key, label, kind: 'list' });
/**
 * The advanced settings, grouped by the part of the model they feed. Every setting that is not on the main page
 * appears here exactly once (state.test.ts checks), except scenarioId, which has one supported value.
 */
export const ADVANCED_SETTING_GROUPS: SettingGroup[] = [
  { title: 'Deck search', fields: [n('goalTieTolerance', 'Required-goal tie tolerance (relative)', 0.001)] },
  { title: 'Lineage', fields: [n('affinity', 'Affinity per uma', 1), list('whiteSparkInheritRates', 'White spark hint rate, 1/2/3★'), list('pinkInspirationRates', 'Pink activation rate, 1/2/3★'), n('lineageSparkMultiplier', 'Spark chance × per lineage copy'), list('blueInspirationGainMean', 'Blue spark mean roll, 1/2/3★')] },
  { title: 'Hints', fields: [n('hintBase', 'Hint chance per card-turn'), n('hintScale', 'Hint model scale'), n('hintTurnsShare', 'Turns a card is on its facility')] },
  { title: 'Card events', fields: [list('chainRatesSSR', 'SSR chain reaches 1/2/3'), list('chainRatesSR', 'SR chain reaches 1/2'), n('randomEventRate', 'Random event fires'), n('palChainRate', 'Pal date chain completes'), n('groupOutingRate', 'Group member outing happens'), n('groupFinaleRate', 'Group finale happens'), n('specialEventRate', 'Unlock and New Year events'), n('goldRollStat', 'Stat at the gold-or-white roll', 10)] },
  { title: 'Trainee events', fields: [n('charStoryEventRate', 'Story and choice events play'), n('charOutingRate', 'Outing event happens'), n('charUndecodedEventRate', 'Undecoded event skill obtained'), n('charConditionFallbackRate', 'Secret-event condition not scorable')] },
  { title: 'Scenario', fields: [n('scenarioPickRate', 'Skill event option taken'), n('scenarioSongsRate', '18 or more songs learned'), n('concertGreatSuccessRate', 'Concert great success'), n('uniqueAprilBondRate', 'April bond check passes')] },
  { title: 'Spark chance at run end', fields: [n('goldSparkRate', 'Gold skill owned'), n('circleSparkRate', '◎ form owned'), n('whiteSparkRate', 'White skill owned'), list('whiteStarsBelowB', 'White stars below B, 1/2/3★'), list('whiteStarsUE', 'White stars at UE+, 1/2/3★')] },
  { title: 'Rank score', fields: [n('skillScoreSd', 'Skill score spread', 10)] },
  { title: 'Stat model', fields: [n('lossPenalty', 'Stat lost per expected race loss', 1), n('totalTurnsOverride', 'Total career turns', 1)] },
];

/** Measured middle bands plus the tunable community estimates at either end. */
export function whiteGenerationBands(settings: Settings) {
  return [
    { min: 0, rates: settings.whiteStarsBelowB, approximate: true },
    ...WHITE_GENERATION_BANDS,
    { min: 28800, rates: settings.whiteStarsUE, approximate: true },
  ];
}
