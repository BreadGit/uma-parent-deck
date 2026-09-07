// The trainee: who is being trained, at how many stars, and what she brings to the run herself.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { STATS } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import { data, refresh, store, update, view } from '../context.ts';
import { clampStars, hasExactStarTable, STARS_MAX } from '../../model/trainee.ts';
import { capitalize, charImg, skillName, statIcon } from '../format.ts';
import { panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

function suggestions() {
  const words = view.traineeQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length ? data.characters.filter((ch) => { const hay = `${ch.name} ${ch.title}`.toLowerCase(); return words.every((w) => hay.includes(w)); }).sort((a, b) => a.name.localeCompare(b.name) || a.cardId - b.cardId).slice(0, 12) : [];
  if (!matches.length) return nothing;
  return html`<ul>${matches.map((ch) => html`<li data-action="pick-trainee" data-id="${ch.cardId}" @click=${() => pickTrainee(ch.cardId)}><img src="${charImg(ch)}" alt="" class="thumb-sm" />${ch.name}<span class="r">${ch.title}</span></li>`)}</ul>`;
}
function pickTrainee(cardId: number | null) {
  view.traineeQuery = '';
  update((s) => { s.run.traineeCardId = cardId; s.run.aptOverrides = {}; s.run.traineeStars = clampStars(cardId != null ? data.charByCardId.get(cardId) ?? null : null, s.run.traineeStars); });
}

const STARS_TIP = 'Her rarity after the pieces you have used on her. Sets the base stats and the unique skill\'s starting level.';
const PANEL_TIP = 'The uma you will train. Her own support cards leave the deck, her innate and awakening skills count as covered, and her growth rates and aptitudes feed the stat and race models.';

export function renderTrainee(c: RunPlan) {
  const t = c.trainee;
  const skills = (ids: number[]) => ids.length ? ids.map(skillName).join(', ') : 'none';
  const body = t ? html`
    <div class="trainee-card">
      <img class="thumb thumb-lg" src="${charImg(t)}" alt="" />
      <div class="trainee-id"><span class="k">${t.title}</span><span class="v">${t.name}</span></div>
      <label class="trainee-stars"><span class="k">Stars${tip(STARS_TIP)}</span>
        <select data-select="trainee-stars" .value=${live(String(store.run.traineeStars))} @change=${(e: Event) => update((s) => { s.run.traineeStars = Number((e.target as HTMLSelectElement).value); })}>
          ${Array.from({ length: STARS_MAX }, (_, i) => i + 1).filter((k) => k >= (data.charByCardId.get(t.cardId)?.rarity ?? 1)).map((k) => html`<option value="${k}" ?selected=${store.run.traineeStars === k}>${k}★</option>`)}</select></label>
    </div>
    <div class="facts small">
      <span class="k">Base stats</span>
      <span class="stat-strip">${STATS.map((st, i) => html`<span>${statIcon(st)}${t.baseStats[i]}</span>`)}${hasExactStarTable(data.charByCardId.get(t.cardId)!, store.run.traineeStars) ? nothing : html`<span class="warn">interpolated${tip(`GameTora lists no ${store.run.traineeStars}★ table for her, so these sit between the nearest listed star counts.`)}</span>`}</span>
      <span class="k">Growth</span><span>${t.growth.some((g) => g > 0) ? STATS.map((s, i) => t.growth[i]! > 0 ? `${capitalize(s)} +${t.growth[i]}%` : '').filter(Boolean).join(' · ') : 'none'}</span>
      <span class="k">Innate</span><span>${skills(t.innateSkills)}</span>
      <span class="k">Awakening</span><span>${skills(t.awakeningSkills)}</span>
    </div>` : html`
    <div class="suggest">
      <input id="trainee-search" type="search" placeholder="Search uma name or outfit…" .value=${live(view.traineeQuery)} data-input="traineeQuery" class="wide" autocomplete="off"
        @input=${(e: Event) => { view.traineeQuery = (e.target as HTMLInputElement).value; refresh(); }} />
      ${suggestions()}
    </div>
    <div class="small muted">Pick the uma you will train.</div>`;
  return panel({ title: 'Trainee', tip: PANEL_TIP, actions: t ? html`<button class="small" data-action="clear-trainee" @click=${() => pickTrainee(null)}>Change</button>` : nothing }, body);
}
