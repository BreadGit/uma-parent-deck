import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { RunPlan } from '../../model/run.ts';
import { effectiveLb } from '../../model/run.ts';
import { parseSetting } from '../../settings.ts';
import { BORROWED_SLOTS, DECK_SIZE } from '../../model/rules.ts';
import { data, refresh, store, update, view } from '../context.ts';
import { capitalize, cardImg, cardThumb, cardUrl, num, pct, typeIcon } from '../format.ts';
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
    return html`<li data-action="pin-card" data-id="${card.id}" @click=${() => pinCard(card.id)}><img src="${cardImg(card)}" alt="" /><span class="two-line"><span>${card.charName} <span class="muted">(${card.rarity} ${capitalize(card.type)})</span></span><span class="muted small">${card.title}</span></span><span class="r">${lb == null ? 'not owned, would be borrowed' : `LB${lb}`}</span></li>`;
  })}</ul>`;
}
function pinCard(id: number) {
  view.cardQuery = '';
  update((s) => { if (!s.run.pinnedIds.includes(id)) s.run.pinnedIds.push(id); });
}
function unpinCard(id: number) {
  update((s) => { s.run.pinnedIds = s.run.pinnedIds.filter((x) => x !== id); });
}
export function renderRun(c: RunPlan) {
  const lhOptions = c.pool.filter((p) => LIGHT_HELLO_IDS.includes(p.card.id) && !c.unowned.has(p.card.id));
  return html`
    <section class="panel">
      <h2>Run</h2>
      <label class="row"><span class="k">Scenario</span><span>Our Grand Concert</span></label>
      <h3>Pinned cards</h3>
      <div class="suggest">
        <input id="card-search" type="search" placeholder="Search a support card to pin…" .value=${live(view.cardQuery)} data-input="cardQuery" class="wide" autocomplete="off"
          @input=${(e: Event) => { view.cardQuery = (e.target as HTMLInputElement).value; refresh(); }} />
        ${suggestions()}
      </div>
      <div class="chips">
        ${store.run.pinnedIds.length ? store.run.pinnedIds.map((id) => {
          const card = data.cardById.get(id); if (!card) return nothing;
          const owned = !c.unowned.has(id);
          return html`<span class="chip">${cardThumb(card, 'chip-art')}${typeIcon(card)}<a class="card-link" href="${cardUrl(card)}" target="_blank" rel="noopener">${card.charName} ${card.title}</a>${owned ? nothing : html` <span class="tag borrow">borrow</span>${tip("Not in your inventory, so it asks for the friend's slot at LB4.")}`}<button data-action="unpin-card" data-id="${id}" title="Unpin" @click=${() => unpinCard(id)}>✕</button></span>`;
        }) : html`<span class="muted small">Nothing pinned. Light Hello is mandatory in Grand Concert, so pin one of her cards unless you have a reason not to.</span>`}
      </div>
      ${c.ownedPinIds.length > OWNED_SLOTS ? html`<div class="small muted">${c.ownedPinIds.length} owned cards pinned: the builder keeps the ${OWNED_SLOTS} with the best added spark chance.</div>
        <label class="row"><span class="k">Borrow best overall card instead of best card among pins</span><input type="checkbox" data-run="borrowFromAll" .checked=${live(store.run.borrowFromAll)} @change=${(e: Event) => update((s) => { s.run.borrowFromAll = (e.target as HTMLInputElement).checked; })} /></label>` : nothing}
      ${!lhOptions.length ? html`<div class="small warn">No Light Hello card is marked as owned. She is mandatory in Grand Concert.</div>` : nothing}
      <label class="row"><span class="k">Training focus</span>
        <select data-setting="focus" @change=${(e: Event) => setSetting('focus', (e.target as HTMLSelectElement).value)}>${(['balanced', 'stamina', 'sprint'] as const).map((f) => html`<option value="${f}" ?selected=${store.settings.focus === f}>${capitalize(f)}</option>`)}</select></label>
      <label class="row"><span class="k">Win chance threshold</span>
        <span><input type="range" min="0" max="1" step="0.05" .value=${live(String(store.settings.winThreshold))} data-setting="winThreshold"
          @input=${(e: Event) => { const out = (e.target as HTMLElement).parentElement?.querySelector('output'); if (out) out.value = pct(Number((e.target as HTMLInputElement).value)); }}
          @change=${(e: Event) => setSetting('winThreshold', (e.target as HTMLInputElement).value)} /> <output data-setting-output="winThreshold" .value=${live(pct(store.settings.winThreshold))}></output></span></label>
      <div class="small muted">Races: ${c.sum.count} G1s selected, ${num(c.sum.expectedWins, 1)} expected wins, ${num(c.sum.expectedLosses, 1)} expected losses.</div>
      <label class="row"><span class="k">Show cards marked not owned</span><input type="checkbox" data-setting="showUnowned" .checked=${live(store.settings.showUnowned)} @change=${(e: Event) => setSetting('showUnowned', (e.target as HTMLInputElement).checked)} /></label>
    </section>`;
}

/** Apply a form value to a setting; an invalid value keeps the current one and the re-render puts it back. */
export function setSetting(key: Parameters<typeof parseSetting>[0], raw: string | boolean) {
  const v = parseSetting(key, raw);
  update((s) => { if (v !== undefined) (s.settings as unknown as Record<string, unknown>)[key] = v; });
}
