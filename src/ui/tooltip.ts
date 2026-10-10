// Custom tooltips: one floating box positioned next to the hovered, focused or clicked ⓘ. The box lives outside the lit
// root, like the dialogs, so writing its text and position directly is allowed.
import { html } from 'lit-html';

/** Info icon that opens the tooltip on hover or focus; a click pins it until the next click elsewhere. Any element
 * with a data-tip attribute shows the same box; dedicated icons and non-interactive elements pin on click. */
export const tip = (text: string) => html`<span class="tip" tabindex="0" data-tip="${text}" aria-label="${text}">i</span>`;

let pinned: HTMLElement | null = null;
/** After a click, hover tips wait for the pointer to move: a re-render can put another control under a still pointer,
 * and the browser then reports a hover the user never made. */
let awaitingMove = false;

let box: HTMLElement | null = null;

function show(el: HTMLElement) {
  if (!box) return;
  box.textContent = el.dataset.tip ?? '';
  box.classList.add('show');
  const r = el.getBoundingClientRect();
  const w = box.offsetWidth, h = box.offsetHeight;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = r.top - h - 6;
  box.style.left = `${left}px`; box.style.top = `${top}px`;
}
function hide(force = false) {
  if (pinned && !force) return;
  box?.classList.remove('show');
  if (force) { pinned?.classList.remove('pinned'); pinned = null; }
}
const tipOf = (ev: Event) => (ev.target as HTMLElement).closest<HTMLElement>('[data-tip]');
/** Buttons and links carry a tip for hover and focus only; a click on them must reach their own handler, and it
 * closes the box, which otherwise stays open on the focused control (and its text goes stale once the label changes). */
const interactive = (el: HTMLElement) => !!el.closest('button, a, select, input, summary, label');

export function installTooltips(root: HTMLElement) {
  box = document.createElement('div');
  box.id = 'tooltip';
  box.setAttribute('role', 'tooltip');
  document.body.append(box);
  root.addEventListener('mousemove', () => { awaitingMove = false; });
  root.addEventListener('mouseover', (ev) => { if (pinned || awaitingMove) return; const el = tipOf(ev); if (el) show(el); });
  root.addEventListener('mouseout', (ev) => { if (tipOf(ev)) hide(); });
  root.addEventListener('focusin', (ev) => { if (pinned) return; const el = tipOf(ev); if (el) show(el); });
  root.addEventListener('focusout', (ev) => { if (tipOf(ev)) hide(); });
  document.addEventListener('click', (ev) => {
    const el = tipOf(ev);
    if (el && (el.classList.contains('tip') || !interactive(el))) {
      ev.preventDefault();
      ev.stopPropagation();
      if (pinned === el) { hide(true); return; }
      hide(true); pinned = el; el.classList.add('pinned'); show(el);
      return;
    }
    hide(true);
    awaitingMove = true;
  }, true);
}
