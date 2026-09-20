// The prioritized-skill list to enter in independent training. Target rows follow Parent goal and are fixed; the
// extras below them are the user's to reorder, hide, add and swap. The run takes one option per event, so an extra
// that takes a shared event carries the options it displaced as swap chips; one click puts that option in its place.
// While a deck search runs the extras are locked, since the deck found may offer different ones. Each skill's
// tooltip ends with the event or card that gives it; the choice conflicts are listed in the warnings panel.
import { html, nothing } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import type { RunPlan, WishlistEvent } from '../../model/run.ts';
import type { WishlistEntry } from '../../model/deck.ts';
import { PRIORITIZED_SKILLS_MAX } from '../../model/rules.ts';
import { plan, refresh, searchState, store, update, view } from '../context.ts';
import { COPY } from '../copy.ts';
import { skillWithTip } from '../format.ts';
import { panel } from '../panel.ts';

const isExtra = (w: WishlistEntry) => w.role === 'extra';
/** The extras as shown, in order; the saved order is rewritten from these so an edit pins every visible extra. */
const shownExtras = () => plan().wl.filter(isExtra).map((w) => w.key);
const saveOrder = (keys: number[]) => update((s) => { s.run.wishlistOrder = keys; });

function hideSkill(key: number) {
  update((s) => { s.run.wishlistExcluded = [...new Set([...s.run.wishlistExcluded, key])]; s.run.wishlistOrder = s.run.wishlistOrder.filter((x) => x !== key); });
}
function restoreSkill(key: number) {
  update((s) => { s.run.wishlistExcluded = s.run.wishlistExcluded.filter((x) => x !== key); });
}
/** Put an unlisted extra first among the extras, so it shows whenever the targets leave any slot free. */
function addSkill(key: number) {
  saveOrder([key, ...shownExtras().filter((x) => x !== key)]);
}
/** Move an extra to another extra's place; the arrows and the drag handlers both end up here. */
function moveSkill(from: number, to: number) {
  const cur = shownExtras();
  const i = cur.indexOf(from), j = cur.indexOf(to);
  if (i < 0 || j < 0 || i === j) return; // stale key after a re-render, or a target row
  cur.splice(i, 1); cur.splice(j, 0, from);
  saveOrder(cur);
}
function nudgeSkill(key: number, delta: number) {
  const cur = shownExtras();
  const i = cur.indexOf(key), j = i + delta;
  if (i < 0 || j < 0 || j >= cur.length) return;
  moveSkill(key, cur[j]!);
}
/** Put `sibling` in `winner`'s place so it takes their shared event; the winner moves behind it. */
function swapSkill(sibling: number, winner: number) {
  const cur = shownExtras().filter((k) => k !== sibling);
  const i = cur.indexOf(winner);
  if (i < 0) return;
  cur.splice(i, 0, sibling);
  saveOrder(cur);
}
const resetExtras = () => update((s) => { s.run.wishlistOrder = []; s.run.wishlistExcluded = []; });

// Drag state lives in the view and the classes are rendered from it, so no handler touches lit's elements.
const dragItem = (ev: Event) => (ev.target as HTMLElement).closest<HTMLElement>('li[data-wl-key][draggable="true"]');
const setDrag = (key: number | null, over: number | null) => {
  if (view.drag.key === key && view.drag.over === over) return;
  view.drag = { key, over };
  refresh();
};
const drag = {
  dragstart: (ev: DragEvent) => { const li = dragItem(ev); if (!li) return; const key = Number(li.dataset.wlKey); ev.dataTransfer?.setData('text/plain', String(key)); setDrag(key, null); },
  dragover: (ev: DragEvent) => { const li = dragItem(ev); if (!li || view.drag.key == null) return; ev.preventDefault(); setDrag(view.drag.key, Number(li.dataset.wlKey)); },
  drop: (ev: DragEvent) => { const li = dragItem(ev); const from = view.drag.key; if (!li || from == null) return; ev.preventDefault(); setDrag(null, null); moveSkill(from, Number(li.dataset.wlKey)); },
  dragend: () => setDrag(null, null),
};

