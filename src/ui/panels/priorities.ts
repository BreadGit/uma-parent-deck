// The prioritized-skill list to enter in independent training: exclude, restore, add, reorder and swap entries. The
// run takes one option per event, so a row that takes a shared event carries the options it displaced as swap chips;
// one click puts that option in its place. Each skill's tooltip ends with the event or card that gives it; the
// choice conflicts the order resolves are listed in the warnings panel.
import { html, nothing } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import type { RunPlan, WishlistEvent } from '../../model/run.ts';
import type { WishlistEntry } from '../../model/deck.ts';
import { resolveTarget } from '../../model/sparks.ts';
import { PRIORITIZED_SKILLS_MAX } from '../../model/rules.ts';
import { data, plan, refresh, store, update, view } from '../context.ts';
import { COPY } from '../copy.ts';
import { skillWithTip } from '../format.ts';
import { panel } from '../panel.ts';

const requiredSkill = (key: number) => store.run.targets.some((t) => t.role === 'required' && t.id === resolveTarget(key, data)?.id);
function excludeSkill(key: number) {
  update((s) => { s.run.wishlistExcluded = [...new Set([...s.run.wishlistExcluded, key])]; s.run.wishlistOrder = s.run.wishlistOrder.filter((x) => x !== key); });
}
function restoreSkill(key: number) {
  update((s) => { s.run.wishlistExcluded = s.run.wishlistExcluded.filter((x) => x !== key); });
}
/** Put an unlisted candidate into the last slot of the list. */
function addSkill(key: number) {
  const cur = plan().wl.map((w) => w.key).filter((x) => x !== key);
  cur.splice(PRIORITIZED_SKILLS_MAX - 1, cur.length, key);
  update((s) => { s.run.wishlistOrder = cur; });
}
/** Move an entry to another entry's place; the arrows and the drag handlers both end up here. */
function moveSkill(from: number, to: number) {
  const cur = plan().wl.map((w) => w.key);
  const i = cur.indexOf(from), j = cur.indexOf(to);
  if (i < 0 || j < 0 || i === j) return; // stale key after a re-render
  if (requiredSkill(from) !== requiredSkill(to)) return;
  cur.splice(i, 1); cur.splice(j, 0, from);
  update((s) => { s.run.wishlistOrder = cur; });
}
function nudgeSkill(key: number, delta: number) {
  const cur = plan().wl.map((w) => w.key);
  const i = cur.indexOf(key), j = i + delta;
  if (i < 0 || j < 0 || j >= cur.length) return;
  moveSkill(key, cur[j]!);
}
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
const resetList = () => update((s) => { s.run.wishlistOrder = []; s.run.wishlistExcluded = []; });

// Drag state lives in the view and the classes are rendered from it, so no handler touches lit's elements.
const dragItem = (ev: Event) => (ev.target as HTMLElement).closest<HTMLElement>('li[data-wl-key]');
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

function kindTag(c: RunPlan, w: WishlistEntry) {
  const conflict = w.gated && w.isTarget && !c.wlLayout.steers.get(w.key)?.length;
  const kind = COPY.priorities.kinds[conflict ? 'conflict' : w.gated ? (w.isTarget ? 'target' : 'other') : 'given'];
  const cls = conflict ? 'danger' : w.gated ? (w.isTarget ? 'gold' : '') : 'warn';
  return html`<span class="tag ${cls} wl-kind" data-tip=${kind.tip}>${requiredSkill(w.skillId) ? 'required' : kind.label}</span>`;
}

/** A chip that swaps `sibling` in for `winner` at their shared event. */
function swapChip(c: RunPlan, sibling: WishlistEntry, winner: WishlistEntry, events: WishlistEvent[]) {
  const at = listedAt(c, sibling.key);
  const ok = canSwap(sibling.key, winner.key);
  const tipText = ok ? `${COPY.priorities.swapTip(sibling.name, events.map((e) => e.label).join(' and '))}\n\n${COPY.priorities.source}: ${sibling.reason}` : COPY.priorities.keptByRequired(winner.name);
  return html`<button class="wl-swap" data-action="wl-swap" data-id="${sibling.key}" data-for="${winner.key}" ?disabled=${!ok} data-tip=${tipText} @click=${() => swapSkill(sibling.key, winner.key)}>${entryName(sibling)}${at ? html` <span class="muted">${COPY.priorities.listedAt(at)}</span>` : nothing}</button>`;
}

