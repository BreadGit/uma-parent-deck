// Run setup: the scenario, the training focus, the race win threshold, and the cards the deck must include.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { Card } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import { effectiveLb } from '../../model/run.ts';
import { data, store, update, view } from '../context.ts';
import { pinCard, setSetting, unignoreCard, unpinCard } from '../actions.ts';
import { COPY } from '../copy.ts';
import { inputValue, isChecked, options, searchBox, selectValue } from '../fields.ts';
import { capitalize, cardImg, cardThumb, cardUrl, pct, typeIcon } from '../format.ts';
import { panel, sub } from '../panel.ts';
import { tip } from '../tooltip.ts';
import { BORROWED_SLOTS, DECK_SIZE } from '../../model/rules.ts';

const OWNED_SLOTS = DECK_SIZE - BORROWED_SLOTS;
const LIGHT_HELLO_IDS = data.cards.filter((c) => c.charName === 'Light Hello').map((c) => c.id);
const FOCUS_CHOICES = (['balanced', 'stamina', 'sprint'] as const).map((f) => ({ value: f, label: capitalize(f) }));

function matches(): Card[] {
  const words = view.cardQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return data.cards.filter((card) => !store.run.pinnedIds.includes(card.id) && words.every((w) => `${card.name} ${card.rarity} ${card.type}`.toLowerCase().includes(w)))
    .sort((a, b) => b.rarity.length - a.rarity.length || a.charName.localeCompare(b.charName) || a.id - b.id).slice(0, 12);
}
const lbOf = (card: Card) => effectiveLb(store.inventory, card, store.settings.defaultLb);

/** A pinned or ignored card: art, name, its limit break (or that it would be borrowed) and the button that removes it from the list. */
function cardRow(id: number, action: 'unpin-card' | 'unignore-card') {
  const card = data.cardById.get(id); if (!card) return nothing;
  const lb = lbOf(card);
  const label = action === 'unpin-card' ? COPY.cards.unpin(card.charName) : COPY.cards.unignore(card.charName);
  const remove = action === 'unpin-card' ? unpinCard : unignoreCard;
  return html`<span class="chip pin-row">${cardThumb(card, 'chip-art')}${typeIcon(card)}<a class="card-link" href="${cardUrl(card)}" target="_blank" rel="noopener">${card.charName} <span class="muted">${card.title}</span></a><span class="pin-lb">${lb == null ? html`<span class="tag borrow">borrow</span>${action === 'unpin-card' ? tip(COPY.run.borrowTip) : nothing}` : `LB${lb}`}</span><button data-action=${action} data-id="${id}" aria-label=${label} @click=${() => remove(id)}>✕</button></span>`;
}

/** The range input stays mounted while dragged, so its live value is written to the output directly. */
function threshold() {
  return html`<label class="row threshold"><span class="row-k">${COPY.run.threshold}${tip(COPY.run.thresholdTip)}</span>
    <span class="threshold-field"><input type="range" min="0" max="1" step="0.05" .value=${live(String(store.settings.winThreshold))} data-setting="winThreshold"
      @input=${(e: Event) => { const out = (e.target as HTMLElement).parentElement?.querySelector('output'); if (out) out.value = pct(Number(inputValue(e))); }}
      @change=${(e: Event) => setSetting('winThreshold', inputValue(e))} /><output data-setting-output="winThreshold" .value=${live(pct(store.settings.winThreshold))}></output></span></label>`;
}

export function renderRun(c: RunPlan) {
  const lhOptions = c.pool.filter((p) => LIGHT_HELLO_IDS.includes(p.card.id) && !c.unowned.has(p.card.id));
  const pins = store.run.pinnedIds.length ? store.run.pinnedIds.map((id) => cardRow(id, 'unpin-card')) : html`<span class="muted small">${COPY.run.noPins}</span>`;
  return panel({ title: COPY.run.title, step: 4 }, html`
    <label class="row"><span class="row-k">${COPY.run.scenario}</span><span>Our Grand Concert</span></label>
    <label class="row"><span class="row-k">${COPY.run.focus}${tip(COPY.run.focusTip)}</span>
      <select data-setting="focus" .value=${live(store.settings.focus)} @change=${(e: Event) => setSetting('focus', selectValue(e))}>${options(FOCUS_CHOICES, store.settings.focus)}</select></label>
    ${threshold()}
    ${sub(COPY.run.pins, { tip: COPY.run.pinsTip })}
    ${searchBox<Card>({
      id: 'card-search', placeholder: COPY.run.pinPlaceholder, field: 'cardQuery', items: matches(), key: (card) => card.id, action: 'pin-card',
      row: (card) => { const lb = lbOf(card); return html`<img src="${cardImg(card)}" alt="" /><span class="two-line"><span>${card.charName} <span class="muted">(${card.rarity} ${capitalize(card.type)})</span></span><span class="muted small">${card.title}</span></span><span class="suggest-r">${lb == null ? 'not owned · borrow' : `LB${lb}`}</span>`; },
      pick: (card) => pinCard(card.id),
    })}
    <div class="chips pin-list">${pins}</div>
    ${c.ownedPinIds.length > OWNED_SLOTS ? html`<div class="small muted">${COPY.run.tooManyPins(c.ownedPinIds.length)}</div>
      <label class="row"><span class="row-k">${COPY.run.borrowFromAll}</span><input type="checkbox" data-run="borrowFromAll" .checked=${live(store.run.borrowFromAll)} @change=${(e: Event) => update((s) => { s.run.borrowFromAll = isChecked(e); })} /></label>` : nothing}
    ${!lhOptions.length ? html`<div class="small warn">${COPY.run.noLightHello}</div>` : nothing}
    ${store.run.ignoredIds.length ? html`${sub(COPY.run.ignored, { tip: COPY.run.ignoredTip })}
      <div class="chips pin-list" data-ignore-list>${store.run.ignoredIds.map((id) => cardRow(id, 'unignore-card'))}</div>` : nothing}`);
}
