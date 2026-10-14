export type Stat = 'speed' | 'stamina' | 'power' | 'guts' | 'wit';
export const STATS = ['speed', 'stamina', 'power', 'guts', 'wit'] as const;
/** One value per stat in STATS order. Its fixed length lets a StatIndex read it without a check. */
export type PerStat<T> = [T, T, T, T, T];
export type StatValues = PerStat<number>;
export type StatIndex = 0 | 1 | 2 | 3 | 4;
/** Every stat index in STATS order, for a loop that needs the index but builds no vector. */
export const STAT_INDEXES = [0, 1, 2, 3, 4] as const satisfies readonly StatIndex[];
/** Build a per-stat vector in the one order used by the model, the data and the forms. */
export function perStat<T>(value: (stat: Stat, index: StatIndex) => T): PerStat<T> {
  return [value(STATS[0], 0), value(STATS[1], 1), value(STATS[2], 2), value(STATS[3], 3), value(STATS[4], 4)];
}
export type CardType = Stat | 'pal' | 'group';
export type Rarity = 'R' | 'SR' | 'SSR';
export const RARITIES = ['R', 'SR', 'SSR'] as const satisfies readonly Rarity[];
export type Focus = 'balanced' | 'stamina' | 'sprint';

export interface Reward { t: string; v?: string; d?: number | { d: number; v: string }[]; r?: boolean }
export interface EventChoice { outcomes: Reward[][] }
export interface CardEvent { kind: 'chain' | 'random' | 'recreation' | 'special'; index: number; name?: string; choices: EventChoice[] }

/** A race the trainee must run or win: the calendar race id, in a given career year or any year. */
export interface RaceRef { raceId: number; year?: number }
/** What a secret event needs before it fires. Evaluated against the agenda; 'unknown' keeps GameTora's raw condition. */
export type EventCondition =
  | { type: 'win'; races: RaceRef[] }
  | { type: 'win_any'; races: RaceRef[] }
  | { type: 'win_all'; races: RaceRef[] }
  | { type: 'win_n_of'; n: number; races: RaceRef[] }
  | { type: 'participate'; race: RaceRef }
  | { type: 'do_not_participate'; race: RaceRef }
  | { type: 'date' }
  | { type: 'unknown'; raw: unknown[] };
/**
 * A trainee's own event. Story events play in every career, choice events offer two or three options, outings
 * happen when the run takes her out, and secret events fire once their race conditions are met.
 */
export interface TraineeEvent { kind: 'story' | 'choice' | 'outing' | 'secret'; index: number; name?: string; choices: EventChoice[]; conditions?: EventCondition[] }

export interface UniqueEffect { type: number; value: number; value_1?: number; value_2?: number; value_3?: number; value_4?: number }
export interface Card {
  id: number;
  urlName: string; // GameTora page slug
  charId: number;
  charName: string;
  title: string;
  name: string;
  rarity: Rarity;
  type: CardType;
  releaseEn: string;
  obtained: string | null;
  effects: Record<string, number[]>;
  effectsByLb: Record<string, number>[];
  /**
   * The card's unique effect: unlocked at `level`, which the card reaches at limit break `fromLb` (5 = never). Basic
   * effect types (below 100) are folded into effectsByLb as `u<type>`; compound types (100 and above) carry a condition
   * and stay here with their full payload and GameTora's rendered text, for uniqueExtras() to evaluate at run time.
   */
  unique: { level: number; fromLb: number; effects: UniqueEffect[]; text?: string } | null;
  hintSkills: number[];
  eventSkills: number[];
  hintOthers: { type: number; value: number }[];
  hintOthersSource?: unknown[];
  chainEvents: CardEvent[];
  randomEvents: CardEvent[];
  recreationEvents: CardEvent[]; // Pal dates or Group member outings, last one is the finale
  specialEvents: CardEvent[];    // Pal/Group extra events (unlock, New Year), not reachable in independent training
}

export interface Skill {
  rating?: number; // individually sourced base evaluation points; absent when unverified
  id: number;
  name: string;
  altName: string | null;
  nameJp: string | null;
  rarity: number; // 1 white, 2 gold, 3-5 unique, 6 evolved
  cost: number | null;
  iconId: number | null;
  versions: number[];
  tags: string[];
  unreleasedEn: boolean;
  hintCards: number[];
  eventCards: number[];
  innateChars: number[];
  eventChars: number[];
  desc: string;
}
/** A normal-rarity skill: a white, ○, ◎ or × form, or a negative event skill. */
export const isNormal = (s: Pick<Skill, 'rarity'>) => s.rarity === 1;
export const isGold = (s: Pick<Skill, 'rarity'>) => s.rarity === 2;
/** A normal or gold skill, as opposed to a unique or evolved one. Skill families and white sparks hold only these. */
export const isNormalOrGold = (s: Pick<Skill, 'rarity'>) => isNormal(s) || isGold(s);

