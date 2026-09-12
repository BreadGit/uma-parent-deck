// The trainee: who is being trained, at how many stars, and what she brings to the run herself.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { STATS } from '../../types.ts';
import type { Character } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import { clampStars, hasExactStarTable, STARS_MAX } from '../../model/trainee.ts';
import { data, store, update, view } from '../context.ts';
import { COPY } from '../copy.ts';
import { numbered, options, searchBox, selectValue } from '../fields.ts';
import { capitalize, charImg, skillName, statIcon } from '../format.ts';
import { panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

function matches(): Character[] {
  const words = view.traineeQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return data.characters.filter((ch) => { const hay = `${ch.name} ${ch.title}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
    .sort((a, b) => a.name.localeCompare(b.name) || a.cardId - b.cardId).slice(0, 12);
}
function pickTrainee(cardId: number | null) {
  view.traineeQuery = '';
  update((s) => {
    s.run.traineeCardId = cardId;
    s.run.aptOverrides = {};
    s.run.pinkLineage = s.run.pinkLineage.map((spark) => spark?.inferred ? null : spark);
    s.run.traineeStars = clampStars(cardId != null ? data.charByCardId.get(cardId) ?? null : null, s.run.traineeStars);
  });
}

const skills = (ids: number[]) => ids.length ? ids.map(skillName).join(', ') : 'none';

function chosen(c: RunPlan) {
  const t = c.trainee!;
  const rarity = data.charByCardId.get(t.cardId)?.rarity ?? 1;
  const starOptions = numbered(Array.from({ length: STARS_MAX }, (_, i) => i + 1).filter((k) => k >= rarity), (k) => `${k}★`);
  return html`
    <div class="trainee-card">
      <img class="thumb thumb-lg" src="${charImg(t)}" alt="" />
      <div class="trainee-id"><span class="trainee-k">${t.title}</span><span class="trainee-v">${t.name}</span></div>
      <label class="trainee-stars"><span class="trainee-k">Stars${tip(COPY.trainee.starsTip)}</span>
        <select data-select="trainee-stars" .value=${live(String(store.run.traineeStars))} @change=${(e: Event) => update((s) => { s.run.traineeStars = Number(selectValue(e)); })}>${options(starOptions, String(store.run.traineeStars))}</select></label>
    </div>
    <div class="facts small">
      <span class="fact-k">Base stats</span>
      <span class="stat-strip">${STATS.map((st, i) => html`<span>${statIcon(st)}${t.baseStats[i]}</span>`)}${hasExactStarTable(data.charByCardId.get(t.cardId)!, store.run.traineeStars) ? nothing : html`<span class="warn">interpolated${tip(COPY.trainee.interpolated(store.run.traineeStars))}</span>`}</span>
      <span class="fact-k">Growth</span><span>${t.growth.some((g) => g > 0) ? STATS.map((s, i) => t.growth[i]! > 0 ? `${capitalize(s)} +${t.growth[i]}%` : '').filter(Boolean).join(' · ') : 'none'}</span>
      <span class="fact-k">Innate</span><span>${skills(t.innateSkills)}</span>
      <span class="fact-k">Awakening</span><span>${skills(t.awakeningSkills)}</span>
    </div>`;
}

const picker = () => html`
  ${searchBox<Character>({
    id: 'trainee-search', placeholder: COPY.trainee.placeholder, field: 'traineeQuery', items: matches(), key: (ch) => ch.cardId, action: 'pick-trainee',
    row: (ch) => html`<img src="${charImg(ch)}" alt="" class="thumb thumb-sm" />${ch.name}<span class="suggest-r">${ch.title}</span>`,
    pick: (ch) => pickTrainee(ch.cardId),
  })}
  <div class="small muted">${COPY.trainee.empty}</div>`;

export function renderTrainee(c: RunPlan) {
  const actions = c.trainee ? html`<button class="small" data-action="clear-trainee" @click=${() => pickTrainee(null)}>${COPY.trainee.change}</button>` : nothing;
  return panel({ title: COPY.trainee.title, step: 1, tip: COPY.trainee.tip, actions }, c.trainee ? chosen(c) : picker());
}
