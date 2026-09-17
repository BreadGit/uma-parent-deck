import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSupportEffects, normalizeSupportMechanics, validateSupportCards } from '../scripts/support-import.ts';
import cards from '../data/cards.json' with { type: 'json' };

const sourceCard = () => ({
  support_id: 99001, rarity: 3, release_en: '2026-09-01',
  effects: [[1, 0, 0, 0, 0, 0, 0, 10, 15, 20, 25, 30]],
  unique: { level: 40, effects: [{ type: 8, value: 5 }] },
});

test('support import preserves unfamiliar passive IDs, descriptions and level values', () => {
  const card = sourceCard();
  card.effects.push([987, -1, -1, -1, -1, -1, -1, -1, 5, -1, 10, -1]);
  const result = normalizeSupportMechanics(card);
  assert.deepEqual(result.effectsByLb.map((row) => row[987] ?? 0), [0, 5, 7, 10, 10]);
  assert.deepEqual(normalizeSupportEffects([{ id: 987, name_en: 'Future bonus', desc_en: 'A newly imported effect.' }]), [
    { id: 987, name: 'Future bonus', description: 'A newly imported effect.', symbol: 'none', calc: 'add' },
  ]);
  assert.equal(normalizeSupportEffects([{ id: 988 }])[0]!.name, 'Support effect 988');
});

test('support import preserves unfamiliar unique types, new payload parameters and cached descriptions', () => {
  const effect = { type: 998, value: 14, value_1: 5, value_7: 12, team: { types: ['speed'] }, description: 'Future team bonus' };
  const card = { ...sourceCard(), unique: { level: 40, effects: [effect] } };
  const result = normalizeSupportMechanics(card, 'All support cards gain a future bonus.');
  assert.deepEqual(result.unique?.effects, [effect]);
  assert.equal(result.unique?.text, 'All support cards gain a future bonus.');
  assert.equal(result.unique?.fromLb, 2);
  assert.ok(result.effectsByLb.every((row) => !('u998' in row)));
  const knownType = { ...card, unique: { level: 40, effects: [{ type: 101, value: 80, value_1: 8, value_2: 10, value_7: 12 }] } };
  assert.equal(normalizeSupportMechanics(knownType).unique?.effects[0]!.value_7, 12);
});

test('support import preserves source-only descriptions, including text-only unique effects', () => {
  const card = { ...sourceCard(), unique: { level: 30, effects: [] }, unique_desc: 'Special events are more likely to occur.' };
  assert.equal(normalizeSupportMechanics(card).unique?.text, card.unique_desc);
  assert.equal(normalizeSupportMechanics({ ...sourceCard(), unique: { level: 30, effects: [], description: 'Source description' } }).unique?.text, 'Source description');
  assert.equal(cards.find((card) => card.id === 30080)!.unique?.text, 'Sasami Anshinzawa random events are more likely to occur');
});

test('support import retains level-dependent hint reward payloads', () => {
  const rewards = [[{ hint_type: 2, hint_value: 2 }], { level: 30, stats: [{ hint_type: 2, hint_value: 4 }] }];
  const result = normalizeSupportMechanics({ ...sourceCard(), hints: { hint_others: rewards } });
  assert.deepEqual(result.hintOthersSource, rewards);
  assert.ok(cards.find((card) => card.id === 30098)!.hintOthersSource?.length);
  assert.throws(() => normalizeSupportMechanics({ ...sourceCard(), hints: { hint_others: [{ level: 30, stats: 'changed format' }] } }), /must contain an unlock level and a stats array/);
});

test('support import detects newly added mechanic fields without rejecting unrelated metadata', () => {
  for (const field of ['team_effects', 'trainingModifiers', 'starting_bond_bonus']) {
    assert.throws(() => validateSupportCards([{ ...sourceCard(), [field]: [{ type: 14, value: 5 }] }]), new RegExp(`card 99001\\.${field} is an unfamiliar mechanic field`));
  }
  assert.doesNotThrow(() => validateSupportCards([{ ...sourceCard(), artwork_credit: 'An artist', title_fr: 'A title' }]));
  assert.throws(() => validateSupportCards([{ ...sourceCard(), hints: { team_hints: [123] } }]), /hints.team_hints is an unfamiliar mechanic field/);
  assert.throws(() => validateSupportCards([{ ...sourceCard(), future: { effects: [] } }]), /future.effects is an unfamiliar mechanic field/);
  const card = sourceCard();
  assert.throws(() => validateSupportCards([{ ...card, unique: { ...card.unique, conditions: { minimum_bond: 80 } } }]), /unique.conditions is an unfamiliar mechanic field/);
});

test('support import rejects new basic unique parameters before treating the effect as unconditional', () => {
  const card = sourceCard();
  assert.throws(() => normalizeSupportMechanics({ ...card, unique: { level: 30, effects: [{ type: 8, value: 5, value_1: 99 }] } }), /value_1 cannot be folded into an ordinary passive/);
  const result = normalizeSupportMechanics({ ...card, unique: { level: 30, description: 'Training Effectiveness', effects: [{ type: 8, value: 5, description: 'Training Effectiveness', name_en: 'Training bonus' }] } });
  assert.equal(result.effectsByLb[0]!.u8, 5);
  assert.equal(result.unique?.effects[0]!.description, 'Training Effectiveness');
});

test('support import rejects malformed or ambiguous effect structures instead of losing data', () => {
  const card = sourceCard();
  const invalid = [
    { ...card, effects: { 1: [10] } },
    { ...card, effects: [[1, 10]] },
    { ...card, effects: [card.effects[0], card.effects[0]] },
    { ...card, unique: { level: 40, effects: { type: 8, value: 5 } } },
    { ...card, unique: { level: 40, effects: [{ type: 101, value: 80, value_1: '5' }] } },
    { ...card, hints: { hint_others: [null] } },
    { ...card, unique: null, unique_desc: 'A unique without an unlock level' },
  ];
  for (const value of invalid) assert.throws(() => validateSupportCards([value]), /Support import: card 99001/);
  assert.throws(() => normalizeSupportEffects([{ id: 1, desc_en: ['changed format'] }]), /desc_en must be text/);
  assert.throws(() => normalizeSupportEffects([{ id: 1, team_bonus: 5 }]), /team_bonus is an unfamiliar mechanic field/);
});

test('support import keeps unlock behavior and basic unique passives unchanged', () => {
  const result = normalizeSupportMechanics(sourceCard());
  assert.deepEqual(result.effectsByLb.map((row) => row.u8 ?? 0), [0, 0, 5, 5, 5]);
  assert.deepEqual(result.effectsByLb.map((row) => row[1]), [10, 15, 20, 25, 30]);
});
