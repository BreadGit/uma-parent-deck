import type { AptKey, Character, Grade, Race } from '../types.ts';
import { DISTANCE_PENALTY, RACE_WIN_BASE, SLOT_COUNT, STREAK_PENALTY, SURFACE_PENALTY } from './rules.ts';
export { SLOT_COUNT };

/** Race distance category by metres, the same bands the game uses for distance aptitude. */
export const distanceCategory = (m: number): Race['category'] => (m <= 1400 ? 'sprint' : m <= 1800 ? 'mile' : m <= 2400 ? 'medium' : 'long');

const GRADE_ORDER: Grade[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
const gradeIndex = (g: Grade | undefined) => { const i = GRADE_ORDER.indexOf(g ?? 'G'); return i < 0 ? 7 : i; };

export type Aptitudes = Record<AptKey, Grade>;

/**
 * Independent training win score from aptitudes alone: 110% for A/A (S counts as A) minus the surface and distance
 * penalties. Stats, skills and mood play no part. Not clamped: an A/A score of 110% absorbs the first 10 points
 * of the streak penalty. Use winChance() for the displayed probability.
 */
export function rawWinScore(race: Race, apt: Aptitudes): number {
  return RACE_WIN_BASE - (SURFACE_PENALTY[apt[race.surface]] ?? 0.9) - (DISTANCE_PENALTY[apt[race.category]] ?? 0.9);
}
/** Penalty for the n-th race of a streak of consecutive half-month slots (n = 1 for a fresh race). */
export const streakPenalty = (n: number) => STREAK_PENALTY[Math.min(STREAK_PENALTY.length - 1, Math.max(0, n))] ?? 0;
/** Displayed win probability: the raw score minus the streak penalty, clamped to 0..100%. */
export const winChance = (raw: number, streak = 1) => Math.max(0, Math.min(1, raw - streakPenalty(streak)));
/** Win chance from aptitudes alone, clamped, as the game would display it for a fresh race. */
export const baseWinChance = (race: Race, apt: Aptitudes) => winChance(rawWinScore(race, apt), 1);

/** Turn index of a calendar slot: year (1..3), month, half. 0 = Junior early January, 71 = Senior late December. */
export const slotOf = (r: Race) => (r.year - 1) * 24 + (r.month - 1) * 2 + (r.half - 1);

export interface ScheduledRace {
  race: Race;
  slot: number;
  base: number;        // win chance from aptitudes alone, clamped for display
  pWin: number;        // after the consecutive-race penalty in the final schedule (1 for an objective the run cannot afford to lose)
  consecutive: number; // position in a streak when selected (1 = fresh), 0 when not selected
  selected: boolean;
  goal: boolean;       // career objective: always run
  reason: string;      // why it is or is not in the schedule
  popularity: number;  // how many Global umas could run it comfortably (tiebreak between races in one slot)
}

/**
 * How many umas would comfortably run this race: base aptitude of B or better on both surface and distance.
 * A rough stand-in for how common the race is on parents, used only to break ties between races that share a slot.
 */
export function racePopularity(race: Race, characters: Character[]): number {
  return characters.filter((c) => gradeIndex(c.aptitudes[race.surface]) <= 2 && gradeIndex(c.aptitudes[race.category]) <= 2).length;
}

/**
 * Win chance of a race at a streak position. An objective the run would end on losing (a placement requirement)
 * is won automatically; a participation-only objective and every optional race roll the aptitude odds.
 */
const pWinAt = (race: Race, raw: number, streak: number) => (race.autoWin ? 1 : winChance(raw, streak));

/** Sequential pass: given a chosen race per slot, drop the ones the streak penalty pushes under the threshold (unless forced). */
function settle(chosen: Map<number, Race>, raws: Map<string, number>, threshold: number, forced: Map<string, boolean>) {
  const kept = new Map<number, { race: Race; pWin: number; consecutive: number }>();
  let lastSlot = -10, streak = 0;
  for (let s = 0; s < SLOT_COUNT; s++) {
    const race = chosen.get(s);
    if (!race) continue;
    const next = s === lastSlot + 1 ? streak + 1 : 1;
    const pWin = pWinAt(race, raws.get(race.calendarId) ?? 0, next);
    if (pWin < threshold && forced.get(race.calendarId) !== true && !race.goal) continue;
    kept.set(s, { race, pWin, consecutive: next });
    lastSlot = s; streak = next;
  }
  return kept;
}
const losses = (kept: Map<number, { pWin: number }>) => [...kept.values()].reduce((a, k) => a + (1 - k.pWin), 0);

/** The trainee's race objectives as calendar entries (grade may be below G1). */
export function goalRaces(trainee: Character | null): Race[] {
  if (!trainee) return [];
  const out: Race[] = [];
  for (const g of trainee.goals) {
    const r = g.races[0]; // objectives with several race options are rare; take the first
    if (!r) continue;
    out.push({ calendarId: `goal:${g.slot}:${r.raceId}`, raceInstanceId: 0, raceId: r.raceId, name: r.name, distance: r.distance, category: distanceCategory(r.distance),
      surface: r.surface, year: Math.floor(g.slot / 24) + 1, month: Math.floor((g.slot % 24) / 2) + 1, half: (g.slot % 2) + 1, fansNeeded: r.fansNeeded, fansGain: r.fansGain ?? 0, unreleasedEn: false,
      goal: true, autoWin: (g.required ?? 0) > 0 });
  }
  return out;
}

/**
 * Build the G1 agenda: one race per half-month slot, each G1 at most once (a win only needs to happen once for
 * affinity), races above the win-chance threshold, ties within a slot broken by popularity, and duplicate
 * G1s (Classic and Senior runnings) placed in whichever year costs fewer expected losses.
 * `forced` overrides by calendar id: true = always run, false = never.
 */
export function buildSchedule(races: Race[], apt: Aptitudes, threshold: number, forced: Map<string, boolean>, popularity: Map<number, number> = new Map(), goals: Race[] = []): ScheduledRace[] {
  const goalSlots = new Set(goals.map(slotOf));
  // Alternate objective routes can repeat a race. A physical running counts only once, including its rewards.
  const entries = [...goals, ...races.filter((r) => !r.unreleasedEn && !goalSlots.has(slotOf(r)))];
  const all = [...new Map(entries.map((r) => [`${slotOf(r)}:${r.raceId}`, r])).values()]
    .sort((a, b) => slotOf(a) - slotOf(b) || (popularity.get(b.raceId) ?? 0) - (popularity.get(a.raceId) ?? 0));
  const raws = new Map(all.map((r) => [r.calendarId, rawWinScore(r, apt)]));
  const fresh = (r: Race) => pWinAt(r, raws.get(r.calendarId) ?? 0, 1);
  const bySlot = new Map<number, Race[]>();
  for (const r of all) bySlot.set(slotOf(r), [...(bySlot.get(slotOf(r)) ?? []), r]);

  // First pass: pick a race per slot in calendar order, skipping G1s already taken.
  const chosen = new Map<number, Race>();
  const taken = new Set<number>();
  const pick = (s: number, skip: Set<number>) => {
    const goal = (bySlot.get(s) ?? []).find((r) => r.goal);
    if (goal) return goal;
    const cands = (bySlot.get(s) ?? []).filter((r) => forced.get(r.calendarId) !== false);
    const forcedOne = cands.find((r) => forced.get(r.calendarId) === true);
    if (forcedOne) return forcedOne;
    return cands.filter((r) => !skip.has(r.raceId) && fresh(r) >= threshold)
      .sort((a, b) => (fresh(b) - fresh(a)) || ((popularity.get(b.raceId) ?? 0) - (popularity.get(a.raceId) ?? 0)))[0];
  };
  for (const g of goals) taken.add(g.raceId); // a goal already covers that G1's affinity win
  for (let s = 0; s < SLOT_COUNT; s++) {
    const r = pick(s, taken);
    if (r) { chosen.set(s, r); taken.add(r.raceId); }
  }
  let kept = settle(chosen, raws, threshold, forced);

  // Repair pass: for each G1 that also runs in a later slot, try the later running instead if it costs fewer losses.
  for (const [s, race] of [...chosen]) {
    if (forced.get(race.calendarId) === true || race.goal) continue;
    const later = all.filter((r) => r.raceId === race.raceId && slotOf(r) > s && !chosen.has(slotOf(r)) && forced.get(r.calendarId) !== false && fresh(r) >= threshold);
    for (const alt of later) {
      const trial = new Map(chosen); trial.delete(s); trial.set(slotOf(alt), alt);
      // the freed slot may now take another race
      const freed = pick(s, new Set([...trial.values()].map((r) => r.raceId)));
      if (freed) trial.set(s, freed);
      const settled = settle(trial, raws, threshold, forced);
      if (settled.size > kept.size || (settled.size === kept.size && losses(settled) < losses(kept) - 1e-9)) {
        chosen.clear(); for (const [k, v] of trial) chosen.set(k, v);
        kept = settled;
        break;
      }
    }
  }

  // Report every calendar race with its status.
  const usedRaceIds = new Set([...kept.values()].map((k) => k.race.raceId));
  const out: ScheduledRace[] = [];
  let lastSlot = -10, streak = 0;
  for (let s = 0; s < SLOT_COUNT; s++) {
    const k = kept.get(s);
    const nextIfRun = s === lastSlot + 1 ? streak + 1 : 1;
    for (const race of bySlot.get(s) ?? []) {
      const base = fresh(race);
      const pop = popularity.get(race.raceId) ?? 0;
      if (k && k.race.calendarId === race.calendarId) {
        out.push({ race, slot: s, base, pWin: k.pWin, consecutive: k.consecutive, selected: true, goal: !!race.goal, popularity: pop,
          reason: race.goal ? (race.autoWin ? 'Career goal (the run cannot afford to lose it, so it is won)' : 'Career goal (participation only, so the aptitude odds apply)') : forced.get(race.calendarId) === true ? 'Manual pick' : 'Above the threshold' });
        continue;
      }
      const pWin = pWinAt(race, raws.get(race.calendarId) ?? 0, nextIfRun);
      let reason: string;
      if (forced.get(race.calendarId) === false) reason = 'Manually excluded';
      else if (k) reason = `Slot taken by ${k.race.name}`;
      else if (base < threshold) reason = 'Below the win threshold';
      else if (usedRaceIds.has(race.raceId)) reason = 'Already run in another year (a win only counts once)';
      else if (pWin < threshold) reason = 'Streak penalty pushes it under the threshold';
      else reason = 'Not selected';
      out.push({ race, slot: s, base, pWin, consecutive: 0, selected: false, goal: !!race.goal, reason, popularity: pop });
    }
    if (k) { lastSlot = s; streak = k.consecutive; }
  }
  return out;
}

/**
 * Win chance per race in the agenda, for secret-event conditions: keyed "raceId|year" for one running and "raceId"
 * for any running (a G1 run in two years counts if either is won). Races not in the agenda are absent.
 */
export type RaceWins = Map<string, number>;
export function raceWinChances(sched: ScheduledRace[]): RaceWins {
  const out: RaceWins = new Map();
  for (const s of sched) {
    if (!s.selected) continue;
    const p = Math.min(1, s.pWin);
    out.set(`${s.race.raceId}|${s.race.year}`, Math.max(out.get(`${s.race.raceId}|${s.race.year}`) ?? 0, p));
    const any = out.get(String(s.race.raceId)) ?? 0;
    out.set(String(s.race.raceId), 1 - (1 - any) * (1 - p));
  }
  return out;
}

/** Expected fans gained by the agenda's wins before a calendar slot (fans from a loss are ignored, so this is conservative). */
export function expectedFansBefore(sched: ScheduledRace[], slot: number): number {
  return sched.filter((s) => s.selected && s.slot < slot).reduce((a, s) => a + s.race.fansGain * Math.min(1, s.pWin), 0);
}

export function scheduleSummary(sched: ScheduledRace[]) {
  const sel = sched.filter((s) => s.selected);
  const wins = sel.reduce((a, s) => a + Math.min(1, s.pWin), 0);
  const unique = new Set(sel.map((s) => s.race.raceId)).size;
  const goals = sel.filter((s) => s.goal).length;
  const longestStreak = sel.reduce((a, s) => Math.max(a, s.consecutive), 0);
  // fans come only from wins: a lost race pays nothing, so each race counts its fans times its win chance
  const expectedFans = sel.reduce((a, s) => a + s.race.fansGain * Math.min(1, s.pWin), 0);
  return { count: sel.length, unique, goals, expectedWins: wins, expectedLosses: sel.length - wins, longestStreak, expectedFans };
}

export function traineeAptitudes(trainee: Character | null, overrides: Partial<Aptitudes>): Aptitudes {
  const base: Aptitudes = trainee?.aptitudes ?? { turf: 'A', dirt: 'G', sprint: 'A', mile: 'A', medium: 'A', long: 'A', front: 'A', pace: 'A', late: 'A', end: 'A' };
  return { ...base, ...overrides };
}
