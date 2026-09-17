import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from './helpers.ts';
import { loadData } from '../src/data.ts';
import { buildDeck, makeCtx } from '../src/model/deck.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import type { Card, StatModel } from '../src/types.ts';

test('deck selection and borrow gains include starting bond supplied to teammates', () => {
  const data = loadData();
  const support = (id: number, passives: Record<string, number> = {}): Card => ({
    ...structuredClone(must(data.cardById.get(10001), `data.cardById.get(10001)`)), id, charId: id, type: 'speed', unique: null,
    effectsByLb: Array.from({ length: 5 }, () => ({ ...passives })),
  });
  const recipient = support(99001);
  const donor = support(99002);
  donor.unique = { level: 40, fromLb: 2, effects: [{ type: 115, value: 14, value_1: 5 }] };
  const alternative = support(99003, { 9: 25 });
  const model: StatModel = { ...data.model, floor: 0, roleConstants: { 'speed.primary': 100, 'speed.secondary': 50 },
    slopes: { fr: 0, mo: 0, te: 0, sb: 0 }, effectSlopes: { 14: 2 },
    sp: { base: 0, wit: 0, friend: 0, skillPointBonus: 0 }, observed: [] };
  const ctx = makeCtx({ data: { ...data, model }, settings: { ...DEFAULT_SETTINGS, focus: 'balanced' }, races: model.races.reference,
    totalTurns: model.races.totalTurns, trainee: null });
  const build = (lb: number) => buildDeck([{ card: recipient, lb: 0 }], [], ctx, {
    pinnedIds: [recipient.id], size: 2, borrowPool: [{ card: donor, lb }, { card: alternative, lb: 4 }],
  });

  // Each card supplies 150 before bonuses. The alternative adds 25; the donor adds
  // 5 bond * 2 points * 2 stat roles to both cards, for 40 across the deck.
  const unlocked = build(2);
  assert.equal(unlocked.borrow?.card.id, donor.id);
  assert.equal(unlocked.deck.reduce((sum, entry) => sum + entry.statPower, 0), 340);
  assert.equal(unlocked.borrow?.statGain, 190);
  assert.equal(unlocked.borrowAlternatives.find((entry) => entry.card.id === alternative.id)?.statGain, 175);
  const locked = build(1);
  assert.equal(locked.borrow?.card.id, alternative.id);
  assert.equal(locked.deck.reduce((sum, entry) => sum + entry.statPower, 0), 325);
  assert.equal(locked.borrowAlternatives.find((entry) => entry.card.id === donor.id)?.statGain, 150);
});
