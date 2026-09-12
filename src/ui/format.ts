// Small templates and formatters shared by the panels.
import { html, nothing, type TemplateResult } from 'lit-html';
import type { Card, Character, Skill, Stat } from '../types.ts';
import { data } from './context.ts';
import { tip } from './tooltip.ts';

/** Race win chances come in 5% steps, so they show whole percentages. */
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
/** Every other chance: one decimal above 1%, more below, and a floor for the vanishingly small. */
export const probability = (p: number) => p === 0 ? '0%' : p < 0.00001 ? '<0.001%' : `${(p * 100).toFixed(p < 0.001 ? 3 : p < 0.01 ? 2 : 1)}%`;
export const num = (x: number, d = 0) => x.toFixed(d);
/** A whole number with thousands separators, the same in every panel. */
export const int = (x: number) => Math.round(x).toLocaleString('en-US');
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A chance in a rounded panel, e.g. [19.6%]. Neutral by default: colour is reserved for a real warning. */
export const pill = (x: number, cls = '') => html`<span class="pill ${cls}">${probability(x)}</span>`;

export const skillName = (id: number) => data.skillById.get(id)?.name ?? `#${id}`;
export const skillIcon = (s: Skill | undefined) => (s?.iconId ? `/assets/skills/${s.iconId}.png` : '');
export const cardImg = (c: Card) => `/assets/supports/${c.id}.png`;
export const charImg = (c: Character) => `/assets/characters/${c.cardId}.png`;
export const cardUrl = (c: Card) => `https://gametora.com/umamusume/supports/${c.urlName}`;
export const cardLink = (c: Card, label?: string | TemplateResult) => html`<a class="card-link" href="${cardUrl(c)}" target="_blank" rel="noopener">${label ?? c.name}</a>`;
export const cardThumb = (c: Card, cls = 'thumb') => html`<a href="${cardUrl(c)}" target="_blank" rel="noopener"><img class="${cls}" src="${cardImg(c)}" alt="" loading="lazy" /></a>`;
export const typeIcon = (c: Card) => html`<img class="type-icon" src="/assets/icons/type_${c.type}.png" alt="${c.type}" />`;
/** A skill name with an info icon showing its description. */
export function skillWithTip(id: number, label?: string | TemplateResult): TemplateResult {
  const sk = data.skillById.get(id);
  return html`${label ?? sk?.name ?? `#${id}`}${sk?.desc ? tip(`${sk.name}${sk.rarity === 2 ? ' (gold)' : ''}: ${sk.desc}`) : nothing}`;
}
/** The game's icon for a stat, as used on the legacy screen and the trainee's stat strip. */
export const statIcon = (st: Stat) => html`<img class="stat-icon" src="/assets/icons/type_${st}.png" alt="${capitalize(st)}" />`;
