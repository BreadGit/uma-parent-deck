import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from './helpers.ts';
import { loadData } from '../src/data.ts';
import { describeDeck, makeCtx } from '../src/model/deck.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import type { Card, StatModel } from '../src/types.ts';

test('deck estimates include starting bond supplied to teammates', () => {
  const data = loadData();
  const support = (id: number, passives: Record<string, number> = {}): Card => ({
    ...structuredClone(must(data.cardById.get(10001))), id, charId: id, type: 'speed', unique: null,
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
  const describe = (card: Card, lb: number) => describeDeck([{ card: recipient, lb: 0 }, { card, lb, borrowed: true }], [], ctx);
  const power = (card: Card, lb: number) => describe(card, lb).deck.reduce((sum, entry) => sum + entry.statPower, 0);

  // Each card supplies 150 before bonuses. The alternative adds 25; the donor adds
  // 5 bond * 2 points * 2 stat roles to both cards, for 40 across the deck.
  assert.equal(power(donor, 2), 340);
  assert.equal(power(donor, 1), 300);
  assert.equal(power(alternative, 4), 325);
  assert.equal(describe(donor, 2).deck.find((entry) => entry.borrowed)?.card.id, donor.id);
});
