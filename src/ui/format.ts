// Small templates and formatters shared by the panels.
import { html, nothing, type TemplateResult } from 'lit-html';
import type { Card, Character, Skill } from '../types.ts';
import { data } from './context.ts';
import { tip } from './tooltip.ts';

export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
export const num = (x: number, d = 0) => x.toFixed(d);
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Percentage in a rounded panel, e.g. [95%]. */
export const pill = (x: number, cls = '', d = 0) => html`<span class="pill ${cls}">${pct(x, d)}</span>`;

export const skillName = (id: number) => data.skillById.get(id)?.name ?? `#${id}`;
export const skillIcon = (s: Skill | undefined) => (s?.iconId ? `/assets/skills/${s.iconId}.png` : '');
export const cardImg = (c: Card) => `/assets/supports/${c.id}.png`;
export const charImg = (c: Character) => `/assets/characters/${c.cardId}.png`;
export const cardUrl = (c: Card) => `https://gametora.com/umamusume/supports/${c.urlName}`;
export const cardLink = (c: Card, label?: string) => html`<a class="card-link" href="${cardUrl(c)}" target="_blank" rel="noopener">${label ?? c.name}</a>`;
export const cardThumb = (c: Card, cls = 'thumb') => html`<a href="${cardUrl(c)}" target="_blank" rel="noopener"><img class="${cls}" src="${cardImg(c)}" alt="" loading="lazy" /></a>`;
export const typeIcon = (c: Card) => html`<img class="type-icon" src="/assets/icons/type_${c.type}.png" alt="${c.type}" title="${c.type}" />`;
export const typeTag = (c: Card) => html`<span class="tag type-${c.type}">${c.type}</span>`;
/** A skill name with an info icon showing its description. */
export function skillWithTip(id: number, label?: string | TemplateResult): TemplateResult {
  const sk = data.skillById.get(id);
  return html`${label ?? sk?.name ?? `#${id}`}${sk?.desc ? tip(`${sk.name}${sk.rarity === 2 ? ' (gold)' : ''}: ${sk.desc}`) : nothing}`;
}
