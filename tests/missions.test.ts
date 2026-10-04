import { test } from 'node:test';
import assert from 'node:assert/strict';
import catalogJson from '../data/missions.json' with { type: 'json' };
import sourceMissions from '../data/raw/en__missions__limited.json' with { type: 'json' };
import sourceRaces from '../data/raw/races.json' with { type: 'json' };
import sourceCalendar from '../data/raw/ura-races.json' with { type: 'json' };
import { normalizeMissionCatalog } from '../scripts/mission-import.ts';
import { defaultMissionState, eventStatus, missionAgenda, missionRaceFit, parsePastedMissions, recommendMissionTrainees, selectedMissionEvents, type MissionCatalog, type MissionAgendaEntry } from '../src/model/missions.ts';
import { defaultState, migrate, resetRun } from '../src/state.ts';
import { loadData } from '../src/data.ts';
import type { Character } from '../src/types.ts';
import { must } from './helpers.ts';

const catalog = catalogJson as MissionCatalog;
const data = loadData();
const mile = must(catalog.events.find((event) => event.id === 201));
const example = `x20000
Mile Ch.: Complete a Career playthrough having cleared all Career goals
x20000
Mile Ch.: Complete 2 Career playthroughs having cleared all Career goals
x1
Mile Ch.: Win the Fuji Stakes in Career
x1
Mile Ch.: Win the Swan Stakes in Career
x10000
Mile Ch.: Win the Mile Championship in Career
x150
Mile Ch.: Complete all special missions`;

test('mission catalog is reproducible from cached sources and includes future race sets', () => {
  assert.deepEqual(normalizeMissionCatalog({ races: sourceRaces, calendar: sourceCalendar, missions: sourceMissions }, catalog.fetchedAt), catalog);
  assert.ok(catalog.events.some((event) => event.start > Date.parse('2026-10-04')));
  assert.ok(catalog.events.every((event) => event.end < Date.UTC(2050, 0, 1)));
  assert.equal(new Set(catalog.races.map((race) => race.calendarId)).size, catalog.races.length);
  assert.equal(new Set(catalog.events.flatMap((event) => event.missions.map((mission) => mission.id))).size, catalog.events.flatMap((event) => event.missions).length);
});

test('active sets follow exact event windows while explicit selections remain stable', () => {
  const state = defaultMissionState();
  assert.equal(eventStatus(mile, mile.start - 1), 'Upcoming');
  assert.equal(eventStatus(mile, mile.start), 'Active');
  assert.equal(eventStatus(mile, mile.end), 'Active');
  assert.equal(eventStatus(mile, mile.end + 1), 'Ended');
  assert.deepEqual(selectedMissionEvents(catalog.events, state, Date.parse('2026-10-04T12:00:00Z')).map((event) => event.id).sort(), [201, 202]);
  state.eventIds = [201];
  assert.deepEqual(selectedMissionEvents(catalog.events, state, mile.end + 1), [mile]);
  state.eventIds = [];
  assert.deepEqual(selectedMissionEvents(catalog.events, state, mile.start), []);
});

test('the pasted example keeps all six requirements and maps three races without reward lines', () => {
  const missions = parsePastedMissions(example.replaceAll('\n', '\r\n'), catalog.races);
  assert.equal(missions.length, 6);
  assert.deepEqual(missions.filter((mission) => mission.raceInstanceIds.length).map((mission) => mission.raceInstanceIds), [[305801], [202901], [101801]]);
  assert.equal(parsePastedMissions(`${example}\n${example}`, catalog.races).length, 6);
  assert.equal(parsePastedMissions('Win an unknown race\nx1', catalog.races)[0]?.text, 'Win an unknown race');
  assert.ok(parsePastedMissions('Win the Japanese Derby in Career', catalog.races)[0]?.raceInstanceIds.length);
  const multi = parsePastedMissions('Win the Fuji Stakes and Swan Stakes in the same Career', catalog.races);
  assert.deepEqual(new Set(multi[0]?.raceInstanceIds), new Set([305801, 202901]));
  assert.deepEqual(parsePastedMissions('Japan Cup: Complete 2 Career playthroughs', catalog.races)[0]?.raceInstanceIds, []);
  const keisei = parsePastedMissions('Win the Keisei Hai Autumn Handicap in Career', catalog.races)[0]!;
  assert.deepEqual([...new Set(catalog.races.filter((race) => keisei.raceInstanceIds.includes(race.raceInstanceId)).map((race) => race.name))], ['Keisei Hai Autumn Handicap']);
  const both = parsePastedMissions('Win the Keisei Hai and Keisei Hai Autumn Handicap', catalog.races)[0]!;
  assert.equal(new Set(catalog.races.filter((race) => both.raceInstanceIds.includes(race.raceInstanceId)).map((race) => race.name)).size, 2);
});

