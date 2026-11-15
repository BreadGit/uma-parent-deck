import { isPlainObject, type EventCondition, type RaceRef } from '../src/types.ts';
import { OUR_GRAND_CONCERT, SLOTS_PER_YEAR } from '../src/model/rules.ts';
import { raceWinKey } from '../src/model/races.ts';

// Global currently uses the content period after NAR and before the second anniversary.
// Later snapshots describe the older rewards still applicable to Global.
const PERIODS = ['pre_2021_12_27', 'pre_first_anni', 'pre_nar', 'pre_2nd_anni', 'pre_3rd_anni', 'pre_2024_wedding', 'pre_tracen_ken'];
const GLOBAL_INDEX = PERIODS.indexOf('pre_2nd_anni');

/** Source-backed release canaries make the assumed Global period an explicit update boundary. */
export function validateGlobalPeriod(scenarios: { id: number; start_en?: number }[], skills: { id: number; unreleased?: string[] }[]): void {
  const concert = scenarios.find((scenario) => scenario.id === OUR_GRAND_CONCERT);
  const masters = scenarios.find((scenario) => scenario.id === 5);
  const straightCourse = skills.find((skill) => skill.id === 202992);
  if (!concert?.start_en || !masters || masters.start_en || !straightCourse?.unreleased?.includes('en')) {
    throw new Error('Global content-period canary changed. Review event history selection against the updated scenario/skill releases before importing.');
  }
}

function periodIndex(period: unknown): number {
  const index = PERIODS.indexOf(String(period));
  if (index < 0) throw new Error(`Unknown event history period ${String(period)}; select its Global applicability before importing.`);
  return index;
}

/** Select the earliest still-applicable historical snapshot, rather than current Japanese rewards. */
export function eventOnGlobal<T extends Record<string, unknown>>(event: T): Omit<T, 'history'> | null {
  if (event.did_not_exist && periodIndex(event.did_not_exist) >= GLOBAL_INDEX) return null;
  const history = event.history ?? [];
  if (!Array.isArray(history)) throw new Error('Event history must be an array.');
  for (const entry of history) if (!isPlainObject(entry) || typeof entry.period !== 'string' || !isPlainObject(entry.data)) throw new Error('Event history entry must contain a period and event data.');
  const applicable = history.filter((entry) => periodIndex(entry.period) >= GLOBAL_INDEX)
    .sort((a, b) => periodIndex(a.period) - periodIndex(b.period));
  return applicable[0]?.data ?? event;
}

export function staticEventOnGlobal(entry: unknown[]): unknown[] {
  const histories = entry.slice(3).filter((tag): tag is [number, [string, unknown[]][]] => Array.isArray(tag) && tag[0] === 9);
  const applicable = histories.flatMap((tag) => tag[1]).filter(([period]) => periodIndex(period) >= GLOBAL_INDEX)
    .sort(([a], [b]) => periodIndex(a) - periodIndex(b));
  return applicable[0]?.[1] ?? entry;
}

/** Reward markers that separate an event option's alternative outcomes. */
export const isOutcomeBreak = (reward: { t: string }) => reward.t === 'di' || reward.t === 'di_s';

export function normalizeReward(reward: unknown): { t: string; v?: unknown; d?: unknown; r?: boolean } {
  if (!isPlainObject(reward)) throw new Error('Event reward must be an object.');
  if (typeof reward.t !== 'string' || Object.keys(reward).some((key) => !['t', 'v', 'd', 'r'].includes(key))) throw new Error('Event reward has an unsupported structure.');
  if (reward.r != null && typeof reward.r !== 'boolean') throw new Error('Event reward r flag must be boolean.');
  const skillId = (value: unknown) => {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) throw new Error(`Event reward has invalid skill ID ${String(value)}.`);
    return numeric;
  };
  let data = reward.d;
  if (reward.t === 'sk') data = skillId(data);
  if (reward.t === 'sr') {
    if (!Array.isArray(data)) throw new Error('Random skill reward must contain an array.');
    data = data.map((entry) => {
      if (!isPlainObject(entry)) throw new Error('Random skill reward entry must be an object.');
      return { ...entry, d: skillId(entry.d) };
    });
  }
  return { t: reward.t, ...(reward.v != null ? { v: reward.v } : {}), ...(data != null ? { d: data } : {}), ...(reward.r != null ? { r: reward.r } : {}) };
}

