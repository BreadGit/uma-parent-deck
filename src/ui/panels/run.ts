// Run setup: the scenario, the training focus, the race win threshold, and the cards the deck must include.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { Card } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import { effectiveLb } from '../../model/run.ts';
import { data, store, update, view } from '../context.ts';
import { ignoreCard, pinCard, setSetting, unignoreCard, unpinCard } from '../actions.ts';
import { LABEL, TITLE } from '../copy.ts';
import { inputValue, isChecked, matchesWords, options, queryWords, searchBox, selectValue } from '../fields.ts';
import { capitalize, cardImg, cardThumb, cardUrl, pct, typeIcon } from '../format.ts';
import { panel, sub } from '../panel.ts';
import { tip } from '../tooltip.ts';
import { BORROWED_SLOTS, DECK_SIZE } from '../../model/rules.ts';

const OWNED_SLOTS = DECK_SIZE - BORROWED_SLOTS;
const copy = {
  focus: 'Training focus',
  focusTip: 'The training focus you will set in independent training. It shifts how the run splits its stat gains.',
  threshold: 'Race win chance at least',
  thresholdTip: 'A G1 is scheduled automatically when its win chance is at least this. Lower it for more races and more fans; raise it for fewer expected losses.',
  pins: 'Pinned cards',
  pinsTip: `Cards the deck must include. An owned pin takes one of the ${OWNED_SLOTS} owned slots; a pin you do not own is borrowed at LB4 and takes the friend's slot.`,
  pinPlaceholder: 'Search a support card to pin…',
  pinSearchLabel: 'Search support cards to pin',
  noPins: 'Nothing pinned. Our Grand Concert needs a Light Hello card, so pin one.',
  borrowTip: "Not in your inventory, so it takes the friend's slot at LB4.",
  tooManyPins: (n: number) => `${n} owned cards pinned: the ${OWNED_SLOTS} with the best added spark chance stay.`,
  borrowFromAll: 'Borrow the best card overall, not the best leftover pin',
  noLightHello: 'No Light Hello card is marked owned. Our Grand Concert needs one.',
  ignored: 'Ignored cards',
  ignoredTip: `Cards this run never suggests for an owned slot, nor for the friend's slot unless allowed below. Ignore a card here or with the button beside it in ${TITLE.deck} or ${TITLE.ranking}.`,
  ignorePlaceholder: 'Search a support card to ignore…',
  ignoreSearchLabel: 'Search support cards to ignore',
  noIgnored: 'Nothing ignored.',
  borrowIgnored: "Allow ignored cards in the friend borrow slot",
} as const;

const LIGHT_HELLO_IDS = data.cards.filter((c) => c.charName === 'Light Hello').map((c) => c.id);
const FOCUS_CHOICES = (['balanced', 'stamina', 'sprint'] as const).map((f) => ({ value: f, label: capitalize(f) }));

/** Cards matching a search box's words, minus those already in the list it feeds. */
function matches(query: string, listed: number[]): Card[] {
  const words = queryWords(query);
  if (!words.length) return [];
  return data.cards.filter((card) => !listed.includes(card.id) && matchesWords(words, `${card.name} ${card.rarity} ${card.type}`))
    .sort((a, b) => b.rarity.length - a.rarity.length || a.charName.localeCompare(b.charName) || a.id - b.id).slice(0, 12);
}
const searchRow = (card: Card) => { const lb = lbOf(card); return html`<img src="${cardImg(card)}" alt="" /><span class="two-line"><span>${card.charName} <span class="muted">(${card.rarity} ${capitalize(card.type)})</span></span><span class="muted small">${card.title}</span></span><span class="suggest-r">${lb == null ? 'not owned · borrow' : `LB${lb}`}</span>`; };
const lbOf = (card: Card) => effectiveLb(store.inventory, card, store.settings.inventoryOverrides);

