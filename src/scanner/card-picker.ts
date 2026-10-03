import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import { SCANNER_COPY as C } from '../ui/copy.ts';
import { inputValue } from '../ui/form.ts';
import { artworkUrl } from './images.ts';
import type { ScanCard } from './recognize.ts';

const title = (card: ScanCard) =>
  card.name.endsWith(card.charName) ? card.name.slice(0, -card.charName.length).trim() : card.name;
const label = (card: ScanCard) => `${card.charName} · ${card.rarity} · ${title(card)} · ${card.type}`;

// Search is temporary: only choosing a result changes the reviewed inventory.
// Keep this state separate from the planner's persisted store and search fields.
export function createCardPicker(catalog: ScanCard[], change: () => void) {
  let active: number | null = null, query = '', index = -1;
  const close = () => { active = null; query = ''; index = -1; };
  // Losing focus can be the render removing this picker's row (a completed card leaves the decisions), and that
  // render is still committing; repaint after it, never inside it.
  const dismiss = () => { if (active === null) return; close(); queueMicrotask(change); };
  // Focus can move within the picker: Chrome focuses a scrolling list when its scrollbar is dragged. The list stays
  // out of the tab order (tabindex -1), so Tab still leaves the picker and dismisses it.
  const onFocusOut = (event: FocusEvent) => {
    if (!(event.currentTarget as Element).contains(event.relatedTarget as Node | null)) dismiss();
  };
  /** Rows keep focus in the search field, so pressing one does not dismiss the list first. */
  const keepFocus = (event: Event) => event.preventDefault();
  function picker(key: number, selected: ScanCard | null | undefined, pick: (id: number) => void) {
    const open = active === key;
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = open ? catalog.filter(card => words.every(word => label(card).toLowerCase().includes(word))) : [];
    const id = `scan-card-${key}`, listId = `${id}-list`;
    const choose = (card: ScanCard) => { close(); pick(card.id); };
    const show = () => { if (!open) { active = key; query = ''; index = -1; change(); } };
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!open) { show(); return; }
        if (!matches.length) return;
        index = index < 0 ? (event.key === 'ArrowDown' ? 0 : matches.length - 1)
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
        change();
        const list = document.getElementById(listId);
        const option = list?.querySelector<HTMLElement>('[aria-selected="true"]');
        if (list && option) {
          if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
          else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight)
            list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
        }
      } else if (event.key === 'Enter' && open) {
        event.preventDefault();
        // Enter confirms a highlighted result, or a typed query that leaves only one card.
        const card = index >= 0 ? matches[index] : words.length && matches.length === 1 ? matches[0] : undefined;
        if (card) choose(card);
      }
    };
    return html`<div class="suggest scan-card-picker" @focusout=${onFocusOut}>
      <label for=${id}>${C.card}</label>
      <input id=${id} data-card=${key} data-card-id=${selected?.id ?? ''} type="search" role="combobox" class="wide"
        title=${selected ? label(selected) : C.selectCard} placeholder=${C.searchCards} autocomplete="off"
        .value=${live(open ? query : selected ? label(selected) : '')}
        aria-autocomplete="list" aria-expanded=${open} aria-controls=${listId}
        aria-activedescendant=${open && index >= 0 ? `${listId}-${matches[index]?.id}` : ''}
        @focus=${show} @click=${show} @keydown=${onKey}
        @input=${(event: Event) => { active = key; query = inputValue(event); index = -1; change(); }} />
      ${open ? html`<ul id=${listId} role="listbox" aria-label=${C.card} tabindex="-1">
        ${repeat(matches, card => card.id, (card, i) => html`<li id=${`${listId}-${card.id}`} role="option"
          aria-selected=${i === index} class=${i === index ? 'active' : ''} data-id=${card.id}
          @mousedown=${keepFocus} @click=${() => choose(card)}>
          <img src=${artworkUrl(card.id)} alt="" loading="lazy" />
          <span class="two-line"><span>${card.charName} <span class="muted">(${card.rarity} ${card.type})</span></span>
            <span class="muted small">${title(card)}</span></span>
        </li>`)}
        ${matches.length ? nothing
          : html`<li role="presentation" class="scan-no-matches" @mousedown=${keepFocus}><span role="status">${C.noCardMatches}</span></li>`}
      </ul>` : nothing}
    </div>`;
  }
  return { render: picker, close };
}
