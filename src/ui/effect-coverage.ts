import { html, nothing } from 'lit-html';
import type { Card } from '../types.ts';
import { referenceObservation, type Contribution } from '../model/stats.ts';
import type { EffectCoverage } from '../model/support-effects.ts';
import { data } from './context.ts';

const OBSERVED_OMITTED = 'Not separately modelled';
const copy = {
  observed: (lb: number) => `Observed · LB${lb}`,
  adjusted: (lb: number) => `Adjusted · from LB${lb}`,
  predicted: 'Model estimate',
  observedDetail: (lb: number, runs: number, source: string) => `Uses community results at LB${lb} from ${source === 'loopacord' ? 'at least ' : ''}${runs} logged runs (${source}).`,
  adjustedDetail: (from: number, to: number) => `Estimates LB${to} by applying the model's predicted difference between LB${from} and LB${to}.`,
  modelDetail: 'Estimated from this card\'s support effects. No qualifying recorded results are available for this card.',
  /** One tooltip line per coverage status: the effects the formula leaves out, each with the outcomes it affects. */
  coverageLine: (status: string, effects: string[]) => `${status}: ${effects.join(', ')}.`,
  effectEntry: (name: string, outcomes: string[], detail?: string) => `${name}${detail ? ` "${detail}"` : ''} (${outcomes.join(', ')})`,
  recordedDeck: 'Fixed at the recorded deck conditions',
  teamEffect: 'Team effect estimated from starting bond, not measured directly',
  observedEffects: `Recorded stats and SP can already include these effects as part of the card's combined contribution. "${OBSERVED_OMITTED}" means the formula cannot isolate their contributions or adjust them individually.`,
  observedDeck: 'The recorded contribution stays fixed when deck-dependent effects change. No extra bonus is added on top of it.',
  statuses: { calculated: 'Calculated', approximated: 'Approximated', omitted: 'Not in formula', unrecognized: 'Not evaluated' },
  observedOmitted: OBSERVED_OMITTED,
  affects: (outcomes: string[]) => `Affects ${outcomes.join(', ')}.`,
  outcomes: { stats: 'stats', sp: 'SP', fans: 'fans', skills: 'skills', unknown: 'an outcome not yet evaluated' },
  reasons: {
    direct: 'Applied directly to its related estimate.',
    fitted: 'Included through a fitted relationship with recorded results.',
    hints: 'Used to estimate how often the card offers skill hints.',
    hintLevels: 'Hint levels do not change the current skill-cost estimate.',
    fanBonus: 'Added to the deck\'s Fan Bonus for the fan estimate.',
    bondShare: (share: number) => `Assumes the bond threshold is reached for ${share}% of the run.`,
    deckTypes: 'The formula checks the number of support types in the deck.',
    deckInitialStats: 'The formula counts support types in the deck to determine starting stats.',
    fans: 'Uses the agenda\'s estimated fans when available, otherwise the model\'s assumed active share.',
    friendshipCount: (share: number) => `Assumes the friendship-training threshold is reached for ${share}% of the run.`,
    totalBond: (share: number) => `Uses the model\'s total-bond assumption for ${share}% of the run.`,
    facilityLevel: (share: number) => `Assumes maximum facility level for ${share}% of the run.`,
    initialBond: 'The formula does not adjust these estimates for starting bond.',
    teamBond: 'Estimates the team bonus using the fitted starting-bond relationship. The team effect has not been measured directly.',
    raceBonus: 'The stat and SP reward baseline does not adjust for this deck\'s Race Bonus.',
    notFitted: 'This effect has no fitted contribution in the current formula.',
    notRetained: 'Tested as an extra input, but not selected for this estimate. That does not mean the effect has no impact.',
    insufficientData: 'There are too few suitable measurements to judge this effect for this estimate.',
    unsupported: 'This effect is recognized but is not included in the formula.',
    unknown: 'This effect has not been evaluated by the model.',
    unknownPayload: 'The imported effect contains parameters the model does not yet understand.',
    rewardFlag: 'Some skill rewards carry a source flag whose meaning has not been verified. Their probabilities are not adjusted for that flag.',
  },
} as const;
export const missingEffect = (effect: EffectCoverage) => effect.status === 'omitted' || effect.status === 'unrecognized';
const affectsContribution = (effect: EffectCoverage) => effect.outcomes.some((outcome) => outcome === 'stats' || outcome === 'sp' || outcome === 'unknown');
export const observedDeckEffect = (effect: EffectCoverage) => effect.deckDependent && affectsContribution(effect);

