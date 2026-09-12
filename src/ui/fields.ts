// Form field helpers shared by the panels: option lists for live-bound selects, event value readers, the search
// box with its suggestion list, and the limit-break select the deck and the ranking share.
import { html, nothing, type TemplateResult } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import type { Card } from '../types.ts';
import type { RunPlan } from '../model/run.ts';
import { COPY } from './copy.ts';
import { refresh, store, update, view } from './context.ts';

export interface Option { value: string; label: string; cls?: string }

/**
 * Options for a <select> whose value is bound with `.value=${live(...)}`. The property binding is committed before
 * the options exist, so `selected` picks the initial option; the live binding keeps later renders in step. Options
 * are keyed by value: when a blank placeholder disappears, the remaining option elements must stay put, or the
 * browser keeps the old index and shows the wrong entry.
 */
export const options = (items: readonly Option[], current: string) =>
  repeat(items, (o) => o.value, (o) => html`<option value=${o.value} ?selected=${o.value === current} class=${o.cls ?? ''}>${o.label}</option>`);
export const numbered = (values: readonly number[], label: (n: number) => string): Option[] => values.map((n) => ({ value: String(n), label: label(n) }));

export const selectValue = (e: Event) => (e.target as HTMLSelectElement).value;
export const inputValue = (e: Event) => (e.target as HTMLInputElement).value;
export const inputNumber = (e: Event) => (e.target as HTMLInputElement).valueAsNumber;
export const isChecked = (e: Event) => (e.target as HTMLInputElement).checked;

export interface SearchBox<T> {
  id: string;
  placeholder: string;
  /** Which view field holds the query; the smoke test reads it from data-input. */
  field: 'query' | 'traineeQuery' | 'cardQuery';
  items: T[];
  key: (item: T) => number;
  action: string;
  row: (item: T) => TemplateResult;
  pick: (item: T) => void;
}

/**
 * A search input with a suggestion list under it. Arrow keys move the highlight, Enter picks the highlighted item
 * (or the first match), Escape clears the query, and a click outside the box closes it.
 */
export function searchBox<T>(box: SearchBox<T>) {
  const query = view[box.field];
  const open = box.items.length > 0;
  const index = view.suggestIndex;
  const listId = `${box.id}-list`;
  const setQuery = (q: string) => { view[box.field] = q; view.suggestIndex = -1; refresh(); };
  const choose = (item: T) => { view.suggestIndex = -1; box.pick(item); };
  const onKey = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = box.items.length;
      view.suggestIndex = ((index + (e.key === 'ArrowDown' ? 1 : -1)) % n + n) % n;
      refresh();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(box.items[Math.max(0, index)]!);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setQuery('');
    }
  };
  return html`<div class="suggest" data-suggest=${box.id}>
    <input id=${box.id} type="search" role="combobox" placeholder=${box.placeholder} .value=${live(query)} data-input=${box.field} class="wide" autocomplete="off"
      aria-autocomplete="list" aria-expanded=${open} aria-controls=${listId} aria-activedescendant=${open && index >= 0 ? `${listId}-${index}` : ''}
      @input=${(e: Event) => setQuery(inputValue(e))} @keydown=${onKey} />
    ${open ? html`<ul id=${listId} role="listbox">${box.items.map((item, i) => html`<li id=${`${listId}-${i}`} role="option" aria-selected=${i === index} class=${i === index ? 'active' : ''} data-action=${box.action} data-id=${box.key(item)} @mousedown=${(e: Event) => e.preventDefault()} @click=${() => choose(item)}>${box.row(item)}</li>`)}</ul>` : nothing}
  </div>`;
}

/** Close any open suggestion list when the user clicks outside its box. */
export function installSuggestDismiss(root: HTMLElement) {
  root.ownerDocument.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('.suggest')) return;
    if (!view.query && !view.traineeQuery && !view.cardQuery) return;
    view.query = view.traineeQuery = view.cardQuery = '';
    view.suggestIndex = -1;
    refresh();
  });
}

/** Set a card's limit break, or mark it not owned. The rarity's default LB means "no entry". */
function setLb(card: Card, value: string) {
  update((s) => {
    const id = String(card.id);
    if (value === 'none') s.inventory[id] = null;
    else if (Number(value) === s.settings.defaultLb[card.rarity]) delete s.inventory[id];
    else s.inventory[id] = Number(value);
  });
}
/** The LB dropdown shared by the deck slots and the ranking table. */
export function lbSelect(c: RunPlan, card: Card, lb: number, cls = '') {
  const owned = !c.unowned.has(card.id);
  const explicit = store.inventory[String(card.id)] !== undefined;
  const current = owned ? String(lb) : 'none';
  const items: Option[] = [{ value: 'none', label: COPY.fields.notOwned }, ...[0, 1, 2, 3, 4].map((l) => ({ value: String(l), label: `${l}${!explicit && lb === l ? ` ${COPY.fields.default}` : ''}` }))];
  return html`<select data-lb=${card.id} class="${cls} ${explicit ? '' : 'muted'}" aria-label="Limit break" .value=${live(current)} @change=${(e: Event) => setLb(card, selectValue(e))}>${options(items, current)}</select>`;
}