export type AptKey = 'turf' | 'dirt' | 'sprint' | 'mile' | 'medium' | 'long' | 'front' | 'pace' | 'late' | 'end';
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export const APTITUDE_KEYS: AptKey[] = ['turf', 'dirt', 'sprint', 'mile', 'medium', 'long', 'front', 'pace', 'late', 'end'];
/** Ascending aptitude strength. Starting inheritance stops at A. */
export const APT_GRADES: Grade[] = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];
/** The message of a thrown value, which need not be an Error. */
export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
/** A JSON object as opposed to an array, null or a primitive. */
export const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/**
 * A game ID (card, character, skill, race): a positive safe integer. Saved state, inventory files and share codes all
 * use this rule. An ID the installed data does not know is still valid and is kept.
 */
export const isGameId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
/** The valid game IDs of a saved list, first occurrence first; anything else in it is dropped. */
export const gameIds = (v: unknown): number[] => Array.isArray(v) ? [...new Set(v.filter(isGameId))] : [];
export const isGameIdKey = (key: string) => /^[1-9]\d*$/.test(key) && isGameId(Number(key));
/**
 * A race calendar ID, the key of a schedule override. It is not a game ID: a later year's running of the same calendar
 * entry carries a suffix, so "79_2" is the Senior Japan Cup.
 */
export const isCalendarId = (key: string) => /^[1-9]\d*(?:_[1-9]\d*)?$/.test(key);

export interface Character {
  cardId: number;
  charId: number;
  name: string;
  title: string;
  rarity: number;
  releaseEn: string;
  aptitudes: Record<AptKey, Grade>;
  growth: StatValues;
  baseStats: StatValues;       // at the card's base star rarity
  twoStarStats: StatValues | null;    // exact tables where GameTora lists them (a 1★ card has 2★ to 5★, a 2★ card 3★ to 5★, a 3★ card 4★ and 5★)
  threeStarStats: StatValues | null;
  fourStarStats: StatValues | null;
  fiveStarStats: StatValues | null;
  innateSkills: number[];
  awakeningSkills: number[];
  eventSkills: number[];         // every skill her events can give (GameTora's flat list); the events below carry the structure
  uniqueSkills: number[];
  events: TraineeEvent[];
  goals: CareerGoal[];
}
export interface GoalRace { raceId: number; name: string; distance: number; surface: 'turf' | 'dirt'; grade: number; fansNeeded: number; fansGain: number }
/** slot 0 = Junior early January; `required` is the placement the objective needs (1 = win, 5 = top five), 0 for participation only. */
export interface CareerGoal { slot: number; races: GoalRace[]; required: number }

export interface Race {
  calendarId: string;
  raceInstanceId: number;
  raceId: number;
  name: string;
  distance: number;
  category: 'sprint' | 'mile' | 'medium' | 'long';
  surface: 'turf' | 'dirt';
  year: number;
  month: number;
  half: number;
  fansNeeded: number;
  fansGain: number;
  unreleasedEn: boolean;
  goal?: boolean;       // a career objective of the trainee: run regardless
  autoWin?: boolean;    // an objective the run would end on losing: independent training always wins it
}

export interface ScenarioEventChoice { linkedCharId: number | null; goldSkill?: number; whiteSkill?: number; skill?: number }
export interface ScenarioEvent { scenarioId: number; eventId: number; strId: string; choices: ScenarioEventChoice[] }

export interface Rank { id: number; name: string; min: number; max: number }

export interface StatModel {
  version: number;
  stats: Stat[];
  secondary: Record<string, Stat[]>;
  floor: number;
  roleConstants: Record<string, number>;
  slopes: { fr: number; mo: number; te: number; sb: number };
  effectSlopes?: Record<number, number>;
  evaluation?: Partial<Record<'stats' | 'sp', {
    inputs: { effectId: number; status: 'retained' | 'tested-not-retained' | 'insufficient-data' }[];
  }>>;
  fit: { n: number; rmse: number; r2: number; floorSd: number };
  races: { reference: number; totalTurns: number; spRatio23: number };
  sp: {
    base: number; wit: number; friend: number; skillPointBonus: number;
    effectSlopes?: Record<number, number>;
    fittedTypes?: CardType[];
    fallback?: { base: number; wit: number; friend: number; skillPointBonus: number };
  };
  eventBase: Record<string, StatValues>;
  eventSp: Record<string, number>;
  growthEffect: number;
  uniqueRampShare: number;   // share of the run a ramping compound unique effect is assumed at full strength (fitted)
  sigma: StatValues;
  focus: Record<Focus, StatValues>;
  observed: { cardId: number; lb: number; source: string; sourceRef?: string; raceReference?: number; runs: number; wellTested: boolean; stats: StatValues; sp: number }[];
}

export interface Data {
  cards: Card[];
  skills: Skill[];
  characters: Character[];
  races: Race[];
  ranks: Rank[];
  scenarioEvents: ScenarioEvent[];
  model: StatModel;
  cardById: Map<number, Card>;
  skillById: Map<number, Skill>;
  charByCardId: Map<number, Character>;
  charById: Map<number, Character>; // first outfit of each character
}

/** Stored inventory: card id -> limit break 0..4, or null for "not owned". Absent entries are not owned. */
export type Inventory = Record<string, number | null>;
