import { DEFAULT_GOAL, emptyPinkLineage } from '../src/model/goal-input.ts';
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
const wins = (entries: [string, number][]): RaceWins => new Map(entries);

/** Special Week's agenda with the two runnings her secret event needs forced in (the Classic-year Japan Cup and the Senior-year Takarazuka Kinen). */
function specialWeekAgenda(force: boolean, exclude: string[] = []) {
  const base = buildSchedule(data.races, traineeAptitudes(sw, {}), 0.8, new Map(), new Map(), goalRaces(sw));
  const id = (name: string, year: number) => base.find((s) => s.race.name === name && s.race.year === year)!.race.calendarId;
  const forced = new Map<string, boolean>(force ? [[id('Japan Cup', 2), true], [id('Takarazuka Kinen', 3), true]] : []);
  for (const e of exclude) forced.set(e, false);
  return { sched: buildSchedule(data.races, traineeAptitudes(sw, {}), 0.8, forced, new Map(), goalRaces(sw)), id, forced };
}

test('secret events: conditions are scored from the agenda (wins multiply, any-of combines, n-of counts, participation is 0 or 1, unknown falls back), per year and for any year', () => {
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
  const seiun = data.characters.find((c) => c.name === 'Seiun Sky')!;
  const sched = buildSchedule(data.races, traineeAptitudes(seiun, {}), 0.8, new Map(), new Map(), goalRaces(seiun));
  const rw = raceWinChances(sched);
  const derby = sched.find((s) => s.race.name.includes('Tokyo Yushun') && s.selected)!;
  assert.equal(rw.get(`${derby.race.raceId}|2`), Math.min(1, derby.pWin));
  assert.equal(rw.get(String(derby.race.raceId)), Math.min(1, derby.pWin));
  const arima = sched.filter((s) => s.race.name === 'Arima Kinen' && s.selected);
  assert.equal(arima.length, 2, 'both Arima goals are in the agenda');
  const ps = arima.map((a) => Math.min(1, a.pWin));
  assert.ok(Math.abs(rw.get(String(arima[0]!.race.raceId))! - (1 - (1 - ps[0]!) * (1 - ps[1]!))) < 1e-9, 'any-year chance combines the two runnings');
  assert.equal(rw.has('1019|2'), sched.some((s) => s.selected && s.race.raceId === 1019 && s.race.year === 2));
});

test("Special Week's secret event needs runnings the default agenda skips; forced in, it is worth the product of the five wins, in planRun too", () => {
  const stamina = resolveTarget(byName('Stamina to Spare').id, data)!;
  const plain = specialWeekAgenda(false);
  assert.equal(traineeSources(sw, stamina, data, settings, raceWinChances(plain.sched)).filter((s) => s.kind === 'secret').length, 0, 'the Classic-year Japan Cup is not in the default agenda, so the event cannot fire');
  const forced = specialWeekAgenda(true);
  const w = raceWinChances(forced.sched);
  const src = traineeSources(sw, stamina, data, settings, w).find((s) => s.kind === 'secret')!;
  const ev = sw.events.find((e) => e.kind === 'secret' && e.choices.some((c) => c.outcomes.flat().some((r) => r.t === 'sk' && r.d === stamina.white?.id)))!;
  const expected = ev.conditions!.reduce((a, c) => a * conditionChance(c, w, settings), 1);
  assert.ok(src && Math.abs(src.pObtain - expected) < 1e-9 && expected > 0, `secret ${src?.pObtain} vs ${expected}`);
  const dropped = specialWeekAgenda(true, [forced.id('Japan Cup', 2)]);
  assert.equal(traineeSources(sw, stamina, data, settings, raceWinChances(dropped.sched)).filter((s) => s.kind === 'secret').length, 0, 'excluding one required running kills the event');
  const base: RunInput = { goal: structuredClone(DEFAULT_GOAL), pinkLineage: emptyPinkLineage(), targets: [stamina.id].map((id) => ({ id, role: 'preferred' as const, stars: 2, priority: 0 })), targetLineage: {}, wishlistOrder: [], wishlistExcluded: [], traineeCardId: sw.cardId, traineeStars: 3, aptOverrides: {}, raceOverrides: {}, pinnedIds: [], borrowFromAll: false, parentSparks: [[null, null, null], [null, null, null]] };
  const plainRun = planRun(base, settings, {}, data, { search: false });
  const selection = plainRun.deckResult.deck.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: e.borrowed }));
  const withRuns = planRun({ ...base, raceOverrides: Object.fromEntries(forced.forced) }, settings, {}, data, { selection, search: false });
  const secretOf = (p: typeof plainRun) => (p.existing.sources.get(stamina.id) ?? []).find((s) => s.kind === 'secret');
  assert.equal(secretOf(plainRun), undefined);
  assert.ok(secretOf(withRuns) && secretOf(withRuns)!.pObtain > 0);
  assert.ok((withRuns.deckResult.sparks.get(stamina.id) ?? 0) > (plainRun.deckResult.sparks.get(stamina.id) ?? 0));
});

