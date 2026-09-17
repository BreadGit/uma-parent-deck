import { html, nothing } from 'lit-html';
import type { Card } from '../types.ts';
import { referenceObservation, type Contribution } from '../model/stats.ts';
import type { EffectCoverage } from '../model/support-effects.ts';
import { data } from './context.ts';
import { COPY } from './copy.ts';

const copy = COPY.modelCoverage;
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
  return source !== 'model' && effect.status === 'omitted' && affectsContribution(effect) ? copy.observedOmitted : copy[effect.status];
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
  if (effects.some((effect) => effect.status === 'unrecognized')) return copy.unrecognized;
  if (effects.length && effects.every(missingEffect)) return copy.omitted;
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