/** A pinned or ignored card: art, name, its limit break (or that it would be borrowed) and the button that removes it from the list. */
function cardRow(id: number, action: 'unpin-card' | 'unignore-card') {
  const card = data.cardById.get(id); if (!card) return nothing;
  const lb = lbOf(card);
  const label = action === 'unpin-card' ? LABEL.unpin(card.charName) : LABEL.unignore(card.charName);
  const remove = action === 'unpin-card' ? unpinCard : unignoreCard;
  return html`<span class="chip pin-row">${cardThumb(card, 'chip-art')}${typeIcon(card)}<a class="card-link" href="${cardUrl(card)}" target="_blank" rel="noopener">${card.charName} <span class="muted">${card.title}</span></a><span class="pin-lb">${lb == null ? html`<span class="tag borrow">borrow</span>${action === 'unpin-card' ? tip(copy.borrowTip) : nothing}` : `LB${lb}`}</span><button data-action=${action} data-id="${id}" aria-label=${label} @click=${() => remove(id)}>✕</button></span>`;
}

/** The range input stays mounted while dragged, so its live value is written to the output directly. */
function threshold() {
  return html`<label class="row threshold"><span class="row-k">${copy.threshold}${tip(copy.thresholdTip)}</span>
    <span class="threshold-field"><input type="range" min="0" max="1" step="0.05" .value=${live(String(store.settings.winThreshold))} data-setting="winThreshold"
      @input=${(e: Event) => { const out = (e.target as HTMLElement).parentElement?.querySelector('output'); if (out) out.value = pct(Number(inputValue(e))); }}
      @change=${(e: Event) => setSetting('winThreshold', inputValue(e))} /><output data-setting-output="winThreshold" .value=${live(pct(store.settings.winThreshold))}></output></span></label>`;
}

export function renderRun(c: RunPlan) {
  const lhOptions = c.pool.filter((p) => LIGHT_HELLO_IDS.includes(p.card.id) && !c.unowned.has(p.card.id));
  const pins = store.run.pinnedIds.length ? store.run.pinnedIds.map((id) => cardRow(id, 'unpin-card')) : html`<span class="muted small">${copy.noPins}</span>`;
  const ignored = store.run.ignoredIds.length ? store.run.ignoredIds.map((id) => cardRow(id, 'unignore-card')) : html`<span class="muted small">${copy.noIgnored}</span>`;
  return panel({ title: TITLE.run, step: 4 }, html`
    <label class="row"><span class="row-k">${LABEL.scenario}</span><span>Our Grand Concert</span></label>
    <label class="row"><span class="row-k">${copy.focus}${tip(copy.focusTip)}</span>
      <select data-setting="focus" .value=${live(store.settings.focus)} @change=${(e: Event) => setSetting('focus', selectValue(e))}>${options(FOCUS_CHOICES, store.settings.focus)}</select></label>
    ${threshold()}
    ${sub(copy.pins, { tip: copy.pinsTip })}
    ${searchBox<Card>({
      id: 'card-search', label: copy.pinSearchLabel, placeholder: copy.pinPlaceholder, field: 'cardQuery', items: matches(view.cardQuery, store.run.pinnedIds), key: (card) => card.id, action: 'pin-card',
      row: searchRow, pick: (card) => pinCard(card.id),
    })}
    <div class="chips pin-list">${pins}</div>
    ${c.ownedPinIds.length > OWNED_SLOTS ? html`<div class="small muted">${copy.tooManyPins(c.ownedPinIds.length)}</div>
      <label class="row"><span class="row-k">${copy.borrowFromAll}</span><input type="checkbox" data-run="borrowFromAll" .checked=${live(store.run.borrowFromAll)} @change=${(e: Event) => update((s) => { s.run.borrowFromAll = isChecked(e); })} /></label>` : nothing}
    ${!lhOptions.length ? html`<div class="small warn">${copy.noLightHello}</div>` : nothing}
    ${sub(copy.ignored, { tip: copy.ignoredTip })}
    ${searchBox<Card>({
      id: 'ignore-search', label: copy.ignoreSearchLabel, placeholder: copy.ignorePlaceholder, field: 'ignoreQuery', items: matches(view.ignoreQuery, store.run.ignoredIds), key: (card) => card.id, action: 'ignore-card',
      row: searchRow, pick: (card) => ignoreCard(card.id),
    })}
    <div class="chips pin-list" data-ignore-list>${ignored}</div>
    <label class="row"><span class="row-k">${copy.borrowIgnored}</span><input type="checkbox" data-run="borrowIgnored" .checked=${live(store.run.borrowIgnored)} @change=${(e: Event) => update((s) => { s.run.borrowIgnored = isChecked(e); })} /></label>`);
}