function row(c: RunPlan, w: WishlistEntry, i: number) {
  const canMove = (j: number) => j >= 0 && j < c.wl.length && requiredSkill(w.key) === requiredSkill(c.wl[j]!.key);
  const sibs = siblingsOf(c, w.key);
  return html`<li draggable="true" data-wl-key="${w.key}" class="${view.drag.key === w.key ? 'dragging' : ''} ${view.drag.over === w.key && view.drag.key !== w.key ? 'drop-target' : ''}">
    <span class="wl-num">${i + 1}.</span><span class="grip" aria-hidden="true">⋮⋮</span>
    <span class="wl-body">${kindTag(c, w)}${skillWithTip(w.skillId, w.form ? html`${w.name} <span class="muted">(for ${w.form})</span>` : w.name, `${COPY.priorities.source}: ${w.reason}`)}</span>
    <span class="wl-actions">
      <button class="small wl-move" data-action="wl-up" data-id="${w.key}" aria-label="Move ${w.name} up" data-tip="Move up" ?disabled=${!canMove(i - 1)} @click=${() => nudgeSkill(w.key, -1)}>▲</button>
      <button class="small wl-move" data-action="wl-down" data-id="${w.key}" aria-label="Move ${w.name} down" data-tip="Move down" ?disabled=${!canMove(i + 1)} @click=${() => nudgeSkill(w.key, 1)}>▼</button>
      <button class="small wl-x" data-action="wl-exclude" data-id="${w.key}" aria-label="Remove ${w.name} from the list" data-tip="Remove from the list" @click=${() => excludeSkill(w.key)}>✕</button>
    </span>
    ${sibs.length ? html`<div class="wl-alts small" data-alternatives="${w.key}"><span class="muted">${COPY.priorities.instead}</span>${sibs.map((s) => swapChip(c, s.entry, w, s.events))}</div>` : nothing}</li>`;
}

/**
 * The candidates outside the list and the removed ones, each with a button that brings it in. The row is clamped to
 * three lines; app.ts observes whether that hides any and the toggle appears only then (or while the row is expanded).
 */
function candidates(c: RunPlan) {
  if (!c.wlRest.length && !c.wlExcluded.length) return nothing;
  const expanded = view.showAllCandidates;
  return html`<div class="small muted wl-extra ${expanded ? '' : 'clamped'}" data-candidates>
      ${c.wlRest.length ? html`<span>${COPY.priorities.notListed}</span> ${c.wlRest.map((w) => html`<span class="chip small">${w.name} <button data-action="wl-add" data-id="${w.key}" aria-label="Add ${w.name} to the list" @click=${() => addSkill(w.key)}>+</button></span>`)}` : nothing}
      ${c.wlExcluded.length ? html`<span>${COPY.priorities.removed}</span> ${c.wlExcluded.map((w) => html`<span class="chip small">${w.name} <button data-action="wl-restore" data-id="${w.key}" aria-label="Put ${w.name} back" @click=${() => restoreSkill(w.key)}>+</button></span>`)}` : nothing}
    </div>
    ${view.candidatesOverflow || expanded ? html`<button class="small wl-candidates-toggle" data-action="wl-candidates" aria-expanded=${expanded} @click=${() => { view.showAllCandidates = !expanded; refresh(); }}>${expanded ? COPY.priorities.fewerCandidates : COPY.priorities.allCandidates}</button>` : nothing}`;
}

export function renderPriorities(c: RunPlan) {
  const customized = store.run.wishlistOrder.length > 0 || store.run.wishlistExcluded.length > 0;
  const actions = customized ? html`<button class="small" data-action="wl-reset" @click=${resetList}>${COPY.priorities.reset}</button>` : nothing;
  const hidden = c.wlLayout.shadowed.length;
  return panel({ title: COPY.priorities.title, kind: 'result', subtitle: `up to ${PRIORITIZED_SKILLS_MAX}${hidden ? `, ${COPY.priorities.hidden(hidden)}` : ''}`, tip: COPY.priorities.tip, actions }, html`
    ${c.wl.length ? html`<ol class="wishlist" @dragstart=${drag.dragstart} @dragover=${drag.dragover} @drop=${drag.drop} @dragend=${drag.dragend}>${repeat(c.wl, (w) => w.key, (w, i) => row(c, w, i))}</ol>` : html`<div class="muted small">${COPY.priorities.empty}</div>`}
    ${candidates(c)}`);
}
