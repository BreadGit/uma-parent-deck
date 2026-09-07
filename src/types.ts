export type Stat = 'speed' | 'stamina' | 'power' | 'guts' | 'wit';
export const STATS: Stat[] = ['speed', 'stamina', 'power', 'guts', 'wit'];
export type CardType = Stat | 'pal' | 'group';
export type Rarity = 'R' | 'SR' | 'SSR';
export type Focus = 'balanced' | 'stamina' | 'sprint';

export interface Reward { t: string; v?: string; d?: number | { d: number; v: string }[] }
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
  /** The card's unique effect from its unlock level: basic effect types (below 100) are folded into effectsByLb as `u<type>`; compound types (100 and above) carry a condition the tool does not evaluate and stay here with their full payload. */
  unique: { level: number; effects: UniqueEffect[]; text?: string } | null;
  hintSkills: number[];
  eventSkills: number[];
  hintOthers: { type: number; value: number }[];
  chainEvents: CardEvent[];
  randomEvents: CardEvent[];
  recreationEvents: CardEvent[]; // Pal dates or Group member outings, last one is the finale
  specialEvents: CardEvent[];    // Pal/Group extra events (unlock, New Year), not reachable in independent training
}

export interface Skill {
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

export type AptKey = 'turf' | 'dirt' | 'sprint' | 'mile' | 'medium' | 'long' | 'front' | 'pace' | 'late' | 'end';
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export interface Character {
  cardId: number;
  charId: number;
  name: string;
  title: string;
  rarity: number;
  releaseEn: string;
  aptitudes: Record<AptKey, Grade>;
  growth: number[];
  baseStats: number[];       // at the card's base star rarity
  twoStarStats: number[] | null;    // exact tables where GameTora lists them (a 1★ card has 2★ to 5★, a 2★ card 3★ to 5★, a 3★ card 4★ and 5★)
  threeStarStats: number[] | null;
  fourStarStats: number[] | null;
  fiveStarStats: number[] | null;
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
  fit: { n: number; rmse: number; r2: number; floorSd: number };
  races: { reference: number; totalTurns: number; spRatio23: number };
  sp: { base: number; wit: number; friend: number; skillPointBonus: number };
  eventBase: Record<string, number[]>;
  eventSp: Record<string, number>;
  growthEffect: number;
  sigma: number[];
  focus: Record<Focus, number[]>;
  observed: { cardId: number; lb: number; source: string; runs: number; wellTested: boolean; stats: number[]; sp: number }[];
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

/** Inventory: card id -> limit break 0..4, or null for "not owned". Absent = owned at the rarity's default LB. */
export type Inventory = Record<string, number | null>;
