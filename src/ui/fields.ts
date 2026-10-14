import { html, nothing, type TemplateResult } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { Card } from '../types.ts';
import { LIMIT_BREAKS } from '../model/rules.ts';
import type { RunPlan } from '../model/run.ts';
import { LABEL, TITLE } from './copy.ts';
import { renderNow, store, update, view } from './context.ts';
import type { SearchField } from './context.ts';
import { options, selectValue, inputValue, isComposing, type Option } from './form.ts';

export const SUGGESTION_LIMIT = 12;

interface SearchBox<T> {
  id: string;
  /** The input's accessible name; the placeholder disappears once the user types. */
  label: string;
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

/** Keys that belong to text an input method is composing are left to it. */
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
    renderNow();
    revealSuggestion(listId);
  };
  const setQuery = (q: string) => { view[box.field] = q; view.activeSearch = box.field; setIndex(-1); renderNow(); revealSuggestion(listId); };
  const choose = (item: T) => { setIndex(-1); view.activeSearch = null; box.pick(item); };
  const onKey = (e: KeyboardEvent) => {
    if (!open || isComposing(e)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = box.items.length;
      setIndex(index < 0 ? (e.key === 'ArrowDown' ? 0 : n - 1) : (index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
      renderNow();
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
    <input id=${box.id} type="search" role="combobox" aria-label=${box.label} placeholder=${box.placeholder} .value=${live(query)} data-input=${box.field} class="wide" autocomplete="off"
      aria-autocomplete="list" aria-expanded=${open} aria-controls=${listId} aria-activedescendant=${open && index >= 0 ? `${listId}-${index}` : ''}
      @focus=${focus} @input=${(e: Event) => setQuery(inputValue(e))} @keydown=${onKey} />
    ${open ? html`<ul id=${listId} role="listbox">${box.items.map((item, i) => html`<li id=${`${listId}-${i}`} role="option" aria-selected=${i === index} class=${i === index ? 'active' : ''} data-action=${box.action} data-id=${box.key(item)} @mousedown=${(e: Event) => e.preventDefault()} @click=${() => choose(item)}>${box.row(item)}</li>`)}</ul>` : nothing}
  </div>`;
}

export function installSuggestDismiss(root: HTMLElement) {
  root.ownerDocument.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('.suggest')) return;
    if (view.activeSearch === null) return;
    view.activeSearch = null;
    view.suggestIndexes = Object.fromEntries(Object.keys(view.suggestIndexes).map((field) => [field, -1])) as Record<SearchField, number>;
  });
}

/** Store a card's limit break explicitly so later rarity overrides cannot erase it. */
function setLb(card: Card, value: string) {
  update((s) => {
    const id = String(card.id);
    if (value === 'none') s.inventory[id] = null;
    else s.inventory[id] = Number(value);
  });
}
export function lbSelect(c: RunPlan, card: Card, lb: number, cls = '') {
  const owned = !c.unowned.has(card.id);
  const overridden = store.settings.inventoryOverrides[card.rarity] !== null;
  const explicit = store.inventory[String(card.id)] !== undefined;
  const current = owned ? String(lb) : 'none';
  const items: Option[] = [{ value: 'none', label: 'not owned' }, ...LIMIT_BREAKS.map((l) => ({ value: String(l), label: `${l}${overridden && lb === l ? ' (override)' : ''}` }))];
  return html`<select data-lb=${card.id} class="${cls} ${explicit && !overridden ? '' : 'muted'}" aria-label="Limit break" .value=${live(current)} ?disabled=${overridden} data-tip=${overridden ? `${card.rarity} cards use a rarity override. Choose ${LABEL.useInventory} in ${TITLE.advanced} to edit individual cards.` : nothing} @change=${(e: Event) => setLb(card, selectValue(e))}>${options(items, current)}</select>`;
}
