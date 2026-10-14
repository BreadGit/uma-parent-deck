// The trainee: who is being trained, at how many stars, and what she brings to the run herself.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { perStat } from '../../types.ts';
import type { Character } from '../../types.ts';
import type { RunPlan } from '../../model/run.ts';
import { clampStars, hasExactStarTable, STARS_MAX } from '../../model/trainee.ts';
import { data, store, update, view } from '../context.ts';
import { matchesWords, numbered, options, queryWords, selectValue } from '../form.ts';
import { searchBox, SUGGESTION_LIMIT } from '../fields.ts';
import { capitalize, charImg, skillName, statIcon } from '../format.ts';
import { panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

function matches(): Character[] {
  const words = queryWords(view.traineeQuery);
  if (!words.length) return [];
  return data.characters.filter((ch) => matchesWords(words, `${ch.name} ${ch.title}`))
    .sort((a, b) => a.name.localeCompare(b.name) || a.cardId - b.cardId).slice(0, SUGGESTION_LIMIT);
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
  const rarity = t.rarity;
  const starOptions = numbered(Array.from({ length: STARS_MAX }, (_, i) => i + 1).filter((k) => k >= rarity || k === store.run.traineeStars), (k) => `${k}★`);
  return html`
    <div class="trainee-card">
      <img class="thumb thumb-lg" src="${charImg(t)}" alt="" />
      <div class="trainee-id"><span class="trainee-k">${t.title}</span><span class="trainee-v">${t.name}</span></div>
      <label class="trainee-stars"><span class="trainee-k">Stars${tip("Her rarity after the pieces you have used on her. Sets the base stats and the unique skill's starting level.")}</span>
        <select data-select="trainee-stars" .value=${live(String(store.run.traineeStars))} @change=${(e: Event) => update((s) => { s.run.traineeStars = Number(selectValue(e)); })}>${options(starOptions, String(store.run.traineeStars))}</select></label>
    </div>
    ${store.run.traineeStars < rarity ? html`<p class="small warn" data-trainee-rarity-note>Your saved star count is kept. Estimates use this trainee's current minimum of ${rarity} stars.</p>` : nothing}
    <div class="facts small">
      <span class="fact-k">Base stats</span>
      <span class="stat-strip">${perStat((st, i) => html`<span>${statIcon(st)}${t.baseStats[i]}</span>`)}${hasExactStarTable(data.charByCardId.get(t.cardId)!, store.run.traineeStars) ? nothing : html`<span class="warn">interpolated${tip(`GameTora lists no ${store.run.traineeStars}★ table for her, so these sit between the nearest listed star counts.`)}</span>`}</span>
      <span class="fact-k">Growth</span><span>${t.growth.some((g) => g > 0) ? perStat((s, i) => t.growth[i] > 0 ? `${capitalize(s)} +${t.growth[i]}%` : '').filter(Boolean).join(' · ') : 'none'}</span>
      <span class="fact-k">Innate</span><span>${skills(t.innateSkills)}</span>
      <span class="fact-k">Awakening</span><span>${skills(t.awakeningSkills)}</span>
    </div>`;
}

const picker = () => html`
  ${searchBox<Character>({
    id: 'trainee-search', label: 'Search trainees', placeholder: 'Search uma name or outfit…', field: 'traineeQuery', items: matches(), key: (ch) => ch.cardId, action: 'pick-trainee',
    row: (ch) => html`<img src="${charImg(ch)}" alt="" class="thumb thumb-sm" />${ch.name}<span class="suggest-r">${ch.title}</span>`,
    pick: (ch) => pickTrainee(ch.cardId),
  })}
  <div class="small muted">Pick the uma you will train.</div>`;

export function renderTrainee(c: RunPlan) {
  const actions = c.trainee ? html`<button class="small" data-action="clear-trainee" @click=${() => pickTrainee(null)}>Change</button>` : nothing;
  return panel({ title: 'Trainee', step: 1, tip: 'The uma you will train. Her own support cards leave the deck, her innate and awakening skills count as covered, and her growth rates and aptitudes feed the stat and race models.', actions }, c.trainee ? chosen(c) : picker());
}
