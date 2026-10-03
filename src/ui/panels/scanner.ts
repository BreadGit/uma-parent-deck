// The scanner embedded in the planner: loaded on first use, shown as a sheet over the page, and ending in the
// store's inventory. The session outlives the sheet, so closing and reopening keeps the screenshots and the review.
import { html, nothing } from 'lit-html';
import { effectiveLb } from '../../model/run.ts';
import type { Card } from '../../types.ts';
import type { Scanner } from '../../scanner/session.ts';
import { data, refresh, store, update, view } from '../context.ts';
import { SCANNER_COPY as C } from '../copy.ts';
import { notice } from '../dialog.ts';

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
    } catch (error) {
      console.error('Scanner could not load:', error);
      void notice(C.scannerLoadFailed);
      return;
    } finally { view.scannerLoading = false; refresh(); }
  }
  view.scannerOpen = true;
  document.body.classList.add('scanner-open');
  refresh();
  document.querySelector<HTMLDialogElement>('[data-scanner]')?.showModal();
  document.querySelector<HTMLElement>('[data-action="close-scanner"]')?.focus();
}
/** Closes the sheet; its `close` event then releases the page, as it does for Escape and the system back gesture. */
export function closeScanner() {
  const sheet = document.querySelector<HTMLDialogElement>('[data-scanner]');
  if (sheet?.open) sheet.close();
  else onClosed();
}
/** Every way the sheet closes ends here, including those the browser starts without a cancelable `cancel` event. */
function onClosed() {
  if (!view.scannerOpen) return;
  view.scannerOpen = false;
  document.body.classList.remove('scanner-open');
  refresh();
  document.querySelector<HTMLElement>('[data-action="open-scanner"]')?.focus();
}

/** Wrap Tab at the first and last visible enabled controls. */
function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Tab' || e.defaultPrevented) return;
  const sheet = e.currentTarget as HTMLDialogElement;
  const controls = [...sheet.querySelectorAll<HTMLElement>('button, input, select, summary, a[href], [tabindex]')]
    .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length
      && !(el instanceof HTMLInputElement && el.type === 'radio' && !el.checked));
  const first = controls[0], last = controls.at(-1);
  const target = e.shiftKey && document.activeElement === first ? last : !e.shiftKey && document.activeElement === last ? first : null;
  if (target) { e.preventDefault(); target.focus(); }
}

export function renderScannerOverlay() {
  if (!view.scannerOpen || !scanner) return nothing;
  return html`<dialog class="scanner-sheet" aria-label=${C.title} data-scanner
    @keydown=${onKeyDown}
    @close=${onClosed}
    @click=${(e: MouseEvent) => {
      if (e.target !== e.currentTarget) return;
      const bounds = (e.currentTarget as HTMLDialogElement).getBoundingClientRect();
      if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) closeScanner();
    }}>
    <header class="scanner-sheet-head">
      <button class="scanner-back" data-action="close-scanner" @click=${closeScanner}>${C.closeScanner}</button>
      <div><h1>${C.title}</h1><p class="muted">${C.subtitleEmbedded}</p></div>
    </header>
    <main class="scan-main">${scanner.render()}</main>
  </dialog>`;
}
