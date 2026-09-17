// Global currently uses the content period after NAR and before the second anniversary.
// Later snapshots describe the older rewards still applicable to Global.
const PERIODS = ['pre_first_anni', 'pre_nar', 'pre_2nd_anni', 'pre_3rd_anni', 'pre_2024_wedding'];
const GLOBAL_INDEX = PERIODS.indexOf('pre_2nd_anni');

/** Source-backed release canaries make the assumed Global period an explicit update boundary. */
export function validateGlobalPeriod(scenarios: { id: number; start_en?: number }[], skills: { id: number; unreleased?: string[] }[]): void {
  const concert = scenarios.find((scenario) => scenario.id === 3);
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
  for (const entry of history) if (!entry || typeof entry !== 'object' || typeof entry.period !== 'string' || !entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data)) throw new Error('Event history entry must contain a period and event data.');
  const applicable = history.filter((history) => periodIndex(history.period) >= GLOBAL_INDEX)
    .sort((a, b) => periodIndex(a.period) - periodIndex(b.period));
  return applicable[0]?.data ?? event;
}

export function staticEventOnGlobal(entry: unknown[]): unknown[] {
  const histories = entry.slice(3).filter((tag): tag is [number, [string, unknown[]][]] => Array.isArray(tag) && tag[0] === 9);
  const applicable = histories.flatMap((tag) => tag[1]).filter(([period]) => periodIndex(period) >= GLOBAL_INDEX)
    .sort(([a], [b]) => periodIndex(a) - periodIndex(b));
  return applicable[0]?.[1] ?? entry;
}

/** Static event rewards index the dictionary with an offset of 36. Missing references are data errors. */
export function normalizeReward(source: unknown): { t: string; v?: unknown; d?: unknown; r?: boolean } {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Event reward must be an object.');
  const reward = source as Record<string, unknown>;
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
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Random skill reward entry must be an object.');
      return { ...entry, d: skillId(entry.d) };
    });
  }
  return { t: reward.t, ...(reward.v != null ? { v: reward.v } : {}), ...(data != null ? { d: data } : {}), ...(reward.r != null ? { r: reward.r } : {}) };
}

export function decodeRewards(dictionary: unknown[], rewardId: number): ReturnType<typeof normalizeReward>[] {
  const reward = dictionary[rewardId - 36];
  if (!Number.isInteger(rewardId) || !Array.isArray(reward) || reward.length > 4) {
    throw new Error(`Event reward ${rewardId} has no valid dictionary entry at index ${rewardId - 36}.`);
  }
  const [t, v, d, flag] = reward;
  if (t == null && v == null && d == null && Array.isArray(flag)) return flag.map(normalizeReward);
  return [normalizeReward({ t, ...(v != null ? { v } : {}), ...(d != null ? { d } : {}), ...(flag != null ? { r: flag } : {}) })];
}
