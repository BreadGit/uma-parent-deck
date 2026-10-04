import { isPlainObject } from '../src/types.ts';
import type { MissionCatalog, MissionEvent, MissionRace } from '../src/model/missions.ts';

type Row = Record<string, unknown>;
const number = (row: Row, key: string): number => {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Mission source: invalid ${key}`);
  return value;
};
const string = (row: Row, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Mission source: invalid ${key}`);
  return value;
};
const rows = (value: unknown): Row[] => {
  if (!Array.isArray(value) || !value.every(isPlainObject)) throw new Error('Mission source: expected object rows');
  return value;
};

/** Source conventions and exclusions: docs/umamusume/refs/gametora-missions.md. */
export function normalizeMissionCatalog(raw: { races: unknown; calendar: unknown; missions: unknown }, fetchedAt: string): MissionCatalog {
  const sourceRaces = new Map(rows(raw.races).map((race) => [number(race, 'id'), race]));
  const grades: Record<number, string> = { 100: 'G1', 200: 'G2', 300: 'G3', 400: 'OP', 700: 'Pre-OP' };
  const races: MissionRace[] = rows(raw.calendar).flatMap((entry) => {
    if (entry.special_race === true) return [];
    const race = sourceRaces.get(number(entry, 'instance'));
    if (!race) throw new Error(`Missing mission calendar race ${String(entry.instance)}`);
    if (Array.isArray(race.unreleased_servers) && race.unreleased_servers.includes('en')) return [];
    const grade = grades[number(race, 'grade')];
    if (!grade) throw new Error(`Unknown race grade ${String(race.grade)}`);
    const year = number(entry, 'year'), month = number(entry, 'month'), half = number(entry, 'half');
    if (![1, 2, 3].includes(year) || !Number.isInteger(month) || month < 1 || month > 12 || ![1, 2].includes(half)) throw new Error('Invalid mission calendar slot');
    return [{ calendarId: string(entry, 'id'), raceInstanceId: number(race, 'id'), raceId: number(race, 'race_id'), name: string(race, 'name_en'),
      distance: number(race, 'distance'), surface: number(race, 'terrain') === 2 ? 'dirt' : 'turf', grade,
      year, month, half, fansNeeded: number(entry, 'fans_needed') }];
  });
  const events: MissionEvent[] = rows(raw.missions).flatMap((event) => {
    // GameTora puts permanent sets in this feed too, with placeholder end dates in 2050.
    if (number(event, 'endDate') >= Date.UTC(2050, 0, 1)) return [];
    const missions = rows(event.missions).map((mission) => {
      if (!Array.isArray(mission.subMissions) || mission.subMissions.length) throw new Error('Unsupported nested mission requirements');
      const raceInstanceIds = [...string(mission, 'enText').matchAll(/\[\[race\|(\d+)\]\]/g)].map((match) => Number(match[1]));
      for (const id of raceInstanceIds) if (!sourceRaces.has(id) && ![10003, 40001].includes(id)) throw new Error(`Unknown mission race ${id}`);
      return { id: String(number(mission, 'id')), text: string(mission, 'originalText'), raceInstanceIds,
        start: number(mission, 'startDate'), end: number(mission, 'endDate') };
    });
    if (!missions.some((mission) => mission.raceInstanceIds.length)) return [];
    return [{ id: number(event, 'eventId'), name: string(event, 'eventOriginal'), start: number(event, 'startDate'), end: number(event, 'endDate'), missions }];
  });
  return { fetchedAt, events: events.sort((a, b) => b.start - a.start), races: races.sort((a, b) => a.year - b.year || a.month - b.month || a.half - b.half || a.name.localeCompare(b.name)) };
}
