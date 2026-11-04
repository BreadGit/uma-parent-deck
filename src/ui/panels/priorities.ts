// Target rows follow Parent goal and are fixed; the extras are the user's to arrange. While a deck search runs the
// extras are locked, since the deck found may offer different ones.
import { html, nothing } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import { getsUnlisted, type RunPlan } from '../../model/run.ts';
import type { WishlistEntry } from '../../model/deck.ts';
import { PRIORITIZED_SKILLS_MAX } from '../../model/rules.ts';
import { plan, store, update, view } from '../context.ts';
import { TITLE } from '../copy.ts';
import { skillTipText, skillWithTip } from '../format.ts';
import { panel } from '../panel.ts';

const TARGETS_FIXED = `Targets above the skills the run gets anyway follow ${TITLE.goal} and cannot be hidden here. Change targets and their order in ${TITLE.goal}.`;
const ROLE_TAGS = {
  required: { label: 'required', tip: 'A required target of the parent goal.' },
  preferred: { label: 'preferred', tip: 'A preferred target of the parent goal.' },
  extra: { label: 'extra', tip: 'Not a target. Listing it steers the run to the event option that gives this skill.' },
};
const ANYWAY = 'It sits below the skills that steer event choices, drops off a full list, and can be hidden.';
const HINTS_ONLY_MARK = { label: 'hints only', tip: `The run gets this target without choosing anything at an event. Listing it may make the run chase its hints. ${ANYWAY}` };
const FIRST_OPTION = 'Independent training takes the first option of an event unless a listed skill is on another option. Guides confirm this when nothing is listed; with other skills listed it is assumed.';
const DEFAULT_PICK_MARK = { label: 'default pick', tip: `${FIRST_OPTION} This skill is on a first option, so the run gets it without a listing. ${ANYWAY}` };
const defendingMark = (rival: string) => ({ label: 'default pick', tip: `${FIRST_OPTION} This skill is on a first option, but ${rival}, lower in the list, is on another option of the same event. Listing this one above it keeps the run on the first option.` });
const sameOptionMark = (holder: string) => ({ label: 'same option', tip: `The option ${holder} takes at this event also gives this skill, so the run gets it without a listing. ${ANYWAY}` });
const GROUP_NOTE = 'The run gets the skills below without a listing. Enter them only if slots are free.';
const LOST_EVENT_MARK = { label: 'lost event', tip: `Another target listed higher takes every event option that gives this one, so it gets nothing from those events and keeps only its hints. To change that, raise its priority in ${TITLE.goal} or change the competing target there.` };

const isExtra = (w: WishlistEntry) => w.role === 'extra';
/** Entries the run gets without a listing stay below the others, so an extra moves only among extras on its side. */
const sameSide = (c: RunPlan, a: number, b: number) => c.wlLayout.deferred.has(a) === c.wlLayout.deferred.has(b);
/**
 * An edit pins every visible extra. It runs inside `update()`, so it rearranges the order of another tab's save taken
 * over since this page rendered rather than replacing it. An edit returns nothing when its keys are no longer shown.
 */
const editOrder = (edit: (shown: number[]) => number[] | void) => update((s) => {
  const next = edit(plan().wl.filter(isExtra).map((w) => w.key));
  if (next) s.run.wishlistOrder = next;
});

function hideSkill(key: number) {
  update((s) => { s.run.wishlistExcluded = [...new Set([...s.run.wishlistExcluded, key])]; s.run.wishlistOrder = s.run.wishlistOrder.filter((x) => x !== key); });
}
function restoreSkill(key: number) {
  update((s) => { s.run.wishlistExcluded = s.run.wishlistExcluded.filter((x) => x !== key); });
}
/** Put an unlisted extra first among the extras, so it shows whenever the targets leave any slot free. */
function addSkill(key: number) {
  editOrder((cur) => [key, ...cur.filter((x) => x !== key)]);
}
function moveIn(cur: number[], i: number, j: number) {
  if (i < 0 || j < 0 || j >= cur.length || i === j) return; // stale key after a re-render, or a target row
  const next = [...cur];
  next.splice(j, 0, ...next.splice(i, 1));
  return next;
}
function moveSkill(from: number, to: number) {
  editOrder((cur) => moveIn(cur, cur.indexOf(from), cur.indexOf(to)));
}
function nudgeSkill(key: number, delta: number) {
  editOrder((cur) => { const i = cur.indexOf(key); return moveIn(cur, i, i + delta); });
}
/** Put `sibling` in `winner`'s place so it takes their shared event; the winner moves behind it. */
function swapSkill(sibling: number, winner: number) {
  editOrder((shown) => {
    const cur = shown.filter((k) => k !== sibling);
    const i = cur.indexOf(winner);
    if (i < 0) return;
    cur.splice(i, 0, sibling);
    return cur;
  });
}
const resetExtras = () => update((s) => { s.run.wishlistOrder = []; s.run.wishlistExcluded = []; });

