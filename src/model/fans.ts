import type { Card } from '../types.ts';
import type { Settings } from '../settings.ts';
import { expectedRaceFans, type ScheduledRace } from './races.ts';
import { CONCERT_FANS, GRAND_CONCERT_FANS, OUR_GRAND_CONCERT, SCENARIO_FINALE_FANS, SLOT_COUNT } from './rules.ts';
import { EFFECT, passives } from './stats.ts';

export interface FanEstimate {
  bonus: number;       // percentage points from the selected deck
  calendar: number;    // expected placing rewards, including the deck bonus
  finale: number;      // conditional on completing the scenario
  concerts: number;   // expected scenario event rewards
  total: number;
  bySlot: number[];    // fans before slot 0..72, excluding finales
}

/** Completed-run fans. Random race reward increases and bonuses on concert rewards remain unverified. */
export function estimateFans(schedule: ScheduledRace[], deck: { card: Card; lb: number }[], settings: Settings): FanEstimate {
  const bonus = deck.reduce((n, d) => n + (passives(d.card, d.lb)[EFFECT.fanBonus] ?? 0), 0);
  const multiplier = 1 + bonus / 100;
  const gains = Array<number>(SLOT_COUNT).fill(0);
  let calendar = 0, concerts = 0;
  for (const s of schedule) if (s.selected) {
    const fans = expectedRaceFans(s) * multiplier;
    calendar += fans;
    gains[s.slot]! += fans;
  }
  if (settings.scenarioId === OUR_GRAND_CONCERT) {
    const reward = (success: number, great: number) => success + settings.concertGreatSuccessRate * (great - success);
    for (const c of CONCERT_FANS) {
      const fans = reward(c.success, c.great);
      concerts += fans;
      gains[c.slot]! += fans;
    }
    const c = GRAND_CONCERT_FANS;
    const fans = settings.scenarioSongsRate * c.special + (1 - settings.scenarioSongsRate) * reward(c.success, c.great);
    concerts += fans;
    gains[c.slot]! += fans;
  }
  const bySlot = [0];
  for (const gain of gains) bySlot.push(bySlot.at(-1)! + gain);
  const finale = (SCENARIO_FINALE_FANS[settings.scenarioId] ?? []).reduce((n, fans) => n + fans * multiplier, 0);
  return { bonus, calendar, finale, concerts, total: calendar + finale + concerts, bySlot };
}

export const fansBeforeSlot = (fans: FanEstimate, slot: number): number => fans.bySlot[Math.max(0, Math.min(SLOT_COUNT, slot))] ?? 0;