/** Static event reward IDs start this far above their index in the reward dictionary. */
export const REWARD_ID_OFFSET = 36;
/** Missing references are data errors. */
export function decodeRewards(dictionary: unknown[], rewardId: number): ReturnType<typeof normalizeReward>[] {
  const reward = dictionary[rewardId - REWARD_ID_OFFSET];
  if (!Number.isInteger(rewardId) || !Array.isArray(reward) || reward.length > 4) {
    throw new Error(`Event reward ${rewardId} has no valid dictionary entry at index ${rewardId - REWARD_ID_OFFSET}.`);
  }
  const [t, v, d, flag] = reward;
  if (t == null && v == null && d == null && Array.isArray(flag)) return flag.map(normalizeReward);
  return [normalizeReward({ t, ...(v != null ? { v } : {}), ...(d != null ? { d } : {}), ...(flag != null ? { r: flag } : {}) })];
}

/** A character page's shared event groups in import order. `race` holds the events that play after a race; each outfit's own events are under `version`. */
export const CHAR_PAGE_GROUPS = ['nochoice', 'wchoice', 'outings', 'race'] as const;

/** GameTora's grade code of a G1 race, the only grade on the tool's calendar. */
export const G1_GRADE = 100;

/** Sets of races behind GameTora's crown shorthands, by Global race name and career year. */
const CROWNS: Record<string, [string, number][]> = {
  triple_crown: [['Satsuki Sho', 2], ['Tokyo Yushun (Japanese Derby)', 2], ['Kikuka Sho', 2]],
  triple_tiara: [['Oka Sho', 2], ['Japanese Oaks', 2], ['Shuka Sho', 2]],
  spring_triple_crown: [['Osaka Hai', 3], ['Tenno Sho (Spring)', 3], ['Takarazuka Kinen', 3]],
  autumn_triple_crown_senior: [['Tenno Sho (Autumn)', 3], ['Japan Cup', 3], ['Arima Kinen', 3]],
};

/** What a condition's race references resolve against: raw race instances, calendar G1 race ids by name, and the trainee's goal races as race win keys. */
export interface ConditionRaces { instances: Map<number, Record<string, any>>; raceIdByName: Map<string, number>; goalRaces: Set<string> }

/** Race win keys of a trainee's goals, for one year and for any year. */
export function goalRaceKeys(goals: { slot: number; races: { raceId: number }[] }[]): Set<string> {
  return new Set(goals.flatMap((g) => g.races.flatMap((r) => [raceWinKey(r.raceId, Math.floor(g.slot / SLOTS_PER_YEAR) + 1), raceWinKey(r.raceId)])));
}

/**
 * A page condition -> a form the model can evaluate against the agenda. Race references are instance ids with an
 * optional "|year"; they become { raceId, year? } via the raw races table. Anything else is kept verbatim as
 * { type: 'unknown', raw } so the model can apply its fallback rate.
 */
