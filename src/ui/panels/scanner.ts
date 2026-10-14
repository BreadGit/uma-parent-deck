import { html, nothing } from 'lit-html';
import type { Scanner } from '../../scanner/session.ts';
import { renderNow, store, update, view } from '../context.ts';
import { TITLE } from '../copy.ts';
import { notice } from '../dialog.ts';

let scanner: Scanner | null = null;

export async function openScanner() {
  if (!scanner) {
    if (view.scannerLoading) return;
    view.scannerLoading = true;
    try {
      // The scanner's own catalog, as on the standalone page: it knows which cards have a matching reference.
      const [{ createScanner }, { cards }] = await Promise.all([import('../../scanner/session.ts'), import('virtual:scanner-catalog')]);
      scanner = createScanner({
        cards,
        onChange: renderNow,
        apply: {
          current: () => store.inventory,
          onApply: (edit) => { update((s) => { s.inventory = edit(s.inventory); }); closeScanner(); },
        },
      });
    } catch (error) {
      console.error('Scanner could not load:', error);
      void notice('Could not open screenshot import. Check your connection and try again. If it keeps failing, reload the page.');
      return;
    } finally { view.scannerLoading = false; }
  }
  view.scannerOpen = true;
  document.body.classList.add('scanner-open');
  renderNow();
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
  renderNow();
  document.querySelector<HTMLElement>('[data-action="open-scanner"]')?.focus();
}

function wrapTabFocus(e: KeyboardEvent) {
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
  return html`<dialog class="scanner-sheet" aria-label=${TITLE.scanner} data-scanner
    @keydown=${wrapTabFocus}
    @close=${onClosed}
    @click=${(e: MouseEvent) => {
      if (e.target !== e.currentTarget) return;
      const bounds = (e.currentTarget as HTMLDialogElement).getBoundingClientRect();
      if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) closeScanner();
    }}>
    <header class="scanner-sheet-head">
      <button class="scanner-back" data-action="close-scanner" @click=${closeScanner}>← Back to planner</button>
      <div><h1>${TITLE.scanner}</h1><p class="muted">Read support cards and limit breaks from screenshots, check the readings, then apply them to your inventory.</p></div>
    </header>
    <main class="scan-main">${scanner.render()}</main>
  </dialog>`;
}
