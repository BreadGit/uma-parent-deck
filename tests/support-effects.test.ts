import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { cardEffectCoverage, teamInitialBond, uniqueExtras, uniqueNote } from '../src/model/support-effects.ts';
import { cardContribution, modelContribution, referenceObservation } from '../src/model/stats.ts';
import { describeDeck, makeCtx } from '../src/model/deck.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import type { Card, StatModel } from '../src/types.ts';

const data = loadData();
const card = (id: number) => structuredClone(data.cardById.get(id)!);
const plainModel: StatModel = { ...data.model, effectSlopes: {}, sp: { ...data.model.sp, effectSlopes: {} }, evaluation: undefined };

test('coverage respects unique unlocks and exposes mixed, unfamiliar, and nested unsupported effects', () => {
  const ardan = card(30119);
  assert.ok(!cardEffectCoverage(ardan, 1, plainModel).some((e) => e.key.startsWith('unique:')));
  assert.equal(cardEffectCoverage(ardan, 2, plainModel).find((e) => e.key === 'unique:0')?.status, 'approximated');
  ardan.unique!.effects.push({ type: 98765, value: 3 });
  const mixed = cardEffectCoverage(ardan, 2, plainModel).filter((e) => e.key.startsWith('unique:'));
  assert.deepEqual(mixed.map((e) => e.status), ['approximated', 'unrecognized']);
  ardan.unique!.effects = [{ type: 101, value: 80, value_1: 3, value_2: 1, value_3: 14, value_4: 5 }];
  const nested = cardEffectCoverage(ardan, 2, plainModel).filter((e) => e.key.startsWith('unique:'));
  assert.deepEqual(nested.map((e) => e.status), ['approximated', 'omitted']);
  assert.equal(nested[1]!.reason, 'initialBond');
  ardan.unique!.effects = [{ type: 101, value: 80, value_1: 16, value_2: 5 }];
  assert.equal(cardEffectCoverage(ardan, 2, plainModel).find((e) => e.key.startsWith('unique:'))?.status, 'omitted', 'compound fan extras do not reach the fan formula');
  ardan.effectsByLb[2]!['98765'] = -5;
  assert.equal(cardEffectCoverage(ardan, 2, plainModel).find((e) => e.key === 'effect:98765')?.status, 'unrecognized');
});

test('unknown payloads and text-only unique effects remain visible without guessed calculations', () => {
  const sasami = card(30080);
  const textOnly = cardEffectCoverage(sasami, 4, data.model).find((e) => e.key === 'unique:text');
  assert.equal(textOnly?.status, 'unrecognized');
  assert.match(textOnly!.description, /random events/);
  const ardan = card(30119);
  Object.assign(ardan.unique!.effects[0]!, { value_5: 99 });
  assert.equal(cardEffectCoverage(ardan, 4, data.model).find((e) => e.key === 'unique:0')?.reason, 'unknownPayload');
  assert.deepEqual(uniqueExtras(ardan, 4, data.model), {});
  assert.ok(cardEffectCoverage(card(30098), 4, data.model).some((e) => e.key === 'hints:source'));
});

test('coverage tracks retained numeric inputs and distinguishes output types', () => {
  const oguri = card(30146);
  const fitted: StatModel = { ...plainModel, effectSlopes: { 14: 2 }, sp: { ...plainModel.sp, effectSlopes: { 25: 3 } } };
  oguri.effectsByLb[4]!['25'] = 10;
  const coverage = cardEffectCoverage(oguri, 4, fitted);
  assert.equal(coverage.find((e) => e.key === 'effect:14')?.status, 'approximated');
  assert.deepEqual(coverage.find((e) => e.key === 'effect:25')?.outcomes, ['sp']);
  assert.equal(coverage.find((e) => e.key === 'unique:0')?.reason, 'teamBond');
  assert.equal(cardEffectCoverage(oguri, 4, plainModel).find((e) => e.key === 'unique:0')?.status, 'omitted');
});

