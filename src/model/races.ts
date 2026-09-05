import type { AptKey, Character, Grade, Race } from '../types.ts';
import { distanceCategory } from './stats.ts';

const GRADE_INDEX: Record<Grade, number> = { S: 0, A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6 };
// uma.guide independent-training table: rows distance aptitude, columns surface aptitude.
const WIN_TABLE = [
  [1.1, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5],
  [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4],
  [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3],
  [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2],
  [0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1],
  [0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0],
  [0.5, 0.4, 0.3, 0.2, 0.1, 0.0, 0.0],
];
const CONSECUTIVE_PENALTY = [0, 0, 0, 0.1, 0.25, 0.35, 0.5]; // index = races in a row (3 -> -10%)

export type Aptitudes = Record<AptKey, Grade>;

export function baseWinChance(race: Race, apt: Aptitudes): number {
  const d = GRADE_INDEX[apt[race.category]] ?? 6;
  const s = GRADE_INDEX[apt[race.surface]] ?? 6;
  return Math.min(1, WIN_TABLE[d]![s]!);
}

/** Turn index of a calendar slot: year (1..3), month, half. 0 = Junior early January, 71 = Senior late December. */
export const slotOf = (r: Race) => (r.year - 1) * 24 + (r.month - 1) * 2 + (r.half - 1);
import { SLOT_COUNT } from './rules.ts';
export { SLOT_COUNT };

export interface ScheduledRace {
  race: Race;
  slot: number;
  base: number;        // win chance from aptitudes alone
  pWin: number;        // after the consecutive-race penalty in the final schedule
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
  return characters.filter((c) => (GRADE_INDEX[c.aptitudes[race.surface]] ?? 6) <= 1 && (GRADE_INDEX[c.aptitudes[race.category]] ?? 6) <= 1).length;
}

const penalty = (streak: number) => CONSECUTIVE_PENALTY[Math.min(6, streak)] ?? 0.5;

/** Sequential pass: given a chosen race per slot, drop the ones the streak penalty pushes under the threshold (unless forced). */
function settle(chosen: Map<number, Race>, bases: Map<string, number>, threshold: number, forced: Map<string, boolean>) {
  const kept = new Map<number, { race: Race; pWin: number; consecutive: number }>();
  let lastSlot = -10, streak = 0;
  for (let s = 0; s < SLOT_COUNT; s++) {
    const race = chosen.get(s);
    if (!race) continue;
    const next = s === lastSlot + 1 ? streak + 1 : 1;
    const pWin = Math.max(0, (bases.get(race.calendarId) ?? 0) - penalty(next));
    if (pWin < threshold && forced.get(race.calendarId) !== true && !race.goal) continue;
    kept.set(s, { race, pWin, consecutive: next });
    lastSlot = s; streak = next;
  }
  return kept;
}
const losses = (kept: Map<number, { pWin: number }>) => [...kept.values()].reduce((a, k) => a + (1 - Math.min(1, k.pWin)), 0);

/**
 * Build the G1 agenda: one race per half-month slot, each G1 at most once (a win only needs to happen once for
 * affinity), races above the win-chance threshold, ties within a slot broken by popularity, and duplicate
 * G1s (Classic and Senior runnings) placed in whichever year costs fewer expected losses.
 * `forced` overrides by calendar id: true = always run, false = never.
 */
/** The trainee's race objectives as calendar entries (grade may be below G1). */
export function goalRaces(trainee: Character | null): Race[] {
  if (!trainee) return [];
  const out: Race[] = [];
  for (const g of trainee.goals) {
    const r = g.races[0]; // objectives with several race options are rare; take the first
    if (!r) continue;
    out.push({ calendarId: `goal:${g.slot}:${r.raceId}`, raceInstanceId: 0, raceId: r.raceId, name: r.name, distance: r.distance, category: distanceCategory(r.distance),
      surface: r.surface, year: Math.floor(g.slot / 24) + 1, month: Math.floor((g.slot % 24) / 2) + 1, half: (g.slot % 2) + 1, fansNeeded: r.fansNeeded, fansGain: 0, unreleasedEn: false, goal: true });
  }
  return out;
}

