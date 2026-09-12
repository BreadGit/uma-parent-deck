// The prioritized-skill list to enter in independent training: exclude, restore, add and reorder entries, plus the
// event choice conflicts the order resolves.
import { html, nothing } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import { downloadText } from '../../download.ts';
import type { RunPlan } from '../../model/run.ts';
import type { WishlistEntry } from '../../model/deck.ts';
import type { Conflict } from '../../model/sparks.ts';
import { resolveTarget } from '../../model/sparks.ts';
import { PRIORITIZED_SKILLS_MAX } from '../../model/rules.ts';
import { data, plan, refresh, store, update, view } from '../context.ts';
import { COPY } from '../copy.ts';
import { skillName, skillWithTip } from '../format.ts';
import { panel, sub } from '../panel.ts';

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
const resetList = () => update((s) => { s.run.wishlistOrder = []; s.run.wishlistExcluded = []; });
const exportList = () => downloadText('prioritized-skills.txt', plan().wl.map((w) => w.name).join('\n') + '\n');

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

function kindTag(w: WishlistEntry) {
  const kind = COPY.priorities.kinds[w.gated ? (w.isTarget ? 'target' : 'other') : 'given'];
  const cls = w.gated ? (w.isTarget ? 'gold' : '') : 'warn';
  return html`<span class="tag ${cls} wl-kind" data-tip=${kind.tip}>${requiredSkill(w.skillId) ? 'required' : kind.label}</span>`;
}

function row(c: RunPlan, w: WishlistEntry, i: number) {
  const canMove = (j: number) => j >= 0 && j < c.wl.length && requiredSkill(w.key) === requiredSkill(c.wl[j]!.key);
  return html`<li draggable="true" data-wl-key="${w.key}" class="${view.drag.key === w.key ? 'dragging' : ''} ${view.drag.over === w.key && view.drag.key !== w.key ? 'drop-target' : ''}">
    <span class="wl-num">${i + 1}.</span><span class="grip" aria-hidden="true">⋮⋮</span>
    <span class="wl-body">${kindTag(w)}${skillWithTip(w.skillId, w.form ? html`${w.name} <span class="muted">(for ${w.form})</span>` : w.name)} <span class="small muted">${w.reason}</span></span>
    <span class="wl-actions">
      <button class="small wl-move" data-action="wl-up" data-id="${w.key}" aria-label="Move ${w.name} up" data-tip="Move up" ?disabled=${!canMove(i - 1)} @click=${() => nudgeSkill(w.key, -1)}>▲</button>
      <button class="small wl-move" data-action="wl-down" data-id="${w.key}" aria-label="Move ${w.name} down" data-tip="Move down" ?disabled=${!canMove(i + 1)} @click=${() => nudgeSkill(w.key, 1)}>▼</button>
      <button class="small wl-x" data-action="wl-exclude" data-id="${w.key}" aria-label="Remove ${w.name} from the list" data-tip="Remove from the list" @click=${() => excludeSkill(w.key)}>✕</button>
    </span></li>`;
}

function conflicts(c: RunPlan) {
  const d = c.deckResult;
  if (!d.conflicts.length) return nothing;
  const opts = (cf: Conflict) => [cf.taken, ...cf.dropped];
  return html`<div class="conflicts-box">${sub(COPY.priorities.conflicts, { tip: COPY.priorities.conflictsTip })}
    <div class="scroll-x"><table class="small conflicts"><thead><tr><th>Event</th><th>Options</th><th>Taken</th><th>Not taken</th></tr></thead><tbody>
      ${d.conflicts.map((cf) => html`<tr><td class="wrap">${cf.label}</td>
        <td class="wrap">${opts(cf).map((o) => html`<div>${skillWithTip(o.skillId)}${o.option ? html` <span class="muted">${o.option}</span>` : nothing}</div>`)}</td>
        <td><b>${skillName(cf.taken.skillId)}</b>${cf.taken.target != null ? nothing : html` <span class="muted">(not a target)</span>`}</td><td>${cf.dropped.map((o) => skillName(o.skillId)).join(', ')}</td></tr>`)}
    </tbody></table></div></div>`;
}

export function renderPriorities(c: RunPlan) {
  const customized = store.run.wishlistOrder.length > 0 || store.run.wishlistExcluded.length > 0;
  const actions = html`<button class="small" data-action="wl-export" ?disabled=${!c.wl.length} @click=${exportList}>${COPY.priorities.export}</button>${customized ? html`<button class="small" data-action="wl-reset" @click=${resetList}>${COPY.priorities.reset}</button>` : nothing}`;
  return panel({ title: COPY.priorities.title, kind: 'result', subtitle: `up to ${PRIORITIZED_SKILLS_MAX}`, tip: COPY.priorities.tip, actions }, html`
    ${c.priorityIssues.map((note) => html`<p class="small warn" data-priority-conflict>${note}</p>`)}
    ${c.wl.length ? html`<ol class="wishlist" @dragstart=${drag.dragstart} @dragover=${drag.dragover} @drop=${drag.drop} @dragend=${drag.dragend}>${repeat(c.wl, (w) => w.key, (w, i) => row(c, w, i))}</ol>` : html`<div class="muted small">${COPY.priorities.empty}</div>`}
    ${c.wlRest.length || c.wlExcluded.length ? html`<div class="small muted wl-extra">
      ${c.wlRest.length ? html`<span>${COPY.priorities.notListed}</span> ${c.wlRest.map((w) => html`<span class="chip small">${w.name} <button data-action="wl-add" data-id="${w.key}" aria-label="Add ${w.name} to the list" @click=${() => addSkill(w.key)}>+</button></span>`)}` : nothing}
      ${c.wlExcluded.length ? html`<span>${COPY.priorities.removed}</span> ${c.wlExcluded.map((w) => html`<span class="chip small">${w.name} <button data-action="wl-restore" data-id="${w.key}" aria-label="Put ${w.name} back" @click=${() => restoreSkill(w.key)}>+</button></span>`)}` : nothing}
    </div>` : nothing}
    ${conflicts(c)}`);
}