test('Mile Championship races occupy late October and late November in both years', () => {
  const state = defaultMissionState();
  const agenda = missionAgenda(catalog.races, mile.missions, state);
  assert.deepEqual([...agenda.keys()], [43, 45, 67, 69]);
  assert.deepEqual(agenda.get(43)?.map((entry) => entry.race.name), ['Fuji Stakes', 'Swan Stakes']);
  assert.deepEqual(agenda.get(67)?.map((entry) => entry.race.name), ['Fuji Stakes', 'Swan Stakes']);
  assert.equal(agenda.get(45)?.[0]?.race.name, 'Mile Championship');
  state.completedMissionIds = ['1001373'];
  const completed = [...missionAgenda(catalog.races, mile.missions, state).values()].flat().filter((entry) => entry.complete);
  assert.deepEqual(completed.map((entry) => entry.race.name), ['Fuji Stakes', 'Fuji Stakes']);
  assert.equal(mile.missions.find((mission) => mission.id === '1001373')?.text, 'Mile Ch.: Win the Fuji Stakes in Career');
});

const trainee = (): Character => ({ ...structuredClone(data.characters[0]!), releaseEn: '2025-01-01', goals: [], aptitudes: { turf: 'A', dirt: 'A', sprint: 'A', mile: 'A', medium: 'A', long: 'A', front: 'A', pace: 'A', late: 'A', end: 'A' } });
const mileEntries = () => [...missionAgenda(catalog.races, mile.missions, defaultMissionState()).values()].flat();

test('trainee fit splits colliding races between years, reserves goals and respects aptitudes', () => {
  const ch = trainee();
  let fit = missionRaceFit(ch, mileEntries());
  assert.equal(fit.schedule.size, 3);
  const october = [...fit.schedule].filter(([, race]) => race.month === 10);
  assert.deepEqual(october.map(([slot]) => slot).sort(), [43, 67]);
  assert.equal(new Set(october.map(([, race]) => race.raceId)).size, 2);
  const goal = { raceId: 999, name: 'Other goal', distance: 2000, surface: 'turf' as const, grade: 100, fansNeeded: 0, fansGain: 0 };
  ch.goals = [{ slot: 43, required: 1, races: [goal] }];
  fit = missionRaceFit(ch, mileEntries());
  assert.equal(fit.schedule.size, 2);
  assert.ok(!fit.schedule.has(43));
  ch.goals.push({ slot: 67, required: 1, races: [goal] });
  assert.equal(missionRaceFit(ch, mileEntries()).schedule.size, 1);
  ch.goals = [];
  ch.aptitudes.sprint = 'C';
  assert.equal(missionRaceFit(ch, mileEntries()).schedule.size, 2, 'Swan Stakes needs sprint aptitude');
  ch.aptitudes.turf = 'G';
  assert.equal(missionRaceFit(ch, mileEntries()).schedule.size, 0);
});

test('maximum matching moves earlier picks to fit a constrained race', () => {
  const base = catalog.races[0]!;
  const entry = (raceId: number, month: number): MissionAgendaEntry => ({ race: { ...base, raceId, year: 2, month, half: 1 }, missions: [], complete: false, custom: true });
  const fit = missionRaceFit(trainee(), [entry(1, 1), entry(1, 2), entry(2, 1), entry(2, 2), entry(3, 2), entry(3, 3)]);
  assert.equal(fit.schedule.size, 3);
  assert.deepEqual([...fit.schedule.keys()].sort(), [24, 26, 28]);
  assert.deepEqual([...fit.schedule.values()].map((race) => race.raceId).sort(), [1, 2, 3]);
});

test('recommendations exclude future releases and completed races, without changing the planner', () => {
  const good = trainee(), bad = trainee(), future = trainee();
  good.cardId = 1; bad.cardId = 2; future.cardId = 3;
  bad.aptitudes.turf = 'G'; future.releaseEn = '2027-01-01';
  const entries = mileEntries().map((entry) => ({ ...entry, complete: entry.race.raceId === 3058 }));
  const fits = recommendMissionTrainees([future, bad, good], entries, Date.parse('2026-10-04'));
  assert.deepEqual(fits.map((fit) => fit.trainee.cardId), [1, 2]);
  assert.equal(fits[0]?.total, 2);
  assert.equal(fits[0]?.schedule.size, 2);
});

test('mission state migrates independently and survives planner reset and missing catalog IDs', () => {
  const state = defaultState(data);
  state.run.traineeCardId = data.characters[0]!.cardId;
  state.run.raceOverrides = { '78': true };
  state.missions = { eventIds: [201, 99999], traineeCardId: 999999, customRaceIds: [1018], completedCustomRaceIds: [1018], completedMissionIds: ['1001373', 'future'], pastedLines: ['Unknown future mission'] };
  const loaded = migrate({ current: state }, data);
  assert.deepEqual(loaded.missions, state.missions);
  assert.deepEqual(loaded.run, state.run);
  assert.deepEqual(resetRun(loaded, data).missions, state.missions);
  assert.deepEqual(migrate({ current: { ...state, version: 23, missions: undefined } }, data).missions, defaultMissionState());
  const malformed = migrate({ current: { ...state, missions: { eventIds: [201, 'x', -1], customRaceIds: [1018, 1018], completedMissionIds: [false, '1001373'], pastedLines: ['hi', 4, ''], traineeCardId: NaN } } }, data).missions;
  assert.deepEqual(malformed, { eventIds: [201], customRaceIds: [1018], completedCustomRaceIds: [], completedMissionIds: ['1001373'], pastedLines: ['hi'], traineeCardId: null });
});