/** Every other candidate on the events `key` takes, in list order, each with the events it shares with the winner. */
function siblingsOf(c: RunPlan, key: number): { entry: WishlistEntry; events: WishlistEvent[] }[] {
  const out = new Map<number, WishlistEvent[]>();
  for (const e of c.wlLayout.events) if (e.winner === key) for (const k of e.keys) if (k !== key) out.set(k, [...(out.get(k) ?? []), e]);
  return [...out].map(([k, events]) => ({ entry: c.wlLayout.entries.get(k)!, events }));
}
const listedAt = (c: RunPlan, key: number) => { const i = c.wl.findIndex((w) => w.key === key); return i < 0 ? null : i + 1; };
const entryName = (w: WishlistEntry) => w.form ? `${w.name} (for ${w.form})` : w.name;

/** The role tag every row carries, and a status mark only when a target has something to say. */
function tags(c: RunPlan, w: WishlistEntry) {
  const role = COPY.priorities.roles[w.role];
  const cls = w.role === 'required' ? 'gold' : w.role === 'preferred' ? 'ok' : '';
  const mark = !w.isTarget ? null : !w.gated ? COPY.priorities.marks.hintsOnly : !c.wlLayout.steers.get(w.key)?.length ? COPY.priorities.marks.lostEvent : null;
  return html`<span class="tag ${cls} wl-kind" data-tip=${role.tip}>${role.label}</span>${mark
    ? html`<span class="tag ${mark === COPY.priorities.marks.lostEvent ? 'danger' : ''} wl-kind" data-wl-mark data-tip=${mark.tip}>${mark.label}</span>` : nothing}`;
}

/** A chip that swaps `sibling` in for `winner` at their shared event. Only extras take events from extras. */
function swapChip(c: RunPlan, sibling: WishlistEntry, winner: WishlistEntry, events: WishlistEvent[], locked: boolean) {
  const at = listedAt(c, sibling.key);
  const tipText = `${COPY.priorities.swapTip(sibling.name, events.map((e) => e.label).join(' and '))}\n\n${COPY.priorities.source}: ${sibling.reason}`;
  return html`<button class="wl-swap" data-action="wl-swap" data-id="${sibling.key}" data-for="${winner.key}" ?disabled=${locked} data-tip=${tipText} @click=${() => swapSkill(sibling.key, winner.key)}>${entryName(sibling)}${at ? html` <span class="muted">${COPY.priorities.listedAt(at)}</span>` : nothing}</button>`;
}

function row(c: RunPlan, w: WishlistEntry, i: number, locked: boolean) {
  const extra = isExtra(w);
  const extras = c.wl.filter(isExtra);
  const canMove = (delta: number) => { if (!extra || locked) return false; const j = extras.indexOf(w) + delta; return j >= 0 && j < extras.length; };
  const name = skillWithTip(w.skillId, w.form ? html`${w.name} <span class="muted">(for ${w.form})</span>` : w.name, `${COPY.priorities.source}: ${w.reason}`);
  const sibs = extra ? siblingsOf(c, w.key) : [];
  return html`<li draggable="${extra && !locked ? 'true' : 'false'}" data-wl-key="${w.key}" data-wl-role="${w.role}" class="${extra ? 'wl-extra' : 'wl-target'} ${view.drag.key === w.key ? 'dragging' : ''} ${view.drag.over === w.key && view.drag.key !== w.key ? 'drop-target' : ''}">
    <span class="wl-num">${i + 1}.</span><span class="grip ${extra ? '' : 'grip-none'}" aria-hidden="true">⋮⋮</span>
    <span class="wl-body">${tags(c, w)}${name}</span>
    ${extra ? html`<span class="wl-actions">
      <button class="small wl-move" data-action="wl-up" data-id="${w.key}" aria-label="Move ${w.name} up" data-tip="Move up" ?disabled=${!canMove(-1)} @click=${() => nudgeSkill(w.key, -1)}>▲</button>
      <button class="small wl-move" data-action="wl-down" data-id="${w.key}" aria-label="Move ${w.name} down" data-tip="Move down" ?disabled=${!canMove(1)} @click=${() => nudgeSkill(w.key, 1)}>▼</button>
      <button class="small wl-x" data-action="wl-exclude" data-id="${w.key}" aria-label="Hide ${w.name}" data-tip="Hide from the list" ?disabled=${locked} @click=${() => hideSkill(w.key)}>✕</button>
    </span>` : html`<span class="wl-actions wl-fixed" data-tip=${COPY.priorities.targetsFixed}></span>`}
    ${sibs.length ? html`<div class="wl-alts small" data-alternatives="${w.key}"><span class="muted">${COPY.priorities.instead}</span>${sibs.map((s) => swapChip(c, s.entry, w, s.events, locked))}</div>` : nothing}</li>`;
}

