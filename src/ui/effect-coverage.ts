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

export function basisExplanation(card: Card, lb: number, source: Contribution['source'], races: number, effects: EffectCoverage[]) {
  const observed = source === 'model' ? undefined : referenceObservation(card, lb, data.model);
  return html`
    ${observed ? html`<p>${copy.observedDetail(observed.lb, observed.runs, observed.source)}</p>
      ${source === 'observed+model' ? html`<p>${copy.adjustedDetail(observed.lb, lb)}</p>` : nothing}` : html`<p>${copy.modelDetail}</p>`}
    <p>${copy.raceDetail(data.model.races.reference, races)}</p>
    ${observedCaveat(source, effects)}`;
}

export function observedCaveat(source: Contribution['source'], effects: EffectCoverage[]) {
  if (source === 'model') return nothing;
  const missing = effects.some((effect) => missingEffect(effect) && affectsContribution(effect));
  return html`${missing ? html`<p>${copy.observedEffects}</p>` : nothing}
    ${effects.some(observedDeckEffect) ? html`<p>${copy.observedDeck}</p>` : nothing}`;
}

export function coverageLabel(effects: EffectCoverage[]) {
  const missing = effects.filter(missingEffect);
  if (missing.length && missing.length < effects.length) return copy.partial;
  if (missing.length) return missing.some((effect) => effect.status === 'unrecognized') ? copy.unrecognized : copy.omitted;
  return effects.some((effect) => effect.status === 'approximated') ? copy.approximated : copy.calculated;
}

function effectReason(effect: EffectCoverage): string {
  const reason = copy.reasons[effect.reason];
  return typeof reason === 'function' ? reason(Math.round(data.model.uniqueRampShare * 100)) : reason;
}

export function effectList(effects: EffectCoverage[], { compact = false, source = 'model' }: { compact?: boolean; source?: Contribution['source'] } = {}) {
  return html`<ul class="effect-coverage">${effects.map((effect) => html`<li data-effect-coverage=${effect.key} data-effect-status=${effect.status}>
    <span>${effect.name}</span><span class="tag ${missingEffect(effect) ? 'warn' : ''}">${source !== 'model' && effect.status === 'omitted' && affectsContribution(effect) ? copy.observedOmitted : copy[effect.status]}</span>
    ${(!compact || effect.key.startsWith('unique:') || effect.status === 'unrecognized') && effect.description && effect.description !== effect.name ? html`<p>${effect.description}</p>` : nothing}
    <p class="muted">${!compact || effect.reason === 'teamBond' ? effectReason(effect) : nothing} ${copy.affects(effect.outcomes.map((outcome) => copy.outcomes[outcome]))}</p>
  </li>`)}</ul>`;
}
