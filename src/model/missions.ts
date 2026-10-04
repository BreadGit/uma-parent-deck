import type { Character, Race } from '../types.ts';
import { distanceCategory, goalRaces, slotOf } from './races.ts';

export interface MissionRace extends Pick<Race, 'calendarId' | 'raceInstanceId' | 'raceId' | 'name' | 'distance' | 'surface' | 'year' | 'month' | 'half' | 'fansNeeded'> {
  grade: string;
}
export interface Mission {
  id: string;
  text: string;
  raceInstanceIds: number[];
  start: number;
  end: number;
}
export interface MissionEvent { id: number; name: string; start: number; end: number; missions: Mission[] }
export interface MissionCatalog { fetchedAt: string; events: MissionEvent[]; races: MissionRace[] }
export interface MissionState {
  /** null follows current events until the user makes a selection. */
  eventIds: number[] | null;
  completedMissionIds: string[];
  customRaceIds: number[];
  completedCustomRaceIds: number[];
  pastedLines: string[];
  traineeCardId: number | null;
}
export const defaultMissionState = (): MissionState => ({ eventIds: null, completedMissionIds: [], customRaceIds: [], completedCustomRaceIds: [], pastedLines: [], traineeCardId: null });
export const eventStatus = (event: MissionEvent, now: number): 'Upcoming' | 'Ended' | 'Active' => now < event.start ? 'Upcoming' : now > event.end ? 'Ended' : 'Active';
export const selectedMissionEvents = (events: MissionEvent[], state: MissionState, now: number) =>
  events.filter((event) => state.eventIds === null ? eventStatus(event, now) === 'Active' : state.eventIds.includes(event.id));

export interface MissionAgendaEntry { race: MissionRace; missions: Mission[]; custom: boolean; complete: boolean }
/** Show every running: alternatives in different years are opportunities, not extra required wins. */
export function missionAgenda(races: MissionRace[], missions: Mission[], state: MissionState): Map<number, MissionAgendaEntry[]> {
  const bySlot = new Map<number, MissionAgendaEntry[]>();
  for (const race of races) {
    const matching = missions.filter((mission) => mission.raceInstanceIds.includes(race.raceInstanceId));
    const custom = state.customRaceIds.includes(race.raceId);
    if (!matching.length && !custom) continue;
    const complete = matching.every((mission) => state.completedMissionIds.includes(mission.id)) && (!custom || state.completedCustomRaceIds.includes(race.raceId));
    const slot = slotOf(race);
    const entries = bySlot.get(slot) ?? [];
    entries.push({ race, missions: matching, custom, complete });
    bySlot.set(slot, entries);
  }
  return bySlot;
}

const normalizedName = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Keep unmatched requirements as checklist items; never silently discard pasted mission text. */
export function parsePastedMissions(text: string, races: MissionRace[]): Mission[] {
  const lines = [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^x\s*[\d,]+$/i.test(line)))];
  return lines.map((line) => {
    // Event prefixes can themselves name a race, even on a non-race requirement.
    const normalized = ` ${normalizedName(line.slice(line.indexOf(':') + 1))} `;
    const matches: { id: number; start: number; end: number }[] = [];
    for (const race of races) {
      const names = [race.name, ...(race.name === 'Tokyo Yushun (Japanese Derby)' ? ['Japanese Derby', 'Tokyo Yushun'] : [])];
      for (const name of names) {
        const needle = ` ${normalizedName(name)} `;
        let start = normalized.indexOf(needle);
        while (start >= 0) {
          matches.push({ id: race.raceInstanceId, start, end: start + needle.length });
          start = normalized.indexOf(needle, start + 1);
        }
      }
    }
    // Keisei Hai Autumn Handicap must not also add the unrelated Keisei Hai in January.
    const matched = matches.filter((match) => !matches.some((other) => other.start <= match.start && other.end >= match.end && other.end - other.start > match.end - match.start));
    return { id: `paste:${line}`, text: line, raceInstanceIds: [...new Set(matched.map((match) => match.id))], start: 0, end: Number.MAX_SAFE_INTEGER };
  });
}

export const hasRaceAptitude = (trainee: Character, race: MissionRace) =>
  ['S', 'A', 'B'].includes(trainee.aptitudes[race.surface]) && ['S', 'A', 'B'].includes(trainee.aptitudes[distanceCategory(race.distance)]);

export interface MissionRaceFit { trainee: Character; schedule: Map<number, MissionRace>; total: number; goalMatches: number }
/** Maximum matching assigns each distinct race to one available slot, moving an earlier pick when needed. */
export function missionRaceFit(trainee: Character, entries: MissionAgendaEntry[]): MissionRaceFit {
  const remaining = entries.filter((entry) => !entry.complete).map((entry) => entry.race);
  const ids = [...new Set(remaining.map((race) => race.raceId))];
  const goals = new Map(goalRaces(trainee).map((race) => [slotOf(race), race.raceId]));
  const candidates = new Map(ids.map((id) => [id, remaining.filter((race) => race.raceId === id && hasRaceAptitude(trainee, race)
    && (!goals.has(slotOf(race)) || goals.get(slotOf(race)) === id)).sort((a, b) => Number(goals.has(slotOf(b))) - Number(goals.has(slotOf(a))) || slotOf(a) - slotOf(b))]));
  const schedule = new Map<number, MissionRace>();
  const place = (id: number, seen: Set<number>): boolean => {
    for (const race of candidates.get(id) ?? []) {
      const slot = slotOf(race);
      if (seen.has(slot)) continue;
      seen.add(slot);
      const previous = schedule.get(slot);
      if (!previous || place(previous.raceId, seen)) { schedule.set(slot, race); return true; }
    }
    return false;
  };
  for (const id of ids.sort((a, b) => candidates.get(a)!.length - candidates.get(b)!.length || a - b)) place(id, new Set());
  const goalMatches = [...schedule].filter(([slot, race]) => goals.get(slot) === race.raceId).length;
  return { trainee, schedule, total: ids.length, goalMatches };
}

export function recommendMissionTrainees(characters: Character[], entries: MissionAgendaEntry[], now: number): MissionRaceFit[] {
  return characters.filter((trainee) => Date.parse(trainee.releaseEn) <= now).map((trainee) => missionRaceFit(trainee, entries))
    .sort((a, b) => b.schedule.size - a.schedule.size || b.goalMatches - a.goalMatches || a.trainee.name.localeCompare(b.trainee.name) || a.trainee.cardId - b.trainee.cardId);
}
