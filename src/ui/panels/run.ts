// Run setup: the scenario, the cards the deck must include, and the training focus.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { RunPlan } from '../../model/run.ts';
import { effectiveLb } from '../../model/run.ts';
import { parseSetting } from '../../settings.ts';
import { BORROWED_SLOTS, DECK_SIZE } from '../../model/rules.ts';
import { data, refresh, store, update, view } from '../context.ts';
import { capitalize, cardImg, cardThumb, cardUrl, typeIcon } from '../format.ts';
import { panel, sub } from '../panel.ts';
import { tip } from '../tooltip.ts';

const OWNED_SLOTS = DECK_SIZE - BORROWED_SLOTS;
const LIGHT_HELLO_IDS = data.cards.filter((c) => c.charName === 'Light Hello').map((c) => c.id);

function suggestions() {
  const cq = view.cardQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = cq.length
    ? data.cards.filter((card) => !store.run.pinnedIds.includes(card.id) && cq.every((w) => `${card.name} ${card.rarity} ${card.type}`.toLowerCase().includes(w)))
      .sort((a, b) => b.rarity.length - a.rarity.length || a.charName.localeCompare(b.charName) || a.id - b.id).slice(0, 12)
    : [];
  if (!matches.length) return nothing;
  return html`<ul>${matches.map((card) => {
    const lb = effectiveLb(store.inventory, card, store.settings.defaultLb);
    return html`<li data-action="pin-card" data-id="${card.id}" @click=${() => pinCard(card.id)}><img src="${cardImg(card)}" alt="" /><span class="two-line"><span>${card.charName} <span class="muted">(${card.rarity} ${capitalize(card.type)})</span></span><span class="muted small">${card.title}</span></span><span class="r">${lb == null ? 'not owned · borrow' : `LB${lb}`}</span></li>`;
  })}</ul>`;
}
export function pinCard(id: number) {
  view.cardQuery = '';
  update((s) => { if (!s.run.pinnedIds.includes(id)) s.run.pinnedIds.push(id); });
}
export function unpinCard(id: number) {
  update((s) => { s.run.pinnedIds = s.run.pinnedIds.filter((x) => x !== id); });
}

const PINS_TIP = `Cards the deck must include. An owned pin takes one of the ${OWNED_SLOTS} owned slots; a pin you do not own is borrowed at LB4 and takes the friend's slot.`;
const FOCUS_TIP = 'The training focus you will set in independent training. It shifts how the run splits its stat gains.';

export function renderRun(c: RunPlan) {
  const lhOptions = c.pool.filter((p) => LIGHT_HELLO_IDS.includes(p.card.id) && !c.unowned.has(p.card.id));
  const pins = store.run.pinnedIds.length ? store.run.pinnedIds.map((id) => {
    const card = data.cardById.get(id); if (!card) return nothing;
    const lb = effectiveLb(store.inventory, card, store.settings.defaultLb);
    return html`<span class="chip pin-row">${cardThumb(card, 'chip-art')}${typeIcon(card)}<a class="card-link" href="${cardUrl(card)}" target="_blank" rel="noopener">${card.charName} <span class="muted">${card.title}</span></a><span class="pin-lb">${lb == null ? html`<span class="tag borrow">borrow</span>${tip("Not in your inventory, so it takes the friend's slot at LB4.")}` : `LB${lb}`}</span><button data-action="unpin-card" data-id="${id}" title="Unpin" @click=${() => unpinCard(id)}>✕</button></span>`;
  }) : html`<span class="muted small">Nothing pinned. Our Grand Concert needs a Light Hello card, so pin one.</span>`;
  return panel({ title: 'Run' }, html`
    <label class="row"><span class="k">Scenario</span><span>Our Grand Concert</span></label>
    <label class="row"><span class="k">Training focus${tip(FOCUS_TIP)}</span>
      <select data-setting="focus" .value=${live(store.settings.focus)} @change=${(e: Event) => setSetting('focus', (e.target as HTMLSelectElement).value)}>${(['balanced', 'stamina', 'sprint'] as const).map((f) => html`<option value="${f}" ?selected=${store.settings.focus === f}>${capitalize(f)}</option>`)}</select></label>
    ${sub('Pinned cards', { tip: PINS_TIP })}
    <div class="suggest">
      <input id="card-search" type="search" placeholder="Search a support card to pin…" .value=${live(view.cardQuery)} data-input="cardQuery" class="wide" autocomplete="off"
        @input=${(e: Event) => { view.cardQuery = (e.target as HTMLInputElement).value; refresh(); }} />
      ${suggestions()}
    </div>
    <div class="chips pin-list">${pins}</div>
    ${c.ownedPinIds.length > OWNED_SLOTS ? html`<div class="small muted">${c.ownedPinIds.length} owned cards pinned: the ${OWNED_SLOTS} with the best added spark chance stay.</div>
      <label class="row"><span class="k">Borrow the best card overall, not the best leftover pin</span><input type="checkbox" data-run="borrowFromAll" .checked=${live(store.run.borrowFromAll)} @change=${(e: Event) => update((s) => { s.run.borrowFromAll = (e.target as HTMLInputElement).checked; })} /></label>` : nothing}
    ${!lhOptions.length ? html`<div class="small warn">No Light Hello card is marked owned. Our Grand Concert needs one.</div>` : nothing}`);
}

/** Apply a form value to a setting; an invalid value keeps the current one and the re-render puts it back. */
export function setSetting(key: Parameters<typeof parseSetting>[0], raw: string | boolean) {
  const v = parseSetting(key, raw);
  update((s) => { if (v !== undefined) (s.settings as unknown as Record<string, unknown>)[key] = v; });
}
