// The box lives outside the lit root, like the dialogs, so writing its content and position directly is allowed.
import { html, render, type TemplateResult } from 'lit-html';

export const tip = (text: string) => html`<span class="tip" tabindex="0" data-tip="${text}" aria-label="${text}">i</span>`;

/** Rich tips: an element with `data-rich="kind:id"` shows what the provider registered for `kind` returns for `id`. */
const richTips = new Map<string, (id: string) => TemplateResult | null>();
export function registerRichTip(kind: string, provider: (id: string) => TemplateResult | null) { richTips.set(kind, provider); }
function richContent(el: HTMLElement): TemplateResult | null {
  const [kind = '', id = ''] = (el.dataset.rich ?? '').split(':');
  return richTips.get(kind)?.(id) ?? null;
}

const tipOf = (ev: Event) => (ev.target as HTMLElement).closest<HTMLElement>('[data-tip], [data-rich]');
/** A click on a control must reach its own handler, and closes the box, whose text would go stale once the label changes. */
const interactive = (el: HTMLElement) => !!el.closest('button, a, select, input, summary, label');

export function installTooltips(root: HTMLElement) {
  const box = document.createElement('div');
  box.id = 'tooltip';
  box.setAttribute('role', 'tooltip');
  const text = document.createElement('div');
  const rich = document.createElement('div');
  const close = document.createElement('button');
  close.className = 'tt-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Close');
  box.append(close, text, rich);
  document.body.append(box);
  let pinned: HTMLElement | null = null;
  let shownFor: HTMLElement | null = null;
  /** After a click, hover tips wait for the pointer to move: a re-render can put another control under a still pointer,
   * and the browser then reports a hover the user never made. */
  let awaitingMove = false;
  const place = (el: HTMLElement) => {
    // A fixed box's width depends on its position, so it is measured at the corner.
    box.style.left = '0px'; box.style.top = '0px';
    const r = el.getBoundingClientRect();
    const w = box.offsetWidth, h = box.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = r.top - h - 6;
    // A box taller than the room on either side stays on screen; its height is capped, so the rest scrolls.
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    box.style.left = `${left}px`; box.style.top = `${top}px`;
  };
  const show = (el: HTMLElement) => {
    const content = el.dataset.rich ? richContent(el) : null;
    box.classList.toggle('rich', !!content);
    render(content ?? html``, rich);
    text.textContent = content ? '' : el.dataset.tip ?? '';
    text.hidden = !!content; rich.hidden = !content;
    box.classList.add('show');
    shownFor = el;
    place(el);
  };
  const hide = (force = false) => {
    if (pinned && !force) return;
    box.classList.remove('show', 'pinned');
    shownFor = null;
    if (force) { pinned?.classList.remove('pinned'); pinned = null; }
  };
  /** Closing a tip from the keyboard puts focus back on what opened it, without opening it again. */
  let restoring = false;
  const closeTo = (el: HTMLElement | null) => { hide(true); restoring = true; el?.focus(); restoring = false; };
  /** A pinned box takes the pointer, so its text can be selected and its links followed, until it is closed. */
  const pin = (el: HTMLElement) => { hide(true); pinned = el; el.classList.add('pinned'); show(el); box.classList.add('pinned'); place(el); };
  root.addEventListener('mousemove', () => { awaitingMove = false; });
  root.addEventListener('mouseover', (ev) => { if (pinned || awaitingMove) return; const el = tipOf(ev); if (el) show(el); });
  root.addEventListener('mouseout', (ev) => { if (tipOf(ev)) hide(); });
  root.addEventListener('focusin', (ev) => { if (pinned || restoring) return; const el = tipOf(ev); if (el) show(el); });
  root.addEventListener('focusout', (ev) => { if (tipOf(ev)) hide(); });
  document.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).closest('#tooltip')) { if ((ev.target as HTMLElement).closest('.tt-close')) hide(true); return; }
    const el = tipOf(ev);
    if (el && (el.classList.contains('tip') || !interactive(el))) {
      ev.preventDefault();
      ev.stopPropagation();
      if (pinned === el) { hide(true); return; }
      pin(el);
      return;
    }
    hide(true);
    awaitingMove = true;
  }, true);
  // Enter or Space pins a focused tip and moves focus into it, so its links and close button can be reached; Escape returns.
  root.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const el = tipOf(ev);
    if (!el || el !== ev.target || (!el.classList.contains('tip') && interactive(el))) return;
    ev.preventDefault();
    if (pinned === el) { hide(true); return; }
    pin(el);
    (box.querySelector<HTMLElement>('a[href]') ?? close).focus();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !shownFor) return;
    if (box.contains(document.activeElement)) closeTo(pinned); else hide(true);
  });
  close.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); closeTo(pinned); } });
  window.addEventListener('scroll', () => { if (pinned) place(pinned); }, { passive: true, capture: true });
  // lit replaces the element a tip was opened from when it re-renders that part; its box then belongs to nothing.
  new MutationObserver(() => { if (shownFor && !shownFor.isConnected) hide(true); }).observe(root, { childList: true, subtree: true });
}