/**
 * The candidates outside the list and the hidden ones, each with a button that brings it in. The row is clamped to
 * three lines; app.ts observes whether that hides any and the toggle appears only then (or while the row is expanded).
 */
function candidates(c: RunPlan, locked: boolean) {
  if (!c.wlRest.length && !c.wlHidden.length) return nothing;
  const expanded = view.showAllCandidates;
  return html`<div class="small muted wl-extra ${expanded ? '' : 'clamped'}" data-candidates>
      ${c.wlRest.length ? html`<span>${COPY.priorities.notListed}</span> ${c.wlRest.map((w) => html`<span class="chip small">${w.name}${isExtra(w) ? html` <button data-action="wl-add" data-id="${w.key}" aria-label="Add ${w.name} to the list" ?disabled=${locked} @click=${() => addSkill(w.key)}>+</button>` : nothing}</span>`)}` : nothing}
      ${c.wlHidden.length ? html`<span>${COPY.priorities.hiddenRow}</span> ${c.wlHidden.map((w) => html`<span class="chip small">${w.name} <button data-action="wl-restore" data-id="${w.key}" aria-label="Put ${w.name} back" ?disabled=${locked} @click=${() => restoreSkill(w.key)}>+</button></span>`)}` : nothing}
    </div>
    ${view.candidatesOverflow || expanded ? html`<button class="small wl-candidates-toggle" data-action="wl-candidates" aria-expanded=${expanded} @click=${() => { view.showAllCandidates = !expanded; refresh(); }}>${expanded ? COPY.priorities.fewerCandidates : COPY.priorities.allCandidates}</button>` : nothing}`;
}

export function renderPriorities(c: RunPlan) {
  const locked = searchState.pending;
  const customized = store.run.wishlistOrder.length > 0 || store.run.wishlistExcluded.length > 0;
  const actions = customized ? html`<button class="small" data-action="wl-reset" ?disabled=${locked} @click=${resetExtras}>${COPY.priorities.reset}</button>` : nothing;
  const hidden = c.wlLayout.shadowed.length;
  const subtitle = [`up to ${PRIORITIZED_SKILLS_MAX}`, ...(hidden ? [COPY.priorities.hidden(hidden)] : []), ...(locked ? [COPY.priorities.pending] : [])].join(', ');
  return panel({ title: COPY.priorities.title, kind: 'result', subtitle, tip: COPY.priorities.tip, actions }, html`
    ${c.wl.length ? html`<ol class="wishlist ${locked ? 'wl-locked' : ''}" data-wl-locked=${locked ? 'true' : nothing} @dragstart=${drag.dragstart} @dragover=${drag.dragover} @drop=${drag.drop} @dragend=${drag.dragend}>${repeat(c.wl, (w) => w.key, (w, i) => row(c, w, i, locked))}</ol>` : html`<div class="muted small">${COPY.priorities.empty}</div>`}
    ${candidates(c, locked)}`);
}
