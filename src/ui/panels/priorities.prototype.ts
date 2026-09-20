// PROTOTYPE: three renderings of the prioritized list, on the existing page, switchable with ?variant=A|B|C or the bar
// at the bottom of the page (dev builds only). All three share the model change in run.ts (layoutWishlist): a candidate
// whose every event a higher entry already takes is not listed, since the run takes one option per event. The variants
// differ in where the taken options live and how one is swapped in:
//   A  each row lists the options it displaced as chips; a click swaps them
//   B  the row's name is a dropdown of the event's options; changing it swaps
//   C  the list stays plain; a "Shared events" block below lists every contested event with its options
// Throwaway: fold the winner into priorities.ts and delete this file, the view field, the CSS block and the copy.
import { html, nothing, type TemplateResult } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import type { RunPlan, WishlistEvent } from '../../model/run.ts';
import type { WishlistEntry } from '../../model/deck.ts';
import { PRIORITIZED_SKILLS_MAX } from '../../model/rules.ts';
import { plan, refresh, store, update, view } from '../context.ts';
import { COPY } from '../copy.ts';
import { options, selectValue } from '../fields.ts';
import { skillWithTip } from '../format.ts';
import { panel, sub } from '../panel.ts';
import { candidates, drag, excludeSkill, nudgeSkill, requiredSkill, resetList } from './priorities.ts';

export const VARIANTS = [
  { key: 'A', name: 'Inline alternatives' },
  { key: 'B', name: 'Option dropdown' },
  { key: 'C', name: 'Shared events block' },
] as const;

/** Put `sibling` in `winner`'s place so it takes their shared event; the winner moves behind it. */
function swapSkill(sibling: number, winner: number) {
  const cur = plan().wl.map((w) => w.key).filter((k) => k !== sibling);
  const i = cur.indexOf(winner);
  if (i < 0) return;
  cur.splice(i, 0, sibling);
  update((s) => { s.run.wishlistOrder = cur; });
}
/** A required entry keeps its option: only a required sibling could outrank it, and one already would. */
const canSwap = (sibling: number, winner: number) => !requiredSkill(winner) || requiredSkill(sibling);

const layout = (c: RunPlan) => c.wlLayout;
const eventsWonBy = (c: RunPlan, key: number) => layout(c).events.filter((e) => e.winner === key);
/** Every other candidate on the events `key` takes, in list order, each with the events it shares with the winner. */
function siblingsOf(c: RunPlan, key: number): { entry: WishlistEntry; events: WishlistEvent[] }[] {
  const out = new Map<number, WishlistEvent[]>();
  for (const e of eventsWonBy(c, key)) for (const k of e.keys) if (k !== key) out.set(k, [...(out.get(k) ?? []), e]);
  return [...out].map(([k, events]) => ({ entry: layout(c).entries.get(k)!, events }));
}
const listedAt = (c: RunPlan, key: number) => { const i = c.wl.findIndex((w) => w.key === key); return i < 0 ? null : i + 1; };
const entryName = (w: WishlistEntry) => w.form ? `${w.name} (for ${w.form})` : w.name;

function kindTag(c: RunPlan, w: WishlistEntry) {
  const taken = w.gated && w.isTarget && !(layout(c).steers.get(w.key)?.length);
  const kind = COPY.priorities.kinds[taken ? 'taken' : w.gated ? (w.isTarget ? 'target' : 'other') : 'given'];
  const cls = taken ? 'warn' : w.gated ? (w.isTarget ? 'gold' : '') : 'warn';
  return html`<span class="tag ${cls} wl-kind" data-tip=${kind.tip}>${requiredSkill(w.skillId) ? 'required' : kind.label}</span>`;
}