export function buildSchedule(races: Race[], apt: Aptitudes, threshold: number, forced: Map<string, boolean>, popularity: Map<number, number> = new Map(), goals: Race[] = []): ScheduledRace[] {
  const goalSlots = new Set(goals.map(slotOf));
  const all = [...goals, ...races.filter((r) => !r.unreleasedEn && !goalSlots.has(slotOf(r)))].sort((a, b) => slotOf(a) - slotOf(b) || (popularity.get(b.raceId) ?? 0) - (popularity.get(a.raceId) ?? 0));
  const bases = new Map(all.map((r) => [r.calendarId, baseWinChance(r, apt)]));
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
    return cands.filter((r) => !skip.has(r.raceId) && (bases.get(r.calendarId) ?? 0) >= threshold)
      .sort((a, b) => (bases.get(b.calendarId)! - bases.get(a.calendarId)!) || ((popularity.get(b.raceId) ?? 0) - (popularity.get(a.raceId) ?? 0)))[0];
  };
  for (const g of goals) taken.add(g.raceId); // a goal already covers that G1's affinity win
  for (let s = 0; s < SLOT_COUNT; s++) {
    const r = pick(s, taken);
    if (r) { chosen.set(s, r); taken.add(r.raceId); }
  }
  let kept = settle(chosen, bases, threshold, forced);

  // Repair pass: for each G1 that also runs in a later slot, try the later running instead if it costs fewer losses.
  for (const [s, race] of [...chosen]) {
    if (forced.get(race.calendarId) === true || race.goal) continue;
    const later = all.filter((r) => r.raceId === race.raceId && slotOf(r) > s && !chosen.has(slotOf(r)) && forced.get(r.calendarId) !== false && (bases.get(r.calendarId) ?? 0) >= threshold);
    for (const alt of later) {
      const trial = new Map(chosen); trial.delete(s); trial.set(slotOf(alt), alt);
      // the freed slot may now take another race
      const freed = pick(s, new Set([...trial.values()].map((r) => r.raceId)));
      if (freed) trial.set(s, freed);
      const settled = settle(trial, bases, threshold, forced);
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
      const base = bases.get(race.calendarId) ?? 0;
      const pop = popularity.get(race.raceId) ?? 0;
      if (k && k.race.calendarId === race.calendarId) {
        out.push({ race, slot: s, base, pWin: k.pWin, consecutive: k.consecutive, selected: true, goal: !!race.goal, popularity: pop,
          reason: race.goal ? 'Career goal' : forced.get(race.calendarId) === true ? 'Manual pick' : 'Above the threshold' });
        continue;
      }
      const pWin = Math.max(0, base - penalty(nextIfRun));
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

export function scheduleSummary(sched: ScheduledRace[]) {
  const sel = sched.filter((s) => s.selected);
  const wins = sel.reduce((a, s) => a + Math.min(1, s.pWin), 0);
  const unique = new Set(sel.map((s) => s.race.raceId)).size;
  const goals = sel.filter((s) => s.goal).length;
  const longestStreak = sel.reduce((a, s) => Math.max(a, s.consecutive), 0);
  return { count: sel.length, unique, goals, expectedWins: wins, expectedLosses: sel.length - wins, longestStreak };
}

export function traineeAptitudes(trainee: Character | null, overrides: Partial<Aptitudes>): Aptitudes {
  const base: Aptitudes = trainee?.aptitudes ?? { turf: 'A', dirt: 'G', sprint: 'A', mile: 'A', medium: 'A', long: 'A', front: 'A', pace: 'A', late: 'A', end: 'A' };
  return { ...base, ...overrides };
}