export function normalizeCondition(cond: unknown[], races: ConditionRaces): EventCondition {
  // Only the trainee's goal races and calendar G1s can be on the agenda; a condition naming another race stays unknown.
  // A G1 held at another venue runs as the calendar race of its name unless it is the trainee's goal.
  const ref = (v: unknown): RaceRef | null => {
    const [id, y] = String(v).split('|');
    const race = races.instances.get(Number(id));
    if (!race) return null;
    const year = y ? Number(y) : undefined;
    const at = (raceId: number): RaceRef => year != null ? { raceId, year } : { raceId };
    if (races.goalRaces.has(raceWinKey(race.race_id, year))) return at(race.race_id);
    const calendarId = race.grade === G1_GRADE ? races.raceIdByName.get(race.name_en) : undefined;
    return calendarId == null ? null : at(calendarId);
  };
  const refs = (list: unknown[]) => { const out = list.map(ref); return out.every((r) => r !== null) ? out as RaceRef[] : null; };
  const unknown: EventCondition = { type: 'unknown', raw: cond };
  const [type, ...args] = cond;
  switch (type) {
    case 'win': case 'obj_win': case 'pick_and_win': { const r = ref(args[0]); return r ? { type: 'win', races: [r] } : unknown; }
    // The model has only win chances, so a finish in a range that includes first place is scored as a win.
    case 'race_place': case 'obj_race_place': {
      const r = Array.isArray(args[1]) && args[1][0] === 1 ? ref(args[0]) : null;
      return r ? { type: 'win', races: [r] } : unknown;
    }
    case 'participate': case 'obj_participate': { const r = ref(args[0]); return r ? { type: 'participate', race: r } : unknown; }
    case 'do_not_participate': { const r = ref(args[0]); return r ? { type: 'do_not_participate', race: r } : unknown; }
    case 'win_or': { const r = refs(args); return r ? { type: 'win_any', races: r } : unknown; }
    case 'win_all': { const r = refs((args[0] ?? []) as unknown[]); return r ? { type: 'win_all', races: r } : unknown; }
    // n = 0 counts wins for the event's branches, which the model cannot tell apart.
    case 'win_n_of': { const n = Number(args[0]), r = n >= 1 ? refs((args[1] ?? []) as unknown[]) : null; return r ? { type: 'win_n_of', n, races: r } : unknown; }
    case 'date': case 'date_range': return { type: 'date' }; // a timing condition: always satisfiable
    case 'between_dates': return args[2] == null || (Array.isArray(args[2]) && args[2].at(-1) === '0+') ? { type: 'date' } : unknown;
    default: {
      const crown = CROWNS[String(type)];
      if (crown) {
        const set = crown.flatMap(([name, year]): RaceRef[] => { const raceId = races.raceIdByName.get(name); return raceId == null ? [] : [{ raceId, year }]; });
        if (set.length === crown.length) return { type: 'win_all', races: set };
      }
      return unknown;
    }
  }
}

type PageReward = { t: string; d?: unknown };

/**
 * The conditions under which a page event gives its skills, beyond the event's own. An option's rewards split at `nl`
 * into branches; markers in a branch say when it applies: `sc` carries a condition, `result_*` a race result, and
 * `pl` the finishing places. A skill branch on first place adds nothing, since a placing range that includes first
 * is already scored as a win. Skill branches that need different things, or a later place, stop the import.
 */
export function skillBranchConditions(event: { n?: unknown; c?: { r?: PageReward[] }[] }): unknown[][] {
  const fail = (why: string) => { throw new Error(`event ${String(event.n)}: ${why}; decide how to score it before importing`); };
  let found: unknown[][] | null = null;
  for (const choice of event.c ?? []) {
    const branches: PageReward[][] = [[]];
    for (const r of choice.r ?? []) if (r.t === 'nl') branches.push([]); else branches.at(-1)!.push(r);
    for (const branch of branches) {
      if (!branch.some((r) => r.t === 'sk' || r.t === 'sr')) continue;
      const places = branch.find((r) => r.t === 'pl');
      if (places && JSON.stringify(places.d) !== '[1]') fail(`skill reward on the ${JSON.stringify(places.d)} place branch`);
      const gates = branch.filter((r) => r.t === 'sc' || r.t.startsWith('result_')).map((r) => r.t === 'sc' ? r.d : [r.t]);
      if (!gates.every(Array.isArray)) fail('a branch condition is not a list');
      if (found && JSON.stringify(found) !== JSON.stringify(gates)) fail('skill branches have different conditions');
      found = gates as unknown[][];
    }
  }
  return found ?? [];
}
