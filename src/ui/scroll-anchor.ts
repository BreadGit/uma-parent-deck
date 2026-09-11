// Preserve the reader's place across synchronous page renders, including completed deck searches.
const ANCHORS = 'input, select, textarea, button, summary, [data-wl-key], h2, h3, .deck .slot';
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

export function installScrollAnchor(root: HTMLElement) {
  let scrollingUntil = 0;
  let correctedY: number | undefined;
  const scrolling = () => { scrollingUntil = performance.now() + 180; };
  window.addEventListener('wheel', scrolling, { passive: true });
  window.addEventListener('touchmove', scrolling, { passive: true });
  window.addEventListener('keydown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (SCROLL_KEYS.has(event.key) && !target?.closest('input, select, textarea, button, summary, [contenteditable]')) scrolling();
  });
  window.addEventListener('scroll', () => {
    if (correctedY !== undefined && Math.abs(window.scrollY - correctedY) < 1) { correctedY = undefined; return; }
    scrolling();
  }, { passive: true });

  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) return false;
    // Rows in the inventory's own scroll area can have viewport coordinates while clipped by that area.
    const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    return !!hit && element.contains(hit);
  };

  // An inventory row can move inside its own scroll area. Keep that area's position on the page.
  const anchorOf = (element: HTMLElement) => {
    for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
    }
    return element;
  };

  return (draw: () => void) => {
    if (window.scrollY === 0 || performance.now() < scrollingUntil) { draw(); return; }
    const active = document.activeElement;
    const candidates = [...new Set([...root.querySelectorAll<HTMLElement>(ANCHORS)].filter(visible).map(anchorOf))];
    const focus = active instanceof HTMLElement && root.contains(active) && visible(active) ? anchorOf(active) : null;
    const row = focus?.closest<HTMLElement>('[data-wl-key], .slot, tr');
    const point = focus?.getBoundingClientRect().top ?? 0;
    const nearby = candidates.map((element) => ({ element, top: element.getBoundingClientRect().top }))
      .sort((a, b) => Math.abs(a.top - point) - Math.abs(b.top - point) || b.top - a.top);
    const anchors = [...(focus ? [focus] : []), ...(row ? [row] : [])]
      .map((element) => ({ element, top: element.getBoundingClientRect().top })).concat(nearby);
    draw();
    const anchor = anchors.find(({ element }) => root.contains(element) && element.getClientRects().length);
    if (!anchor) return;
    // Measure the remaining displacement, so any correction already made by the browser is not applied twice.
    const delta = anchor.element.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) < 1) return;
    window.scrollBy({ top: delta, behavior: 'instant' });
    correctedY = window.scrollY;
  };
}