// Drag state lives in the view and the classes are rendered from it, so no handler touches lit's elements.
const dragItem = (ev: Event) => (ev.target as HTMLElement).closest<HTMLElement>('li[data-wl-key][draggable="true"]');
const setDrag = (key: number | null, over: number | null) => {
  if (view.drag.key === key && view.drag.over === over) return;
  view.drag = { key, over };
};
const drag = {
  dragstart: (ev: DragEvent) => { const li = dragItem(ev); if (!li) return; const key = Number(li.dataset.wlKey); ev.dataTransfer?.setData('text/plain', String(key)); setDrag(key, null); },
  dragover: (ev: DragEvent) => { const li = dragItem(ev); if (!li || view.drag.key == null || !sameSide(plan(), view.drag.key, Number(li.dataset.wlKey))) return; ev.preventDefault(); setDrag(view.drag.key, Number(li.dataset.wlKey)); },
  drop: (ev: DragEvent) => { const li = dragItem(ev); const from = view.drag.key; if (!li || from == null) return; ev.preventDefault(); setDrag(null, null); moveSkill(from, Number(li.dataset.wlKey)); },
  dragend: () => setDrag(null, null),
};

/** Every other candidate on the events `key` takes, in list order. */
function siblingsOf(c: RunPlan, key: number): WishlistEntry[] {
  const out = new Set<number>();
  for (const e of c.wlLayout.events) if (e.winner === key) for (const k of e.keys) if (k !== key) out.add(k);
  return [...out].map((k) => c.wlLayout.entries.get(k)!);
}
const listedAt = (c: RunPlan, key: number) => { const i = c.wl.findIndex((w) => w.key === key); return i < 0 ? null : i + 1; };
const entryName = (w: WishlistEntry) => w.form ? `${w.name} (for ${w.form})` : w.name;

/** Why an entry sits where it does when that is not its role alone. */
function markOf(c: RunPlan, w: WishlistEntry) {
  const { deferred, lost, along, events, entries } = c.wlLayout;
  if (w.isTarget && !w.gated) return HINTS_ONLY_MARK;
  if (lost.has(w.key)) return LOST_EVENT_MARK;
  if (getsUnlisted(w)) {
    if (deferred.has(w.key)) return DEFAULT_PICK_MARK;
    const rival = events.find((e) => e.winner === w.key)?.keys.find((k) => k !== w.key);
    return rival === undefined ? null : defendingMark(entryName(entries.get(rival)!));
  }
  const holder = along.get(w.key);
  return deferred.has(w.key) && holder !== undefined ? sameOptionMark(entryName(entries.get(holder)!)) : null;
}

function tags(c: RunPlan, w: WishlistEntry) {
  const role = ROLE_TAGS[w.role];
  const cls = w.role === 'required' ? 'gold' : w.role === 'preferred' ? 'ok' : '';
  const mark = markOf(c, w);
  return html`<span class="tag ${cls} wl-kind" data-tip=${role.tip}>${role.label}</span>${mark
    ? html`<span class="tag ${mark === LOST_EVENT_MARK ? 'danger' : ''} wl-kind" data-wl-mark data-tip=${mark.tip}>${mark.label}</span>` : nothing}`;
}

