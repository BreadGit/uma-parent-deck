import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { STATS } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import { data, refresh, store, update, view } from '../context.ts';
import { hasExactStarTable } from '../../model/trainee.ts';
import { capitalize, charImg, skillName } from '../format.ts';
import { tip } from '../tooltip.ts';


function suggestions() {
  const words = view.traineeQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length ? data.characters.filter((ch) => { const hay = `${ch.name} ${ch.title}`.toLowerCase(); return words.every((w) => hay.includes(w)); }).sort((a, b) => a.name.localeCompare(b.name) || a.cardId - b.cardId).slice(0, 12) : [];
  if (!matches.length) return nothing;
  return html`<ul>${matches.map((ch) => html`<li data-action="pick-trainee" data-id="${ch.cardId}" @click=${() => pickTrainee(ch.cardId)}><img src="${charImg(ch)}" alt="" class="thumb-sm" />${ch.name}<span class="r">${ch.title}</span></li>`)}</ul>`;
}
function pickTrainee(cardId: number | null) {
  view.traineeQuery = '';
  update((s) => { s.run.traineeCardId = cardId; s.run.aptOverrides = {}; });
}

export function renderTrainee(c: RunPlan) {
  const t = c.trainee;
  return html`
    <section class="panel">
      <h2>Trainee</h2>
      ${t ? html`
        <div class="kv kv-center">
          <img class="thumb thumb-lg" src="${charImg(t)}" alt="" />
          <div><span class="k">${t.title}</span><span class="v">${t.name}</span></div>
          <button class="small push-right" data-action="clear-trainee" @click=${() => pickTrainee(null)}>Change</button>
        </div>
        <div class="grid2 gap-v">
          <label class="row"><span class="k">Stars${tip('Raised with pieces. Picks the base stats from the table GameTora lists for that star count; only a count the feed lacks is interpolated between the nearest tables.')}</span>
            <select data-select="trainee-stars" @change=${(e: Event) => update((s) => { s.run.traineeStars = Number((e.target as HTMLSelectElement).value); })}>
              ${[1, 2, 3, 4, 5].filter((k) => k >= (data.charByCardId.get(t.cardId)?.rarity ?? 1)).map((k) => html`<option value="${k}" ?selected=${store.run.traineeStars === k}>${k}★</option>`)}</select></label>
        </div>
        <div class="small muted">Base stats: ${t.baseStats.join(' / ')}${hasExactStarTable(data.charByCardId.get(t.cardId)!, store.run.traineeStars) ? nothing : html` <span class="warn">(interpolated: GameTora lists no ${store.run.traineeStars}★ table)</span>`}</div>
        <div class="small muted">Growth bonuses: ${t.growth.some((g) => g > 0) ? STATS.map((s, i) => t.growth[i]! > 0 ? `${capitalize(s)} +${t.growth[i]}%` : '').filter(Boolean).join(' · ') : 'none'}</div>
        <div class="small muted gap-top">Innate: ${t.innateSkills.map(skillName).join(', ')}<br/>Awakening: ${t.awakeningSkills.map(skillName).join(', ')}</div>
      ` : html`
        <div class="suggest">
          <input id="trainee-search" type="search" placeholder="Search uma name or outfit…" .value=${live(view.traineeQuery)} data-input="traineeQuery" class="wide" autocomplete="off"
            @input=${(e: Event) => { view.traineeQuery = (e.target as HTMLInputElement).value; refresh(); }} />
          ${suggestions()}
        </div>
        <div class="small muted">Pick the uma you'll train. Her own support cards are excluded from the deck and her innate skills count as covered.</div>`}
    </section>`;
}
