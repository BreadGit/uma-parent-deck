import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { STATS, type AptKey, type Grade } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import { data, refresh, store, update, view } from '../context.ts';
import { capitalize, charImg, skillName } from '../format.ts';
import { tip } from '../tooltip.ts';

const GRADES: Grade[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
const APT_SHOWN: AptKey[] = ['turf', 'dirt', 'sprint', 'mile', 'medium', 'long'];

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
/** An override equal to the trainee's own grade is just the base again. */
function setAptitude(k: AptKey, grade: Grade) {
  update((s) => {
    const t = s.run.traineeCardId != null ? data.charByCardId.get(s.run.traineeCardId) : null;
    if (t && t.aptitudes[k] === grade) delete s.run.aptOverrides[k]; else s.run.aptOverrides[k] = grade;
  });
}

export function renderTrainee(c: RunPlan) {
  const t = c.trainee;
  const overridden = Object.keys(store.run.aptOverrides).length > 0;
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
          <label class="row"><span class="k">Stars${tip('Raised with pieces. Picks the base stats. GameTora lists the base rarity, 4★ and 5★ tables; other star counts are interpolated between them.')}</span>
            <select data-select="trainee-stars" @change=${(e: Event) => update((s) => { s.run.traineeStars = Number((e.target as HTMLSelectElement).value); })}>
              ${[1, 2, 3, 4, 5].filter((k) => k >= (data.charByCardId.get(t.cardId)?.rarity ?? 1)).map((k) => html`<option value="${k}" ?selected=${store.run.traineeStars === k}>${k}★</option>`)}</select></label>
        </div>
        <div class="small muted">Base stats: ${t.baseStats.join(' / ')}</div>
        <div class="small muted">Growth bonuses: ${t.growth.some((g) => g > 0) ? STATS.map((s, i) => t.growth[i]! > 0 ? `${capitalize(s)} +${t.growth[i]}%` : '').filter(Boolean).join(' · ') : 'none'}</div>
        <h3>Trainee aptitude overrides (match the legacy screen)</h3>
        <div class="apts">${APT_SHOWN.map((k) => html`<label>${k}<select data-apt="${k}" @change=${(e: Event) => setAptitude(k, (e.target as HTMLSelectElement).value as Grade)}>${GRADES.map((g) => html`<option value="${g}" ?selected=${c.apt[k] === g}>${g}</option>`)}</select></label>`)}</div>
        ${overridden ? html`<button class="small" data-action="reset-apts" @click=${() => update((s) => { s.run.aptOverrides = {}; })}>Reset to base aptitudes</button>` : nothing}
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