test("the trainee's choice and outing events: choice-gated at their own rates, one option per event by prioritized order, a non-target option can block a target", () => {
  const pace = resolveTarget(byName('Pace Strategy').id, data)!;
  const choice = traineeSources(sw, pace, data, settings, new Map()).find((s) => s.kind === 'choice')!;
  assert.ok(choice && choice.isChoice && choice.pObtain === settings.charStoryEventRate, 'Pace Strategy is one option of a choice event');
  const haste = resolveTarget(byName('Homestretch Haste').id, data)!;
  const outing = traineeSources(sw, haste, data, { ...settings, charOutingRate: 0.3 }, new Map()).find((s) => s.kind === 'outing')!;
  assert.ok(outing && outing.isChoice && Math.abs(outing.pObtain - 0.3) < 1e-9);
  const all = traineeEventSources(sw, new Map(), settings, data);
  assert.ok(all.every((s) => s.event.key.startsWith('trainee:')) && !all.some((s) => s.kind === 'secret'), 'with no agenda no secret event can fire');
  const adept = resolveTarget(byName('Corner Adept ○').id, data)!;
  const targets = [haste, adept];
  const mk = (priority: number[]) => makeCtx({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee: sw, priority });
  const a = evaluate(traineeCoverage(targets, mk([...haste.familyIds])), targets, mk([...haste.familyIds]));
  const cf = a.conflicts.find((c) => c.eventKey.startsWith('trainee:outing'))!;
  assert.ok(cf && cf.taken.target === haste.id && !a.map.get(adept.id)!.some((s) => s.kind === 'outing'), 'Corner Adept loses the outing');
  const b = evaluate(traineeCoverage(targets, mk([...adept.familyIds])), targets, mk([...adept.familyIds]));
  assert.equal(b.conflicts.find((c) => c.eventKey.startsWith('trainee:outing'))!.taken.target, adept.id);
  const names = wishlistCandidates([], targets, mk([])).map((w) => w.name);
  assert.ok(names.includes('Homestretch Haste') && names.includes('Corner Adept ○'), `both options listed: ${names.join(', ')}`);
  assert.ok(wishlistCandidates([], [], mk([])).map((w) => w.name).includes('Pace Strategy'), 'trainee choice options are candidates');
  const blocked = evaluate(traineeCoverage([haste], mk([])), [haste], mk([byName('Corner Adept ○').id, ...haste.familyIds]));
  assert.equal(blocked.conflicts.length, 1);
  assert.equal(blocked.conflicts[0]!.taken.target, null, 'the non-target option takes the outing');
});

test("an alternate outfit's own events are decoded from its page, and a skill no decoded event gives uses the undecoded rate, not 100%", () => {
  const summer = data.characters.find((c) => c.cardId === 100102)!; // Special Week [Hopp'n♪Happy Heart]
  const fighter = resolveTarget(byName('Fighter').id, data)!;
  const own = traineeSources(summer, fighter, data, settings, new Map()).filter((s) => s.kind === 'story' || s.kind === 'choice');
  assert.ok(own.length && own.every((s) => !s.detail.includes('not decoded')), 'Fighter comes from her outfit event "To My Dear Mama"');
  assert.ok(!traineeSources(sw, fighter, data, settings, new Map()).length, 'the base outfit does not have that event');
  const offered = (c: typeof sw) => new Set(c.events.flatMap((e) => e.choices.flatMap((ch) => ch.outcomes.flat().flatMap((r) => (r.t === 'sk' && typeof r.d === 'number' ? [r.d] : r.t === 'sr' && Array.isArray(r.d) ? r.d.map((x) => x.d) : [])))));
  const stray = data.characters.map((c) => ({ c, id: c.eventSkills.find((id) => !offered(c).has(id)) })).find((x) => x.id != null);
  if (stray) {
    const target = resolveTarget(stray.id!, data)!;
    const src = traineeSources(stray.c, target, data, { ...settings, charUndecodedEventRate: 0.35 }, new Map()).find((s) => s.detail.includes('not decoded'))!;
    assert.ok(src && Math.abs(src.pObtain - 0.35) < 1e-9, `${stray.c.name}: ${target.name} is listed without a decoded event`);
  }
});