test('fitted inputs preserve omissions for other outcomes, including ordinary and compound uniques', () => {
  const support = card(30146);
  const fitted: StatModel = { ...plainModel, sp: { ...plainModel.sp, effectSlopes: { 17: -1, 18: 1, 19: 2, 31: 3 } } };
  const outcomes = (entries: ReturnType<typeof cardEffectCoverage>, key: string) => entries.filter((e) => e.key === key || e.key.startsWith(`${key}:`))
    .map((e) => ({ status: e.status, reason: e.reason, outcomes: e.outcomes }));
  const coverage = cardEffectCoverage(support, 4, fitted);
  assert.deepEqual(outcomes(coverage, 'effect:17'), [
    { status: 'approximated', reason: 'fitted', outcomes: ['sp'] },
    { status: 'omitted', reason: 'hintLevels', outcomes: ['skills'] },
  ]);
  for (const id of [19, 31]) assert.deepEqual(outcomes(coverage, `effect:${id}`), [
    { status: 'approximated', reason: 'fitted', outcomes: ['sp'] },
    { status: 'omitted', reason: 'notFitted', outcomes: ['stats'] },
  ]);
  support.unique!.effects = [{ type: 17, value: 1 }];
  assert.deepEqual(outcomes(cardEffectCoverage(support, 4, fitted), 'unique:0'), outcomes(coverage, 'effect:17'));
  support.unique!.effects = [{ type: 101, value: 80, value_1: 17, value_2: 1, value_3: 19, value_4: 5 }];
  assert.deepEqual(outcomes(cardEffectCoverage(support, 4, fitted), 'unique:0'), [
    { status: 'approximated', reason: 'bondShare', outcomes: ['sp'] },
    { status: 'omitted', reason: 'hintLevels', outcomes: ['skills'] },
    { status: 'omitted', reason: 'notFitted', outcomes: ['stats'] },
  ]);
  support.unique!.effects = [{ type: 101, value: 80, value_1: 18, value_2: 5 }];
  assert.deepEqual(outcomes(cardEffectCoverage(support, 4, fitted), 'unique:0'), [
    { status: 'approximated', reason: 'bondShare', outcomes: ['sp'] },
    { status: 'omitted', reason: 'unsupported', outcomes: ['skills'] },
  ], 'compound hint-frequency extras reach SP but not the hint formula');
});

test('descriptive unique metadata does not change coverage or calculations, but unknown mechanics still block them', () => {
  const ardan = card(30119);
  const expected = uniqueExtras(ardan, 4, data.model);
  Object.assign(ardan.unique!.effects[0]!, { description: 'Extra explanation', name_en: 'Translated effect', title_ja: 'Title' });
  assert.deepEqual(uniqueExtras(ardan, 4, data.model), expected);
  assert.equal(cardEffectCoverage(ardan, 4, data.model).find((e) => e.key === 'unique:0')?.status, 'approximated');
  Object.assign(ardan.unique!.effects[0]!, { name_en: 3 });
  assert.deepEqual(uniqueExtras(ardan, 4, data.model), {});
  assert.equal(cardEffectCoverage(ardan, 4, data.model).find((e) => e.key === 'unique:0')?.reason, 'unknownPayload');

  const donor = card(30146);
  Object.assign(donor.unique!.effects[0]!, { description: 'Team starting bond', name_en: 'Team effect' });
  assert.equal(teamInitialBond([{ card: donor, lb: 4 }]), 5);
  assert.equal(cardEffectCoverage(donor, 4, data.model).find((e) => e.key === 'unique:0')?.reason, 'teamBond');
  assert.match(uniqueNote(donor, data.model), /\+5 starting bond.*approximated/);
  assert.match(uniqueNote(donor, plainModel), /left out/);
  Object.assign(donor.unique!.effects[0]!, { multiplier: 2 });
  assert.equal(teamInitialBond([{ card: donor, lb: 4 }]), 0);
  assert.equal(cardEffectCoverage(donor, 4, data.model).find((e) => e.key === 'unique:0')?.reason, 'unknownPayload');

  donor.unique!.effects = [Object.assign({ type: 8, value: 5 }, { description: 'Ordinary unique', name_en: 'Training' })];
  assert.equal(cardEffectCoverage(donor, 4, data.model).find((e) => e.key === 'unique:0')?.status, 'approximated');
  Object.assign(donor.unique!.effects[0]!, { condition: { bond: 80 } });
  assert.equal(cardEffectCoverage(donor, 4, data.model).find((e) => e.key === 'unique:0')?.reason, 'unknownPayload');
});

