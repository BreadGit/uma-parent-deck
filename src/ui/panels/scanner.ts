// The scanner embedded in the planner: loaded on first use, shown as a sheet over the page, and ending in the
// store's inventory. The session outlives the sheet, so closing and reopening keeps the screenshots and the review.
import { html, nothing } from 'lit-html';
import { effectiveLb } from '../../model/run.ts';
import type { Card } from '../../types.ts';
import type { Scanner } from '../../scanner/session.ts';
import { data, refresh, store, update, view } from '../context.ts';
import { SCANNER_COPY as C } from '../copy.ts';

let scanner: Scanner | null = null;

export async function openScanner() {
  if (!scanner) {
    if (view.scannerLoading) return;
    view.scannerLoading = true; refresh();
    try {
      const { createScanner } = await import('../../scanner/session.ts');
      scanner = createScanner({
        cards: data.cards,
        onChange: refresh,
        apply: {
          current: () => store.inventory,
          effective: (card) => effectiveLb(store.inventory, card as Card, store.settings.defaultLb),
          onApply: (inventory) => { update((s) => { s.inventory = inventory; }); closeScanner(); },
        },
      });
    } finally { view.scannerLoading = false; }
  }
  view.scannerOpen = true;
  document.body.classList.add('scanner-open');
  refresh();
  document.querySelector<HTMLElement>('[data-action="close-scanner"]')?.focus();
}
export function closeScanner() {
  view.scannerOpen = false;
  document.body.classList.remove('scanner-open');
  refresh();
  document.querySelector<HTMLElement>('[data-action="open-scanner"]')?.focus();
}

export function renderScannerOverlay() {
  if (!view.scannerOpen || !scanner) return nothing;
  return html`<div class="scanner-backdrop" data-scanner-backdrop @click=${closeScanner}></div>
  <div class="scanner-sheet" role="dialog" aria-modal="true" aria-label=${C.title} data-scanner
    @keydown=${(e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) closeScanner(); }}>
    <header class="scanner-sheet-head">
      <button class="scanner-back" data-action="close-scanner" @click=${closeScanner}>${C.closeScanner}</button>
      <div><h1>${C.title}</h1><p class="muted">${C.subtitleEmbedded}</p></div>
    </header>
    <main class="scan-main">${scanner.render()}</main>
  </div>`;
}
