import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from './helpers.ts';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { DEFAULT_GOAL, emptyPinkLineage } from '../src/model/goal-input.ts';
import { estimateFans, fansBeforeSlot } from '../src/model/fans.ts';
import { expectedRaceFans, lossPlace, raceFansForPlace, slotOf, type Aptitudes, type ScheduledRace } from '../src/model/races.ts';
import { parentSparksFromGains } from '../src/model/inherit.ts';
import { planRun, type RunInput } from '../src/model/run.ts';
import { uniqueSkillLevel } from '../src/model/rank.ts';
import { EFFECT, uniqueExtras } from '../src/model/stats.ts';
import { OUR_GRAND_CONCERT } from '../src/model/rules.ts';
import observations from '../docs/umamusume/fuji-independent-training-runs.json' with { type: 'json' };

const data = loadData();
const settings = { ...DEFAULT_SETTINGS, scenarioId: OUR_GRAND_CONCERT };
const shared = observations.shared;
const selection = shared.deck.map((d) => ({ id: d.id, lb: d.lb, borrowed: d.id === 30107 }));
const deck = selection.map((d) => ({ card: must(data.cardById.get(d.id)), lb: d.lb }));
const inventory = Object.fromEntries(selection.map((d) => [d.id, d.lb]));
const input: RunInput = {
  goal: structuredClone(DEFAULT_GOAL), pinkLineage: emptyPinkLineage(), targets: [], targetLineage: {},
  wishlistOrder: [], wishlistExcluded: [], traineeCardId: shared.traineeCardId, traineeStars: shared.stars,
  aptOverrides: observations.runs[0]!.reportedFinalAptitudes as Aptitudes, raceOverrides: {},
  pinnedIds: selection.map((d) => d.id), borrowFromAll: false, ignoredIds: [], borrowIgnored: false,
  parentSparks: shared.parentStartingGains.map((gains) => parentSparksFromGains(gains)!),
};
const chosen = new Map(shared.calendar.map((r) => [r.slot, r.name]));
input.raceOverrides = Object.fromEntries(data.races.map((r) => [r.calendarId, chosen.get(slotOf(r)) === r.name]));
const plan = planRun(input, settings, inventory, data, { selection, search: false });
const close = (got: number, want: number) => assert.ok(Math.abs(got - want) < 1e-7, `${got} != ${want}`);

test('loss-place table preserves third-place payouts and the boundaries around paying places', () => {
  assert.deepEqual([0.95, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0].map(lossPlace), [2, 2, 3, 3, 4, 4, 5, 6, 18]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 18].map((place) => raceFansForPlace(12000, place)), [12000, 4800, 3000, 1800, 1200, 0, 0]);
  const kikuka = must(plan.schedule.find((s) => s.selected && s.slot === 43));
  close(kikuka.pWin, 0.7);
  close(expectedRaceFans(kikuka), 9300); // 70% of 12,000 + 30% of 3,000
  close(expectedRaceFans({ ...kikuka, pWin: 1 }), 12000);
  close(expectedRaceFans({ ...kikuka, pWin: 0 }), 0);
});

test('the reported Fuji calendar and deck reproduce independent deterministic fan subtotals', () => {
  const calendar = plan.schedule.filter((s) => s.selected);
  assert.deepEqual(calendar.map((s) => ({ slot: s.slot, name: s.race.name })), shared.calendar);
  assert.equal(plan.sum.count, 19, 'finales do not consume calendar training turns');
  close(plan.sum.expectedWins, 18.1);
  close(plan.sum.expectedLosses, 0.9);
  assert.equal(plan.fans.bonus, 68);
  // All calendar wins: 249,600. Three 70% races have base rewards 12k, 15k, 30k.
  close(plan.fans.calendar, (249600 - 0.3 * 0.75 * 57000) * 1.68);
  close(plan.fans.finale, 78960); // (7,000 + 10,000 + 30,000) * 1.68
  close(plan.fans.concerts, 23300); // 15,000 + 90% * 9,000 + 10% * 2,000
  close(plan.sum.expectedFans, 500042);
  close(plan.sum.expectedFans, plan.fans.total);
  for (const [index, run] of observations.runs.entries()) {
    const base = calendar.reduce((n, s, i) => n + raceFansForPlace(s.race.fansGain, run.calendarPlaces[i]!), 0);
    assert.equal(base, [229350, 227100][index]);
    close((base + 47000) * 1.68, [464268, 460488][index]!);
    assert.equal(run.calendarPlaces.length, calendar.length);
    assert.deepEqual(run.finalePlaces, [1, 1, 1]);
    assert.equal(run.stats.length, 5);
    assert.ok(run.fans > 0 && run.rating > 0, `observed run ${index} recorded fans and a rating`);
  }
  // Observed fans and stats are measurements, not expected outputs of deterministic tests.
});

