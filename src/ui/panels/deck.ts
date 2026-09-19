// The suggested deck: the six cards with their spark chances. How the search chose them and what the model leaves out
// per card are rendered by the prediction details panel through deckBuild().
import { html, nothing } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import type { RunPlan } from '../../model/run.ts';
import type { CardScore } from '../../model/deck.ts';
import { cardEffectCoverage } from '../../model/support-effects.ts';
import { data, searchState, store } from '../context.ts';
import { COPY } from '../copy.ts';
import { basisLabel, effectList, missingEffect, observedCaveat, observedDeckEffect } from '../effect-coverage.ts';
import { lbSelect } from '../fields.ts';
import { cardLink, cardThumb, pill, probability, typeIcon } from '../format.ts';
import { panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

function slot(c: RunPlan, cs: CardScore) {
  return html`<div class="slot">
    <div class="slot-top">${store.run.pinnedIds.includes(cs.card.id) ? html`<span class="tag pin">pinned</span>` : nothing}${cs.borrowed ? html`<span class="tag borrow">borrow</span>` : nothing}</div>
    ${cardThumb(cs.card, 'slot-art')}
    <div class="name">${typeIcon(cs.card)}${cardLink(cs.card, html`${cs.card.charName}<span class="muted title">${cs.card.title}</span>`)}</div>
    <div class="lb">${cs.borrowed ? COPY.deck.borrowed : html`LB ${lbSelect(c, cs.card, cs.lb, 'small')}`}</div>
    <div class="cover">${cs.coverage.filter((x) => x.marginal > 0 || x.spark > 0).map((x) => html`<span class="t">${x.target.name} <span class="n"><span class="muted">spark</span> ${pill(x.spark)}${tip(x.sources.map((s) => `${s.detail}: ${probability(s.pObtain)}`).join('\n'))}</span></span>`)}</div>
  </div>`;
}

function limitations(c: RunPlan) {
  const cards = c.deckResult.deck.map((cs) => ({ cs, effects: cardEffectCoverage(cs.card, cs.lb, data.model, { deck: c.deckResult.deck, fansBefore: c.ctx.fansBefore })
    .filter((effect) => missingEffect(effect) || effect.reason === 'teamBond' || (cs.source !== 'model' && observedDeckEffect(effect))) }))
    .filter(({ effects }) => effects.length > 0);
  if (!cards.length) return nothing;
  return html`<details class="estimate-limitations small" data-estimate-limitations>
    <summary>${COPY.modelCoverage.limitations(cards.length)}</summary>
    <p class="muted">${COPY.modelCoverage.limitationsDetail}</p>
    ${cards.map(({ cs, effects }) => html`<div class="estimate-limitations-card" data-card-limitations=${cs.card.id}>
      <b>${cardLink(cs.card)}</b> <span class="muted">${basisLabel(cs.card, cs.lb, cs.source)}</span>
      ${observedCaveat(cs.source, effects)}
      ${effectList(effects, { compact: true, source: cs.source })}
    </div>`)}
  </details>`;
}

/** The search steps and the per-card model limitations, for the prediction details panel. */
export function deckBuild(c: RunPlan) {
  return html`<ol class="small">${c.deckResult.steps.map((s) => html`<li>${s}</li>`)}</ol>${limitations(c)}`;
}

export function renderDeck(c: RunPlan) {
  const d = c.deckResult;
  const ordered = [...d.deck.filter((x) => !x.borrowed), ...d.deck.filter((x) => x.borrowed)];
  const deck = d.deck.length
    ? html`<div class="deck">${repeat(ordered, (cs) => `${cs.card.id}:${cs.borrowed ? 'b' : 'o'}`, (cs) => slot(c, cs))}</div>`
    : html`<div class="muted">${COPY.deck.noCards}</div>`;
  return panel({ title: COPY.deck.title, kind: 'result', tip: COPY.deck.tip }, html`
    ${searchState.pending ? html`<p class="status small muted" data-plan-pending role="status" aria-live="polite">${COPY.app.searching}</p>` : nothing}
    ${deck}`);
}