/** A chip that swaps `sibling` in for `winner` at their shared event. */
function swapChip(c: RunPlan, sibling: WishlistEntry, winner: WishlistEntry, events: WishlistEvent[]) {
  const at = listedAt(c, sibling.key);
  const ok = canSwap(sibling.key, winner.key);
  const tipText = ok ? `${COPY.priorities.swapTip(sibling.name, events.map((e) => e.label).join(' and '))}\n\n${COPY.priorities.source}: ${sibling.reason}` : COPY.priorities.takenBy(winner.name);
  return html`<button class="wl-swap" data-action="wl-swap" data-id="${sibling.key}" data-for="${winner.key}" ?disabled=${!ok} data-tip=${tipText} @click=${() => swapSkill(sibling.key, winner.key)}>${entryName(sibling)}${at ? html` <span class="muted">${COPY.priorities.listedAt(at)}</span>` : nothing}</button>`;
}

function actions(c: RunPlan, w: WishlistEntry, i: number) {
  const canMove = (j: number) => j >= 0 && j < c.wl.length && requiredSkill(w.key) === requiredSkill(c.wl[j]!.key);
  return html`<span class="wl-actions">
      <button class="small wl-move" data-action="wl-up" data-id="${w.key}" aria-label="Move ${w.name} up" data-tip="Move up" ?disabled=${!canMove(i - 1)} @click=${() => nudgeSkill(w.key, -1)}>▲</button>
      <button class="small wl-move" data-action="wl-down" data-id="${w.key}" aria-label="Move ${w.name} down" data-tip="Move down" ?disabled=${!canMove(i + 1)} @click=${() => nudgeSkill(w.key, 1)}>▼</button>
      <button class="small wl-x" data-action="wl-exclude" data-id="${w.key}" aria-label="Remove ${w.name} from the list" data-tip="Remove from the list" @click=${() => excludeSkill(w.key)}>✕</button>
    </span>`;
}
const rowClass = (w: WishlistEntry) => `${view.drag.key === w.key ? 'dragging' : ''} ${view.drag.over === w.key && view.drag.key !== w.key ? 'drop-target' : ''}`;
const nameWithTip = (w: WishlistEntry) => skillWithTip(w.skillId, w.form ? html`${w.name} <span class="muted">(for ${w.form})</span>` : w.name, `${COPY.priorities.source}: ${w.reason}`);

/** Variant A: the options a row displaced sit under it as swap chips. */
function rowA(c: RunPlan, w: WishlistEntry, i: number) {
  const sibs = siblingsOf(c, w.key);
  return html`<li draggable="true" data-wl-key="${w.key}" class="${rowClass(w)}">
    <span class="wl-num">${i + 1}.</span><span class="grip" aria-hidden="true">⋮⋮</span>
    <span class="wl-body">${kindTag(c, w)}${nameWithTip(w)}
      ${sibs.length ? html`<div class="wl-alts small"><span class="muted">${COPY.priorities.instead}</span>${sibs.map((s) => swapChip(c, s.entry, w, s.events))}</div>` : nothing}
    </span>${actions(c, w, i)}</li>`;
}

/** Variant B: a row that takes a contested event shows that event's options as a dropdown in place of its name. */
function rowB(c: RunPlan, w: WishlistEntry, i: number) {
  const contested = eventsWonBy(c, w.key).filter((e) => e.keys.length > 1);
  const select = (e: WishlistEvent) => {
    const items = e.keys.map((k) => layout(c).entries.get(k)!).map((s) => ({ value: String(s.key), label: `${entryName(s)}${s.key !== w.key && !canSwap(s.key, w.key) ? ' (required keeps this)' : ''}` }));
    return html`<span class="wl-select-row"><select class="wl-select" data-action="wl-pick" data-for="${w.key}" data-event="${e.key}" aria-label="Option taken at ${e.label}" .value=${live(String(w.key))}
        @change=${(ev: Event) => { const k = Number(selectValue(ev)); if (canSwap(k, w.key)) swapSkill(k, w.key); else refresh(); }}>${options(items, String(w.key))}</select>
      ${skillWithTip(w.skillId, html`<span class="muted small">${e.label}</span>`, `${COPY.priorities.source}: ${w.reason}`)}</span>`;
  };
  return html`<li draggable="true" data-wl-key="${w.key}" class="${rowClass(w)}">
    <span class="wl-num">${i + 1}.</span><span class="grip" aria-hidden="true">⋮⋮</span>
    <span class="wl-body">${kindTag(c, w)}${contested.length ? contested.map(select) : nameWithTip(w)}</span>${actions(c, w, i)}</li>`;
}