/** A chip that swaps `sibling` in for `winner` at their shared event. Only extras take events from extras. */
function swapChip(c: RunPlan, sibling: WishlistEntry, winner: WishlistEntry, locked: boolean) {
  const at = listedAt(c, sibling.key);
  const tipText = skillTipText(sibling.skillId, `Source: ${sibling.reason}`);
  return html`<button class="wl-swap" data-action="wl-swap" data-id="${sibling.key}" data-for="${winner.key}" ?disabled=${locked} data-tip=${tipText} @click=${() => swapSkill(sibling.key, winner.key)}>${entryName(sibling)}${at ? html` <span class="muted">(currently #${at})</span>` : nothing}</button>`;
}

function row(c: RunPlan, w: WishlistEntry, i: number, locked: boolean) {
  const extra = isExtra(w);
  const hideable = extra || c.wlLayout.deferred.has(w.key);
  const extras = c.wl.filter(isExtra);
  const neighbour = (delta: number) => { const next = extras[extras.indexOf(w) + delta]; return !!next && sameSide(c, w.key, next.key); };
  const movable = extra && (neighbour(-1) || neighbour(1));
  const canMove = (delta: number) => extra && !locked && neighbour(delta);
  const groupStart = c.wlLayout.deferred.has(w.key) && (i === 0 || !c.wlLayout.deferred.has(c.wl[i - 1]!.key));
  const sources = !w.gated && w.targetId !== null ? (c.deckResult.coverage.get(w.targetId) ?? [])
    .filter((s) => s.skillId === w.skillId && s.kind !== 'lineage' && s.kind !== 'innate' && s.kind !== 'awakening') : [];
  const hintCards = [...new Set(sources.flatMap((s) => s.kind === 'hint' && s.cardName ? [s.cardName] : []))];
  const source = hintCards.length && sources.every((s) => s.kind === 'hint') ? `Available as a hint on ${hintCards.length === 1 ? 'this card' : 'these cards'} in the deck: ${hintCards.join('; ')}.` : w.reason;
  const name = skillWithTip(w.skillId, w.form ? html`${w.name} <span class="muted">(for ${w.form})</span>` : w.name, `Source: ${source}`);
  const sibs = extra ? siblingsOf(c, w.key) : [];
  return html`<li draggable="${movable && !locked ? 'true' : 'false'}" data-wl-key="${w.key}" data-wl-role="${w.role}" class="${extra ? 'wl-extra' : 'wl-target'} ${view.drag.key === w.key ? 'dragging' : ''} ${view.drag.over === w.key && view.drag.key !== w.key ? 'drop-target' : ''}">
    ${groupStart ? html`<div class="wl-group small muted" data-wl-group>${GROUP_NOTE}</div>` : nothing}
    <span class="wl-num">${i + 1}.</span><span class="grip ${movable ? '' : 'grip-disabled'}" aria-hidden="true">⋮⋮</span>
    <span class="wl-body">${tags(c, w)}${name}</span>
    <span class="wl-actions ${hideable ? '' : 'wl-fixed'}" tabindex=${hideable ? nothing : 0} role=${hideable ? nothing : 'group'} aria-label=${hideable ? nothing : TARGETS_FIXED} data-tip=${hideable ? nothing : TARGETS_FIXED}>
      <button class="small wl-move" data-action="wl-up" data-id="${w.key}" aria-label="Move ${w.name} up" data-tip="Move up" ?disabled=${!canMove(-1)} @click=${() => nudgeSkill(w.key, -1)}>▲</button>
      <button class="small wl-move" data-action="wl-down" data-id="${w.key}" aria-label="Move ${w.name} down" data-tip="Move down" ?disabled=${!canMove(1)} @click=${() => nudgeSkill(w.key, 1)}>▼</button>
      <button class="small wl-x" data-action="wl-exclude" data-id="${w.key}" aria-label="Hide ${w.name}" data-tip="Hide from the list" ?disabled=${!hideable || locked} @click=${() => hideSkill(w.key)}>✕</button>
    </span>
    ${sibs.length ? html`<div class="wl-alts small" data-alternatives="${w.key}"><span class="muted">or instead:</span>${sibs.map((s) => swapChip(c, s, w, locked))}</div>` : nothing}</li>`;
}

/** The run gets an entry below the others without a listing, so it needs no add button. */
function restChip(c: RunPlan, w: WishlistEntry, locked: boolean) {
  if (c.wlLayout.deferred.has(w.key)) return html`<span class="chip small" data-tip=${c.wlLayout.lost.has(w.key) ? LOST_EVENT_MARK.tip : 'The run gets this skill without a listing.'}>${w.name}</span>`;
  return html`<span class="chip small">${w.name}${isExtra(w) ? html` <button data-action="wl-add" data-id="${w.key}" aria-label="Add ${w.name} to the list" ?disabled=${locked} @click=${() => addSkill(w.key)}>+</button>` : nothing}</span>`;
}

/**
 * The candidates outside the list and the hidden ones, each with a button that brings it in. An extra whose event a
 * skill outside the list keeps has no chip under a row, so it is listed here. The row is clamped to
 * three lines; app.ts observes whether that hides any and the toggle appears only when collapsing would hide a chip.
 */
function candidates(c: RunPlan, locked: boolean) {
  const { shadowed, entries } = c.wlLayout;
  const unseen = shadowed.filter((s) => s.by.every((k) => !entries.get(k)!.isTarget && !c.wl.some((w) => w.key === k))).map((s) => s.entry);
  const rest = [...c.wlRest, ...unseen];
  if (!rest.length && !c.wlHidden.length) return nothing;
  const expanded = view.showAllCandidates;
  return html`<div class="small muted wl-candidates ${expanded ? '' : 'clamped'}" data-candidates>
      ${rest.length ? html`<span>Not listed:</span> ${rest.map((w) => restChip(c, w, locked))}` : nothing}
      ${c.wlHidden.length ? html`<span>Hidden:</span> ${c.wlHidden.map((w) => html`<span class="chip small">${entryName(w)}${w.isTarget ? ` (${w.role} target)` : ''} <button data-action="wl-restore" data-id="${w.key}" aria-label="Put ${w.name} back" ?disabled=${locked} @click=${() => restoreSkill(w.key)}>+</button></span>`)}` : nothing}
    </div>
    ${view.candidatesOverflow ? html`<button class="small wl-candidates-toggle" data-action="wl-candidates" aria-expanded=${expanded} @click=${() => { view.showAllCandidates = !expanded; }}>${expanded ? 'Show fewer' : 'Show all candidates'}</button>` : nothing}`;
}

export function renderPriorities(c: RunPlan) {
  const locked = view.searchPending;
  const customized = store.run.wishlistOrder.length > 0 || store.run.wishlistExcluded.length > 0;
  const actions = customized ? html`<button class="small" data-action="wl-reset" data-tip="Restore the extras' order and bring back hidden skills" ?disabled=${locked} @click=${resetExtras}>Reset</button>` : nothing;
  const swaps = new Set(c.wl.filter(isExtra).flatMap((w) => siblingsOf(c, w.key).map((s) => s.key))).size;
  const subtitle = [`up to ${PRIORITIZED_SKILLS_MAX}`, ...(swaps ? [`${swaps} alternative${swaps === 1 ? '' : 's'} under "or instead"`] : []), ...(locked ? ['updating with the deck search'] : [])].join(', ');
  return panel({ title: 'Prioritized skills', kind: 'result', subtitle, tip: `Enter these in independent training's prioritized skills list, in this order; the game takes ${PRIORITIZED_SKILLS_MAX}. The run takes the first option of each event unless a listed skill is on another option, so the list starts with the skills that steer event choices: targets in ${TITLE.goal} order, required first, then extras, which are yours to arrange (the deck search does not read that order). Below them come the skills the run gets without a listing: hints-only targets, default picks on a first option, and skills on an option a higher entry takes. They drop off a full list and can be hidden. The run takes one option per event, so an extra on another option of a listed extra's event is left out; the chips under that entry swap it in.`, actions }, html`
    ${c.wl.length ? html`<ol class="wishlist ${locked ? 'wl-locked' : ''}" data-wl-locked=${locked ? 'true' : nothing} @dragstart=${drag.dragstart} @dragover=${drag.dragover} @drop=${drag.drop} @dragend=${drag.dragend}>${repeat(c.wl, (w) => w.key, (w, i) => row(c, w, i, locked))}</ol>` : html`<div class="muted small">Nothing to prioritize yet.</div>`}
    ${candidates(c, locked)}`);
}
