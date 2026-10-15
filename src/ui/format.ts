import { html, nothing, type TemplateResult } from 'lit-html';
import { isGold, STATS, type Card, type Character, type Skill, type Stat } from '../types.ts';
import { APTITUDE_LABELS, type PinkGoal } from '../model/goal-input.ts';
import { data } from './context.ts';
import { tip } from './tooltip.ts';

/** Race win chances come in 5% steps, so they show whole percentages. */
export const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
/** Every other chance: one decimal above 1%, more below, and a floor for the vanishingly small. */
export const probability = (p: number) => p === 0 ? '0%' : p > .999 && p < 1 - 1e-12 ? '>99.9%' : p < 0.00001 ? '<0.001%' : `${(p * 100).toFixed(p < 0.001 ? 3 : p < 0.01 ? 2 : 1)}%`;
export const estimatedProbability = (p: number) => p >= .999 ? '>99.9%' : probability(p);
export const num = (x: number, d = 0) => x.toFixed(d);
export const int = (x: number) => Math.round(x).toLocaleString('en-US');
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const blueStatsLabel = (stats: readonly Stat[]) => stats.length === STATS.length ? 'any stat' : stats.map(capitalize).join(', ') || 'none selected';
export const pinkAptitudeName = (aptitude: PinkGoal['aptitude']) => aptitude === 'any' ? 'Any' : APTITUDE_LABELS[aptitude];
export const pinkGoalLabel = (p: PinkGoal) => `${pinkAptitudeName(p.aptitude)} ${p.stars}★+`;
/** A chance in a rounded badge, e.g. [19.6%]. Neutral unless `cls` is 'warn': colour is reserved for a real warning. */
export const pill = (chance: string, cls = '') => html`<span class="pill ${cls}">${chance}</span>`;

export const skillName = (id: number) => data.skillById.get(id)?.name ?? `#${id}`;
export const skillIcon = (s: Skill | undefined) => (s?.iconId ? `/assets/skills/${s.iconId}.png` : '');
export const cardImg = (c: Card) => `/assets/supports/${c.id}.png`;
export const charImg = (c: Character) => `/assets/characters/${c.cardId}.png`;
export const cardUrl = (c: Card) => `https://gametora.com/umamusume/supports/${c.urlName}`;
export const cardLink = (c: Card, label?: string | TemplateResult) => html`<a class="card-link" href="${cardUrl(c)}" target="_blank" rel="noopener">${label ?? c.name}</a>`;
export const cardThumb = (c: Card, cls = 'thumb') => html`<a href="${cardUrl(c)}" target="_blank" rel="noopener"><img class="${cls}" src="${cardImg(c)}" alt="" loading="lazy" /></a>`;
export const typeIcon = (c: Card) => html`<img class="type-icon" src="/assets/icons/type_${c.type}.png" alt="${c.type}" />`;
export function skillTipText(id: number, note?: string): string {
  const sk = data.skillById.get(id);
  return [sk?.desc ? `${sk.name}${isGold(sk) ? ' (gold)' : ''}: ${sk.desc}` : '', note ?? ''].filter(Boolean).join('\n\n');
}
export function skillWithTip(id: number, label?: string | TemplateResult, note?: string): TemplateResult {
  const text = skillTipText(id, note);
  return html`${label ?? skillName(id)}${text ? tip(text) : nothing}`;
}
export const statIcon = (st: Stat) => html`<img class="stat-icon" src="/assets/icons/type_${st}.png" alt="${capitalize(st)}" />`;
