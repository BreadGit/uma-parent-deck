import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { conditionChance, resolveTarget, traineeEventSources, traineeSources } from '../src/model/sparks.ts';
import { buildSchedule, goalRaces, raceWinChances, traineeAptitudes, type RaceWins } from '../src/model/races.ts';
import { evaluate, makeCtx, traineeCoverage, wishlistCandidates } from '../src/model/deck.ts';
import { planRun, type RunInput } from '../src/model/run.ts';

const data = loadData();
const settings = { ...DEFAULT_SETTINGS };
const byName = (n: string) => data.skills.find((s) => s.name === n && !s.unreleasedEn)!;
const sw = data.characters.find((c) => c.name === 'Special Week')!;
const raceId = (name: string) => data.races.find((r) => r.name === name)!.raceId;
const wins = (entries: [string, number][]): RaceWins => new Map(entries);

test('condition chances: wins multiply, any-of combines, n-of counts, participation is 0 or 1, unknown falls back', () => {
  const w = wins([['1005|2', 0.8], ['1005', 0.8], ['1015|2', 0.5], ['1015', 0.5]]);
  assert.equal(conditionChance({ type: 'win', races: [{ raceId: 1005, year: 2 }] }, w, settings), 0.8);
  assert.equal(conditionChance({ type: 'win', races: [{ raceId: 1019 }] }, w, settings), 0, 'a race not in the agenda cannot be won');
  assert.ok(Math.abs(conditionChance({ type: 'win_all', races: [{ raceId: 1005 }, { raceId: 1015 }] }, w, settings) - 0.4) < 1e-9);
  assert.ok(Math.abs(conditionChance({ type: 'win_any', races: [{ raceId: 1005 }, { raceId: 1015 }] }, w, settings) - 0.9) < 1e-9);
  assert.ok(Math.abs(conditionChance({ type: 'win_n_of', n: 1, races: [{ raceId: 1005 }, { raceId: 1015 }] }, w, settings) - 0.9) < 1e-9);
  assert.ok(Math.abs(conditionChance({ type: 'win_n_of', n: 2, races: [{ raceId: 1005 }, { raceId: 1015 }, { raceId: 1019 }] }, w, settings) - 0.4) < 1e-9);
  assert.equal(conditionChance({ type: 'participate', race: { raceId: 1005 } }, w, settings), 1);
  assert.equal(conditionChance({ type: 'do_not_participate', race: { raceId: 1005 } }, w, settings), 0);
  assert.equal(conditionChance({ type: 'date' }, w, settings), 1);
  assert.equal(conditionChance({ type: 'unknown', raw: ['beat_rival', 1] }, w, { ...settings, charConditionFallbackRate: 0.25 }), 0.25);
});

test('race win chances come from the agenda, per year and for any year', () => {
  const seiun = data.characters.find((c) => c.name === 'Seiun Sky')!;
  const sched = buildSchedule(data.races, traineeAptitudes(seiun, {}), 0.8, new Map(), new Map(), goalRaces(seiun));
  const w = raceWinChances(sched);
  const derby = sched.find((s) => s.race.name.includes('Tokyo Yushun') && s.selected)!;
  assert.equal(w.get(`${derby.race.raceId}|2`), Math.min(1, derby.pWin));
  assert.equal(w.get(String(derby.race.raceId)), Math.min(1, derby.pWin));
  const arima = sched.filter((s) => s.race.name === 'Arima Kinen' && s.selected);
  assert.equal(arima.length, 2, 'both Arima goals are in the agenda');
  const ps = arima.map((a) => Math.min(1, a.pWin));
  assert.ok(Math.abs(w.get(String(arima[0]!.race.raceId))! - (1 - (1 - ps[0]!) * (1 - ps[1]!))) < 1e-9, 'any-year chance combines the two runnings');
  assert.equal(w.has('1019|2'), sched.some((s) => s.selected && s.race.raceId === 1019 && s.race.year === 2));
});

/** Special Week's agenda with the two runnings her secret event needs forced in (the Classic-year Japan Cup and the Senior-year Takarazuka Kinen). */
function specialWeekAgenda(force: boolean, exclude: string[] = []) {
  const base = buildSchedule(data.races, traineeAptitudes(sw, {}), 0.8, new Map(), new Map(), goalRaces(sw));
  const id = (name: string, year: number) => base.find((s) => s.race.name === name && s.race.year === year)!.race.calendarId;
  const forced = new Map<string, boolean>(force ? [[id('Japan Cup', 2), true], [id('Takarazuka Kinen', 3), true]] : []);
  for (const e of exclude) forced.set(e, false);
  return { sched: buildSchedule(data.races, traineeAptitudes(sw, {}), 0.8, forced, new Map(), goalRaces(sw)), id, forced };
}