test('fan curves respect calendar timing and exclude finale rewards from every earlier checkpoint', () => {
  const concerts = estimateFans([], [], { ...settings, scenarioSongsRate: 1 });
  for (const [slot, before, after] of [[23, 0, 1000], [35, 1000, 3000], [47, 3000, 8500], [59, 8500, 15000], [71, 15000, 24000]]) {
    assert.equal(fansBeforeSlot(concerts, slot!), before);
    assert.equal(fansBeforeSlot(concerts, slot! + 1), after);
  }
  assert.equal(concerts.total, 71000);
  assert.equal(concerts.bySlot[72], 24000);
  assert.equal(fansBeforeSlot(concerts, 100), 24000);
  close(plan.ctx.fansBefore!(72), plan.fans.calendar + plan.fans.concerts);
  assert.equal(plan.rank.uniqueLevel, uniqueSkillLevel(3, plan.trainee!.aptitudes, plan.ctx.fansBefore!, settings));
});

test('concert outcomes are exclusive, configurable, and receive no unverified deck multiplier', () => {
  assert.equal(estimateFans([], deck, { ...settings, scenarioSongsRate: 1 }).concerts, 24000);
  assert.equal(estimateFans([], [], { ...settings, scenarioSongsRate: 0 }).concerts, 17000);
  assert.equal(estimateFans([], [], { ...settings, scenarioSongsRate: 0, concertGreatSuccessRate: 0 }).concerts, 1700);
  assert.equal(estimateFans([], [], { ...settings, scenarioSongsRate: 0.5, concertGreatSuccessRate: 0.5 }).concerts, 13300);
  const other = estimateFans([], deck, { ...settings, scenarioId: -1 });
  assert.equal(other.finale, 0);
  assert.equal(other.concerts, 0);
});

test('changing a selected LB updates fan checkpoints used by unique effects and rank checks', () => {
  const lower = selection.map((d) => d.id === 30052 ? { ...d, lb: 0 } : d);
  const lowInventory = { ...inventory, 30052: 0 };
  const low = planRun(input, settings, lowInventory, data, { selection: lower, search: false });
  assert.equal(low.fans.bonus, 65);
  close(plan.fans.calendar / low.fans.calendar, 1.68 / 1.65);
  assert.equal(plan.fans.concerts, low.fans.concerts);
  assert.ok(plan.ctx.fansBefore!(50) > low.ctx.fansBefore!(50), 'more fans by slot 50 with the higher limit break');
  const topRoad = must(data.cardById.get(30086));
  assert.ok(topRoad.unique?.effects.some((u) => u.type === 104), 'Narita Top Road carries the fan-ramp unique effect (type 104)');
  const manualRamp = plan.fans.bySlot.slice(0, 72).reduce((n, fans) => n + Math.min(20, Math.floor(fans / 10000)), 0) / 72;
  close(uniqueExtras(topRoad, 4, data.model, { fansBefore: plan.ctx.fansBefore })[EFFECT.trainingEff]!, manualRamp);
});

test('deck bonus includes basic unique effects and applies once to loss payouts', () => {
  const card = { ...deck[0]!.card, effectsByLb: [{ '16': 10, u16: 5 }] };
  const race = { ...must(plan.schedule.find((s) => s.selected && s.slot === 43), `plan.schedule.find((s) => s.selected && s.slot === 43)`), pWin: 0.7 } satisfies ScheduledRace;
  const fans = estimateFans([race], [{ card, lb: 0 }], settings);
  assert.equal(fans.bonus, 15);
  close(fans.calendar, 10695); // (8,400 + 900) * 1.15
});
