// The box lives outside the lit root, like the dialogs, so writing its text and position directly is allowed.
import { html } from 'lit-html';

export const tip = (text: string) => html`<span class="tip" tabindex="0" data-tip="${text}" aria-label="${text}">i</span>`;

const tipOf = (ev: Event) => (ev.target as HTMLElement).closest<HTMLElement>('[data-tip]');
/** A click on a control must reach its own handler, and closes the box, whose text would go stale once the label changes. */
const interactive = (el: HTMLElement) => !!el.closest('button, a, select, input, summary, label');

export function installTooltips(root: HTMLElement) {
  const box = document.createElement('div');
  box.id = 'tooltip';
  box.setAttribute('role', 'tooltip');
  document.body.append(box);
  let pinned: HTMLElement | null = null;
  /** After a click, hover tips wait for the pointer to move: a re-render can put another control under a still pointer,
   * and the browser then reports a hover the user never made. */
  let awaitingMove = false;
  const show = (el: HTMLElement) => {
    box.textContent = el.dataset.tip ?? '';
    box.classList.add('show');
    const r = el.getBoundingClientRect();
    const w = box.offsetWidth, h = box.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = r.top - h - 6;
    box.style.left = `${left}px`; box.style.top = `${top}px`;
  };
  const hide = (force = false) => {
    if (pinned && !force) return;
    box.classList.remove('show');
    if (force) { pinned?.classList.remove('pinned'); pinned = null; }
  };
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