/** Variant C: plain rows; the contested events are listed below the list, each with its taken option and the rest. */
function rowC(c: RunPlan, w: WishlistEntry, i: number) {
  return html`<li draggable="true" data-wl-key="${w.key}" class="${rowClass(w)}">
    <span class="wl-num">${i + 1}.</span><span class="grip" aria-hidden="true">⋮⋮</span>
    <span class="wl-body">${kindTag(c, w)}${nameWithTip(w)}</span>${actions(c, w, i)}</li>`;
}
function sharedEvents(c: RunPlan) {
  const events = layout(c).events;
  if (!events.length) return nothing;
  return html`${sub(COPY.priorities.sharedEvents, { note: COPY.priorities.sharedNote })}
    <ul class="wl-events small" data-shared-events>${events.map((e) => {
      const winner = layout(c).entries.get(e.winner)!;
      return html`<li><span class="wl-ev-label">${e.label}</span><b>${entryName(winner)}</b><span class="muted">${COPY.priorities.listedAt(listedAt(c, winner.key) ?? 0)}</span>
        <span class="muted">${COPY.priorities.instead}</span>${e.keys.filter((k) => k !== e.winner).map((k) => swapChip(c, layout(c).entries.get(k)!, winner, [e]))}</li>`;
    })}</ul>`;
}

const ROWS: Record<string, (c: RunPlan, w: WishlistEntry, i: number) => TemplateResult> = { A: rowA, B: rowB, C: rowC };

export function renderPrioritiesPrototype(c: RunPlan) {
  const variant = view.prototypeVariant;
  const row = ROWS[variant] ?? rowA;
  const customized = store.run.wishlistOrder.length > 0 || store.run.wishlistExcluded.length > 0;
  const hidden = layout(c).shadowed.length;
  const head = customized ? html`<button class="small" data-action="wl-reset" @click=${resetList}>${COPY.priorities.reset}</button>` : nothing;
  return panel({ title: COPY.priorities.title, kind: 'result', subtitle: `up to ${PRIORITIZED_SKILLS_MAX}${hidden ? `, ${hidden} taken option${hidden === 1 ? '' : 's'} not listed` : ''}`, tip: COPY.priorities.tip, actions: head }, html`
    ${c.wl.length ? html`<ol class="wishlist" @dragstart=${drag.dragstart} @dragover=${drag.dragover} @drop=${drag.drop} @dragend=${drag.dragend}>${repeat(c.wl, (w) => w.key, (w, i) => row(c, w, i))}</ol>` : html`<div class="muted small">${COPY.priorities.empty}</div>`}
    ${variant === 'C' ? sharedEvents(c) : nothing}
    ${candidates(c)}`);
}

// The floating switcher: arrows and ← → cycle the variant and keep it in the URL so a reload or a shared link keeps it.
let keysInstalled = false;
function setVariant(key: string) {
  view.prototypeVariant = key;
  const url = new URL(location.href);
  url.searchParams.set('variant', key);
  history.replaceState(history.state, '', url);
  refresh();
}
function cycle(delta: number) {
  const i = VARIANTS.findIndex((v) => v.key === view.prototypeVariant);
  setVariant(VARIANTS[((i < 0 ? 0 : i) + delta + VARIANTS.length) % VARIANTS.length]!.key);
}
export function prototypeBar() {
  if (!import.meta.env.DEV) return nothing;
  if (!keysInstalled) {
    keysInstalled = true;
    window.addEventListener('keydown', (ev) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable]'))) return;
      if (ev.key === 'ArrowLeft') cycle(-1); else if (ev.key === 'ArrowRight') cycle(1);
    });
  }
  const cur = VARIANTS.find((v) => v.key === view.prototypeVariant) ?? VARIANTS[0];
  return html`<div class="proto-bar" data-prototype-bar><button @click=${() => cycle(-1)} aria-label="Previous variant">←</button><span>${cur.key} (${cur.name})</span><button @click=${() => cycle(1)} aria-label="Next variant">→</button></div>`;
}

