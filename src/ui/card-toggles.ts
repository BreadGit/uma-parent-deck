// The pin and ignore buttons a card carries in the suggested deck and the card ranking. Both read the persisted
// run, so the same card shows the same state everywhere it appears.
import { html } from 'lit-html';
import type { Card } from '../types.ts';
import { store } from './context.ts';
import { ignoreCard, pinCard, unignoreCard, unpinCard } from './actions.ts';
import { COPY } from './copy.ts';

const PIN_ICON = html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M22.3126 10.1753L20.8984 11.5895L20.1913 10.8824L15.9486 15.125L15.2415 18.6606L13.8273 20.0748L9.58466 15.8321L4.63492 20.7819L3.2207 19.3677L8.17045 14.4179L3.92781 10.1753L5.34202 8.76107L8.87756 8.05396L13.1202 3.81132L12.4131 3.10422L13.8273 1.69L22.3126 10.1753Z"></path></svg>`;
// a circle with a slash: "not this one"
const IGNORE_ICON = html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"></circle><path d="M6 6l12 12"></path></svg>`;

const cardName = (card: Card) => `${card.charName} [${card.title}]`;

function toggle(action: string, card: Card, active: boolean, label: string, icon: unknown, onClick: () => void) {
  return html`<button type="button" class="card-toggle ${active ? 'active' : ''}" data-action=${action} data-id=${card.id}
    aria-label=${label} aria-pressed=${active} data-tip=${label} @click=${onClick}>${icon}</button>`;
}

export function pinToggle(card: Card) {
  const pinned = store.run.pinnedIds.includes(card.id);
  const label = pinned ? COPY.cards.unpin(cardName(card)) : COPY.cards.pin(cardName(card));
  return toggle('toggle-card-pin', card, pinned, label, PIN_ICON, () => (pinned ? unpinCard(card.id) : pinCard(card.id)));
}

export function ignoreToggle(card: Card) {
  const ignored = store.run.ignoredIds.includes(card.id);
  const label = ignored ? COPY.cards.unignore(cardName(card)) : COPY.cards.ignore(cardName(card));
  return toggle('toggle-card-ignore', card, ignored, label, IGNORE_ICON, () => (ignored ? unignoreCard(card.id) : ignoreCard(card.id)));
}