test('omission explanations distinguish evaluated inputs from unevaluated inputs without hiding specific limitations', () => {
  const support = card(30146);
  support.effectsByLb[4]!['29'] = 5;
  const shipped = cardEffectCoverage(support, 4, data.model);
  assert.equal(shipped.find((e) => e.key === 'effect:19:omitted')?.reason, 'notRetained');
  assert.equal(shipped.find((e) => e.key === 'effect:29')?.reason, 'insufficientData');
  assert.equal(shipped.find((e) => e.key === 'effect:17:omitted')?.reason, 'hintLevels');
  assert.equal(shipped.find((e) => e.key === 'effect:15')?.reason, 'raceBonus');
  const unevaluated = cardEffectCoverage(support, 4, plainModel);
  assert.equal(unevaluated.find((e) => e.key === 'effect:19')?.reason, 'notFitted');
  assert.equal(unevaluated.find((e) => e.key === 'effect:29')?.reason, 'notFitted');
  const differing: StatModel = { ...plainModel, evaluation: {
    stats: { inputs: [{ effectId: 29, status: 'insufficient-data' }] },
    sp: { inputs: [{ effectId: 29, status: 'tested-not-retained' }] },
  } };
  assert.equal(cardEffectCoverage(support, 4, differing).find((e) => e.key === 'effect:29')?.reason, 'notFitted', 'different outcome histories use a conservative explanation');
});

test('team starting bond reaches each formula recipient once, respects the donor LB, and leaves observations fixed', () => {
  const donor = card(30146);
  donor.unique!.fromLb = 2;
  const recipient: Card = { ...card(10001), type: 'speed', unique: null, effectsByLb: [{ 14: 10 }, {}, {}, {}, {}] };
  const model: StatModel = { ...plainModel, floor: 0, roleConstants: { 'speed.primary': 100, 'speed.secondary': 50 },
    slopes: { fr: 0, mo: 0, te: 0, sb: 0 }, effectSlopes: { 14: 2 },
    sp: { base: 30, wit: 0, friend: 0, skillPointBonus: 0, effectSlopes: { 14: 3 } }, observed: [] };
  const deck = [{ card: donor, lb: 1 }, { card: recipient, lb: 0 }];
  assert.equal(teamInitialBond(deck), 0);
  assert.deepEqual(uniqueExtras(recipient, 0, model, { deck }), {});
  deck[0]!.lb = 2;
  assert.equal(teamInitialBond(deck), 5);
  const extra = uniqueExtras(recipient, 0, model, { deck });
  assert.deepEqual(extra, { 14: 5 });
  assert.deepEqual(modelContribution(recipient, 0, model, extra), { stats: [130, 0, 80, 0, 0], sp: 75 });
  const ctx = makeCtx({ data: { ...data, model }, settings: DEFAULT_SETTINGS, races: model.races.reference, totalTurns: model.races.totalTurns, trainee: null });
  const described = describeDeck(deck, [], ctx).deck.find((entry) => entry.card.id === recipient.id)!;
  assert.deepEqual(described.stats, [130, 0, 80, 0, 0]);
  assert.equal(described.sp, 75);
  model.observed = [{ cardId: recipient.id, lb: 0, source: 'test', runs: 10, wellTested: true, stats: [90, 1, 40, 2, 3], sp: 60 }];
  assert.deepEqual(cardContribution(recipient, 0, model, extra), { stats: [90, 1, 40, 2, 3], sp: 60, source: 'observed', runs: 10 });
  assert.equal(referenceObservation(recipient, 0, model), model.observed[0]);
  assert.equal(referenceObservation(recipient, 1, model), model.observed[0]);
});

test('adjusted observations stay fixed when team bonuses would cross a formula clamp', () => {
  const recipient: Card = { ...card(10001), type: 'speed', unique: null, effectsByLb: [{ 14: 10 }, {}, {}, {}, {}] };
  const model: StatModel = { ...plainModel, floor: 0, roleConstants: { 'speed.primary': -15, 'speed.secondary': -15 },
    slopes: { fr: 0, mo: 0, te: 0, sb: 0 }, effectSlopes: { 14: 2 },
    sp: { base: -15, wit: 0, friend: 0, skillPointBonus: 0, effectSlopes: { 14: 2 } },
    observed: [{ cardId: recipient.id, lb: 1, source: 'test', runs: 10, wellTested: true, stats: [100, 1, 50, 2, 3], sp: 80 }] };
  const without = cardContribution(recipient, 0, model);
  assert.deepEqual(without.stats, [105, 1, 55, 2, 3]);
  assert.equal(without.sp, 85);
  assert.deepEqual(cardContribution(recipient, 0, model, { 14: 5 }), without);
});
