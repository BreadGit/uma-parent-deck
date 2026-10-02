// Form field helpers shared by the panels: option lists for live-bound selects, event value readers, the search
// box with its suggestion list, and the limit-break select the deck and the ranking share.
import { html, nothing, type TemplateResult } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { Card } from '../types.ts';
import type { RunPlan } from '../model/run.ts';
import { COPY } from './copy.ts';
import { refresh, store, update, view } from './context.ts';
import type { SearchField } from './context.ts';

export { options, numbered, selectValue, inputValue, inputNumber, isChecked } from './form.ts';
export type { Option } from './form.ts';
import { options, selectValue, inputValue, type Option } from './form.ts';

export interface SearchBox<T> {
  id: string;
  placeholder: string;
  /** Which view field holds the query; the smoke test reads it from data-input. */
  field: SearchField;
  items: T[];
  key: (item: T) => number;
  action: string;
  row: (item: T) => TemplateResult;
  pick: (item: T) => void;
}

/** Scroll one container just enough to show a box, leaving the page and every other scroll area where they are. */
function scrollToShow(container: HTMLElement, box: DOMRect) {
  const top = container.getBoundingClientRect().top + container.clientTop;
  const bottom = top + container.clientHeight;
  if (box.top < top) container.scrollTop += box.top - top;
  else if (box.bottom > bottom) container.scrollTop += box.bottom - bottom;
}

/**
 * Reveal the highlighted row, or the whole list when none is highlighted, by scrolling the list and then the input
 * column it opens inside: the column clips the list when it drops past the column's end.
 */
function revealSuggestion(listId: string) {
  const list = document.getElementById(listId);
  if (!list) return;
  const active = list.querySelector<HTMLElement>('[aria-selected="true"]');
  if (active) scrollToShow(list, active.getBoundingClientRect());
  const column = list.closest<HTMLElement>('[data-inputs]');
  if (column) scrollToShow(column, (active ?? list).getBoundingClientRect());
}

/**
 * A search input with a suggestion list under it. Arrow keys move the highlight, Enter picks the highlighted item
 * (or the first match), Escape clears the query, and a click outside the box closes it.
 */
export function searchBox<T>(box: SearchBox<T>) {
  const query = view[box.field];
  const open = box.items.length > 0 && view.activeSearch === box.field;
  const savedIndex = open ? view.suggestIndexes[box.field] : -1;
  const index = box.items[savedIndex] ? savedIndex : -1;
  const listId = `${box.id}-list`;
  const setIndex = (value: number) => { view.suggestIndexes = { ...view.suggestIndexes, [box.field]: value }; };
  const focus = () => {
    if (view.activeSearch === box.field) return;
    view.activeSearch = box.field;
    refresh();
    revealSuggestion(listId);
  };
  const setQuery = (q: string) => { view[box.field] = q; view.activeSearch = box.field; setIndex(-1); refresh(); revealSuggestion(listId); };
  const choose = (item: T) => { setIndex(-1); view.activeSearch = null; box.pick(item); };
  const onKey = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = box.items.length;
      setIndex(index < 0 ? (e.key === 'ArrowDown' ? 0 : n - 1) : (index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
      refresh();
      revealSuggestion(listId);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = box.items[index] ?? box.items[0];
      if (item) choose(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setQuery('');
    }
  };
  return html`<div class="suggest" data-suggest=${box.id}>
    <input id=${box.id} type="search" role="combobox" placeholder=${box.placeholder} .value=${live(query)} data-input=${box.field} class="wide" autocomplete="off"
      aria-autocomplete="list" aria-expanded=${open} aria-controls=${listId} aria-activedescendant=${open && index >= 0 ? `${listId}-${index}` : ''}
      @focus=${focus} @input=${(e: Event) => setQuery(inputValue(e))} @keydown=${onKey} />
    ${open ? html`<ul id=${listId} role="listbox">${box.items.map((item, i) => html`<li id=${`${listId}-${i}`} role="option" aria-selected=${i === index} class=${i === index ? 'active' : ''} data-action=${box.action} data-id=${box.key(item)} @mousedown=${(e: Event) => e.preventDefault()} @click=${() => choose(item)}>${box.row(item)}</li>`)}</ul>` : nothing}
  </div>`;
}

/** Close any open suggestion list when the user clicks outside its box. */
export function installSuggestDismiss(root: HTMLElement) {
  root.ownerDocument.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('.suggest')) return;
    if (view.activeSearch === null) return;
    view.activeSearch = null;
    view.suggestIndexes = { requiredQuery: -1, preferredQuery: -1, traineeQuery: -1, cardQuery: -1, ignoreQuery: -1 };
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
