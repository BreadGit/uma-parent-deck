import type { AptKey, Character, Grade, Race } from '../types.ts';

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

export interface ScheduledRace { race: Race; base: number; consecutive: number; pWin: number; selected: boolean }

/** Turn index of a calendar slot: year (1..3), month, half. */
export const slot = (r: Race) => (r.year - 1) * 24 + (r.month - 1) * 2 + (r.half - 1);

/**
 * Walk the calendar, include races whose adjusted win chance clears the threshold.
 * `forced` overrides: true = always include, false = never.
 */
export function buildSchedule(races: Race[], apt: Aptitudes, threshold: number, forced: Map<string, boolean>): ScheduledRace[] {
  const sorted = races.filter((r) => !r.unreleasedEn).slice().sort((a, b) => slot(a) - slot(b));
  const out: ScheduledRace[] = [];
  let lastSlot = -10, streak = 0;
  for (const race of sorted) {
    const base = baseWinChance(race, apt);
    const s = slot(race);
    const nextStreak = s === lastSlot + 1 ? streak + 1 : 1;
    const pWin = Math.max(0, base - (CONSECUTIVE_PENALTY[Math.min(6, nextStreak)] ?? 0.5));
    const override = forced.get(race.calendarId);
    const selected = override ?? pWin >= threshold;
    if (selected && s === lastSlot) continue; // only one race per half-month
    out.push({ race, base, consecutive: selected ? nextStreak : 0, pWin, selected });
    if (selected) { lastSlot = s; streak = nextStreak; }
  }
  return out;
}

export function scheduleSummary(sched: ScheduledRace[]) {
  const sel = sched.filter((s) => s.selected);
  const wins = sel.reduce((a, s) => a + Math.min(1, s.pWin), 0);
  return { count: sel.length, expectedWins: wins, expectedLosses: sel.length - wins };
}

export function traineeAptitudes(trainee: Character | null, overrides: Partial<Aptitudes>): Aptitudes {
  const base: Aptitudes = trainee?.aptitudes ?? { turf: 'A', dirt: 'G', sprint: 'A', mile: 'A', medium: 'A', long: 'A', front: 'A', pace: 'A', late: 'A', end: 'A' };
  return { ...base, ...overrides };
}
