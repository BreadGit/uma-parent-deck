import { html, nothing } from 'lit-html';
import type { Card } from '../types.ts';
import { referenceObservation, type Contribution } from '../model/stats.ts';
import { EFFECT_COVERAGE_REASONS, type EffectCoverage } from '../model/support-effects.ts';
import { data } from './context.ts';

const OBSERVED_OMITTED = 'Not separately modelled';
const STATUS_LABELS = { calculated: 'Calculated', approximated: 'Approximated', omitted: 'Not in formula', unrecognized: 'Not evaluated' };
const OUTCOME_LABELS = { stats: 'stats', sp: 'SP', fans: 'fans', skills: 'skills', unknown: 'an outcome not yet evaluated' };
export const missingEffect = (effect: EffectCoverage) => effect.status === 'omitted' || effect.status === 'unrecognized';
const affectsContribution = (effect: EffectCoverage) => effect.outcomes.some((outcome) => outcome === 'stats' || outcome === 'sp' || outcome === 'unknown');
export const observedDeckEffect = (effect: EffectCoverage) => effect.deckDependent && affectsContribution(effect);

export function basisLabel(card: Card, lb: number, source: Contribution['source']) {
  if (source === 'model') return 'Model estimate';
  const observed = referenceObservation(card, lb, data.model);
  return source === 'observed' ? `Observed · LB${lb}` : `Adjusted · from LB${observed?.lb ?? lb}`;
}

/** The status shown next to an effect. A recorded contribution already includes an omitted effect, so it is "not
 * separately modelled" there rather than "not in formula". */
function statusLabel(effect: EffectCoverage, source: Contribution['source']) {
  return source !== 'model' && effect.status === 'omitted' && affectsContribution(effect) ? OBSERVED_OMITTED : STATUS_LABELS[effect.status];
}

/** The per-card facts behind a Basis label, as tooltip text: the source of the estimate, then one line per status
 * listing the effects the formula leaves out, the unmeasured team effect, and deck-dependent effects a recorded
 * contribution keeps fixed. Effects covered by the formula are not listed; the panel notes explain the shared rules. */
export function basisTip(card: Card, lb: number, source: Contribution['source'], effects: EffectCoverage[]) {
  const observed = source === 'model' ? undefined : referenceObservation(card, lb, data.model);
  const lines = observed
    ? [`Uses community results at LB${observed.lb} from ${observed.source === 'loopacord' ? 'at least ' : ''}${observed.runs} logged runs (${observed.source}).`,
      ...(source === 'observed+model' ? [`Estimates LB${lb} by applying the model's predicted difference between LB${observed.lb} and LB${lb}.`] : [])]
    : ['Estimated from this card\'s support effects. No qualifying recorded results are available for this card.'];
  const groups = new Map<string, string[]>();
  const add = (label: string, effect: EffectCoverage) => {
    const detail = effect.description && effect.description === card.unique?.text ? effect.description : undefined;
    const entry = `${effect.name}${detail ? ` "${detail}"` : ''} (${effect.outcomes.map((outcome) => OUTCOME_LABELS[outcome]).join(', ')})`;
    const entries = groups.get(label) ?? [];
    if (!entries.includes(entry)) groups.set(label, [...entries, entry]);
  };
  for (const effect of effects) {
    if (missingEffect(effect)) add(statusLabel(effect, source), effect);
    else if (effect.reason === 'teamBond') add('Team effect estimated from starting bond, not measured directly', effect);
    else if (source !== 'model' && observedDeckEffect(effect)) add('Fixed at the recorded deck conditions', effect);
  }
  return [...lines, ...[...groups].map(([label, entries]) => `${label}: ${entries.join(', ')}.`)].join('\n');
}

export function observedCaveat(source: Contribution['source'], effects: EffectCoverage[]) {
  if (source === 'model') return nothing;
  const missing = effects.some((effect) => missingEffect(effect) && affectsContribution(effect));
  return html`${missing ? html`<p>Recorded stats and SP can already include these effects as part of the card's combined contribution. "${OBSERVED_OMITTED}" means the formula cannot isolate their contributions or adjust them individually.</p>` : nothing}
    ${effects.some(observedDeckEffect) ? html`<p>The recorded contribution stays fixed when deck-dependent effects change. No extra bonus is added on top of it.</p>` : nothing}`;
}

/** A warning worth a tag in the ranking row: an effect the model has not evaluated at all, or a card whose every
 * effect is outside the formula. Nearly every card has some effect the formula leaves out, so that alone is not flagged. */
export function coverageFlag(effects: EffectCoverage[]) {
  if (effects.some((effect) => effect.status === 'unrecognized')) return STATUS_LABELS.unrecognized;
  if (effects.length && effects.every(missingEffect)) return STATUS_LABELS.omitted;
  return undefined;
}

export function effectList(effects: EffectCoverage[], source: Contribution['source']) {
  return html`<ul class="effect-coverage">${effects.map((effect) => html`<li data-effect-coverage=${effect.key} data-effect-status=${effect.status}>
    <span>${effect.name}</span><span class="tag ${missingEffect(effect) ? 'warn' : ''}">${statusLabel(effect, source)}</span>
    ${(effect.key.startsWith('unique:') || effect.status === 'unrecognized') && effect.description && effect.description !== effect.name ? html`<p>${effect.description}</p>` : nothing}
    <p class="muted">${effect.reason === 'teamBond' ? EFFECT_COVERAGE_REASONS.teamBond : nothing} Affects ${effect.outcomes.map((outcome) => OUTCOME_LABELS[outcome]).join(', ')}.</p>
  </li>`)}</ul>`;
}