test("Special Week's secret event needs runnings the default agenda skips; forced in, it is worth the product of the five wins", () => {
  const stamina = resolveTarget(byName('Stamina to Spare').id, data)!;
  const plain = specialWeekAgenda(false);
  assert.equal(traineeSources(sw, stamina, data, settings, raceWinChances(plain.sched)).filter((s) => s.kind === 'secret').length, 0, 'the Classic-year Japan Cup is not in the default agenda, so the event cannot fire');
  const forced = specialWeekAgenda(true);
  const w = raceWinChances(forced.sched);
  const src = traineeSources(sw, stamina, data, settings, w).find((s) => s.kind === 'secret')!;
  assert.ok(src, 'Stamina to Spare comes from a secret event once the runnings are scheduled');
  const refs: [number, number | undefined][] = [[raceId('Satsuki Sho'), undefined], [raceId('Kikuka Sho'), undefined], [raceId('Japan Cup'), 2], [raceId('Takarazuka Kinen'), 3], [raceId('Arima Kinen'), 3]];
  const expected = refs.reduce((a, [id, y]) => a * (w.get(y != null ? `${id}|${y}` : String(id)) ?? 0), 1);
  assert.ok(expected > 0 && Math.abs(src.pObtain - expected) < 1e-9, `secret event chance ${src.pObtain} vs ${expected}`);
  // exclude Satsuki Sho as well: one required win gone, the event is unreachable again
  const without = specialWeekAgenda(true, [plain.sched.find((s) => s.race.name === 'Satsuki Sho')!.race.calendarId]);
  assert.equal(traineeSources(sw, stamina, data, settings, raceWinChances(without.sched)).filter((s) => s.kind === 'secret').length, 0);
});

test("the trainee's choice and outing events are choice-gated and use their own rates", () => {
  const pace = resolveTarget(byName('Pace Strategy').id, data)!;
  const choice = traineeSources(sw, pace, data, settings, new Map()).find((s) => s.kind === 'choice')!;
  assert.ok(choice && choice.isChoice, 'Pace Strategy is one option of a choice event');
  assert.equal(choice.pObtain, settings.charStoryEventRate);
  const haste = resolveTarget(byName('Homestretch Haste').id, data)!;
  const outing = traineeSources(sw, haste, data, { ...settings, charOutingRate: 0.3 }, new Map()).find((s) => s.kind === 'outing')!;
  assert.ok(outing && outing.isChoice);
  assert.ok(Math.abs(outing.pObtain - 0.3) < 1e-9);
  const all = traineeEventSources(sw, new Map(), settings);
  assert.ok(all.every((s) => s.event.key.startsWith('trainee:')));
  assert.ok(!all.some((s) => s.kind === 'secret'), 'with no agenda no secret event can fire');
});

test("two targets on one trainee outing conflict, the prioritized order decides, and the loser stays listed", () => {
  const haste = resolveTarget(byName('Homestretch Haste').id, data)!;
  const adept = resolveTarget(byName('Corner Adept ○').id, data)!;
  const targets = [haste, adept];
  const mk = (priority: number[]) => makeCtx({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: sw, priority });
  const a = evaluate(traineeCoverage(targets, mk([...haste.familyIds])), targets, mk([...haste.familyIds]));
  const cf = a.conflicts.find((c) => c.eventKey.startsWith('trainee:outing'))!;
  assert.ok(cf, 'the outing is contested');
  assert.equal(cf.taken.target, haste.id);
  assert.ok(!a.map.get(adept.id)!.some((s) => s.kind === 'outing'), 'Corner Adept loses the outing');
  const b = evaluate(traineeCoverage(targets, mk([...adept.familyIds])), targets, mk([...adept.familyIds]));
  assert.equal(b.conflicts.find((c) => c.eventKey.startsWith('trainee:outing'))!.taken.target, adept.id);
  const names = wishlistCandidates([], targets, mk([])).map((w) => w.name);
  assert.ok(names.includes('Homestretch Haste') && names.includes('Corner Adept ○'), `both options listed: ${names.join(', ')}`);
});

test("a trainee's non-target choice option appears in the prioritized candidates and can block a target", () => {
  const ctx = makeCtx({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: sw });
  const names = wishlistCandidates([], [], ctx).map((w) => w.name);
  assert.ok(names.includes('Pace Strategy'), `trainee choice options are candidates: ${names.join(', ')}`);
  const haste = resolveTarget(byName('Homestretch Haste').id, data)!;
  const adept = byName('Corner Adept ○');
  const blocked = evaluate(traineeCoverage([haste], ctx), [haste], { ...ctx, priority: [adept.id, ...haste.familyIds] });
  assert.equal(blocked.conflicts.length, 1);
  assert.equal(blocked.conflicts[0]!.taken.target, null, 'the non-target option takes the outing');
});

test('planRun feeds the agenda into secret events: forcing the needed runnings raises the spark chance', () => {
  const stamina = resolveTarget(byName('Stamina to Spare').id, data)!;
  const base: RunInput = { targets: [stamina.id], targetLineage: {}, wishlistOrder: [], wishlistExcluded: [], traineeCardId: sw.cardId, traineeStars: 3, aptOverrides: {}, raceOverrides: {}, pinnedIds: [], borrowFromAll: false, parentGains: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]] };
  const plain = planRun(base, settings, {}, data);
  const { forced } = specialWeekAgenda(true);
  const withRuns = planRun({ ...base, raceOverrides: Object.fromEntries(forced) }, settings, {}, data);
  const secretOf = (p: typeof plain) => (p.existing.sources.get(stamina.id) ?? []).find((s) => s.kind === 'secret');
  assert.equal(secretOf(plain), undefined);
  assert.ok(secretOf(withRuns) && secretOf(withRuns)!.pObtain > 0);
  assert.ok((withRuns.deckResult.sparks.get(stamina.id) ?? 0) > (plain.deckResult.sparks.get(stamina.id) ?? 0));
});