export function basisLabel(card: Card, lb: number, source: Contribution['source']) {
  if (source === 'model') return copy.predicted;
  const observed = referenceObservation(card, lb, data.model);
  return source === 'observed' ? copy.observed(lb) : copy.adjusted(observed?.lb ?? lb);
}

/** The status shown next to an effect. A recorded contribution already includes an omitted effect, so it is "not
 * separately modelled" there rather than "not in formula". */
function statusLabel(effect: EffectCoverage, source: Contribution['source']) {
  return source !== 'model' && effect.status === 'omitted' && affectsContribution(effect) ? copy.observedOmitted : copy.statuses[effect.status];
}

/** The per-card facts behind a Basis label, as tooltip text: the source of the estimate, then one line per status
 * listing the effects the formula leaves out, the unmeasured team effect, and deck-dependent effects a recorded
 * contribution keeps fixed. Effects covered by the formula are not listed; the panel notes explain the shared rules. */
export function basisTip(card: Card, lb: number, source: Contribution['source'], effects: EffectCoverage[]) {
  const observed = source === 'model' ? undefined : referenceObservation(card, lb, data.model);
  const lines = observed
    ? [copy.observedDetail(observed.lb, observed.runs, observed.source), ...(source === 'observed+model' ? [copy.adjustedDetail(observed.lb, lb)] : [])]
    : [copy.modelDetail];
  const groups = new Map<string, string[]>();
  const add = (label: string, effect: EffectCoverage) => {
    const detail = effect.description && effect.description === card.unique?.text ? effect.description : undefined;
    const entry = copy.effectEntry(effect.name, effect.outcomes.map((outcome) => copy.outcomes[outcome]), detail);
    const entries = groups.get(label) ?? [];
    if (!entries.includes(entry)) groups.set(label, [...entries, entry]);
  };
  for (const effect of effects) {
    if (missingEffect(effect)) add(statusLabel(effect, source), effect);
    else if (effect.reason === 'teamBond') add(copy.teamEffect, effect);
    else if (source !== 'model' && observedDeckEffect(effect)) add(copy.recordedDeck, effect);
  }
  return [...lines, ...[...groups].map(([label, entries]) => copy.coverageLine(label, entries))].join('\n');
}

export function observedCaveat(source: Contribution['source'], effects: EffectCoverage[]) {
  if (source === 'model') return nothing;
  const missing = effects.some((effect) => missingEffect(effect) && affectsContribution(effect));
  return html`${missing ? html`<p>${copy.observedEffects}</p>` : nothing}
    ${effects.some(observedDeckEffect) ? html`<p>${copy.observedDeck}</p>` : nothing}`;
}

/** A warning worth a tag in the ranking row: an effect the model has not evaluated at all, or a card whose every
 * effect is outside the formula. Nearly every card has some effect the formula leaves out, so that alone is not flagged. */
export function coverageFlag(effects: EffectCoverage[]) {
  if (effects.some((effect) => effect.status === 'unrecognized')) return copy.statuses.unrecognized;
  if (effects.length && effects.every(missingEffect)) return copy.statuses.omitted;
  return undefined;
}

function effectReason(effect: EffectCoverage): string {
  const reason = copy.reasons[effect.reason];
  return typeof reason === 'function' ? reason(Math.round(data.model.uniqueRampShare * 100)) : reason;
}

export function effectList(effects: EffectCoverage[], { compact = false, source = 'model' }: { compact?: boolean; source?: Contribution['source'] } = {}) {
  return html`<ul class="effect-coverage">${effects.map((effect) => html`<li data-effect-coverage=${effect.key} data-effect-status=${effect.status}>
    <span>${effect.name}</span><span class="tag ${missingEffect(effect) ? 'warn' : ''}">${statusLabel(effect, source)}</span>
    ${(!compact || effect.key.startsWith('unique:') || effect.status === 'unrecognized') && effect.description && effect.description !== effect.name ? html`<p>${effect.description}</p>` : nothing}
    <p class="muted">${!compact || effect.reason === 'teamBond' ? effectReason(effect) : nothing} ${copy.affects(effect.outcomes.map((outcome) => copy.outcomes[outcome]))}</p>
  </li>`)}</ul>`;
}
