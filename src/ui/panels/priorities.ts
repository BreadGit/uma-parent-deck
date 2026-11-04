// The list is what to enter in the game. Targeted skills follow Parent goal; the user adds and removes the extras. While a deck
// search runs the extras are locked, since the deck found may offer different ones.
import { html, nothing } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import { alternativesTo, type ExtraStatus, type PriorityList, type RunPlan, type UnlistedReason } from '../../model/run.ts';
import type { WishlistEntry } from '../../model/deck.ts';
import { PRIORITIZED_SKILLS_MAX } from '../../model/rules.ts';
import { renderNow, store, update, view } from '../context.ts';
import { TITLE } from '../copy.ts';
import { isOpen } from '../form.ts';
import { skillTipText, skillWithTip } from '../format.ts';
import { panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

const GOAL_TARGETS_ID = 'goal-white-targets';
const OPTION_1 = 'Independent training takes option 1, the top option, of every event unless a listed skill is on another option. Guides confirm this when nothing is listed; with other skills listed it is assumed.';
const ROLE_TAGS = {
  required: { label: 'required', tip: `A required target white spark from ${TITLE.goal}. Change targeted skills and their order there.` },
  preferred: { label: 'preferred', tip: `A preferred target white spark from ${TITLE.goal}. Change targeted skills and their order there.` },
  extra: { label: 'extra', tip: 'Not a targeted skill. You added it, and listing it steers the run to the event option that gives it.' },
};
const TARGET_REMOVE = `Targeted skills come from ${TITLE.goal}. Opens it there, where you can remove this skill or change its priority.`;

const entryName = (w: WishlistEntry) => w.form ? `${w.name} (for ${w.form})` : w.name;
const nameOf = (list: PriorityList, key: number) => entryName(list.entries.get(key)!);

/** Shows Parent goal's targeted skills, with `targetId`'s editor open when given. */
function showGoal(targetId?: number) {
  if (store.ui.inputsHidden) update((s) => { s.ui.inputsHidden = false; });
  if (targetId !== undefined) view.targetEditorId = targetId;
  renderNow();
  const editor = targetId === undefined ? null : document.querySelector<HTMLElement>(`[data-target-editor="${targetId}"]`);
  (editor ?? document.getElementById(GOAL_TARGETS_ID))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  editor?.querySelector<HTMLElement>('[data-action="remove-target"]')?.focus({ preventScroll: true });
}
const goalLink = html`<button class="link small" data-action="wl-goal" @click=${() => showGoal()}>${TITLE.goal}</button>`;

const addExtra = (key: number) => update((s) => { s.run.addedExtras = [...s.run.addedExtras.filter((k) => k !== key), key]; });
const removeExtra = (key: number) => update((s) => { s.run.addedExtras = s.run.addedExtras.filter((k) => k !== key); });
/** `alternative` takes `listed`'s place, so it steers the event they share instead. */
const swapExtra = (alternative: number, listed: number) => update((s) => {
  const rest = s.run.addedExtras.filter((k) => k !== alternative);
  const i = rest.indexOf(listed);
  s.run.addedExtras = i < 0 ? [...rest, alternative] : [...rest.slice(0, i), alternative, ...rest.slice(i + 1)];
});

function swapButton(list: PriorityList, alternative: WishlistEntry, listed: number, locked: boolean, label: string) {
  const shared = list.entries.get(listed)!.events.map((e) => e.key);
  const first = alternative.events.some((e) => shared.includes(e.key) && e.optionIndex === 0);
  const swap = first ? `Removes ${nameOf(list, listed)}, so the run takes option 1 of the event they share, which gives ${entryName(alternative)}.`
    : `Lists ${entryName(alternative)} instead of ${nameOf(list, listed)}: they share an event, and the run takes only one of its options.`;
  const tip = skillTipText(alternative.skillId, `${swap} Source: ${alternative.reason}`);
  return html`<button class="wl-swap" data-action="wl-swap" data-id="${alternative.key}" data-for="${listed}" ?disabled=${locked} data-tip=${tip} @click=${() => swapExtra(alternative.key, listed)}>${label}</button>`;
}

function row(list: PriorityList, w: WishlistEntry, i: number, locked: boolean) {
  const extra = w.role === 'extra';
  const role = ROLE_TAGS[w.role];
  const alternatives = extra ? alternativesTo(list, w.key) : [];
  return html`<li data-wl-key="${w.key}" data-wl-role="${w.role}" class="${extra ? 'wl-extra' : 'wl-target'}">
    <span class="wl-num">${i + 1}.</span>
    <span class="wl-body"><span class="tag ${w.role === 'required' ? 'gold' : w.role === 'preferred' ? 'ok' : ''} wl-kind" data-tip=${role.tip}>${role.label}</span>${skillWithTip(w.skillId, w.form ? html`${w.name} <span class="muted">(for ${w.form})</span>` : w.name, `Source: ${w.reason}`)}</span>
    ${extra ? html`<button class="small wl-x" data-action="wl-remove" data-id="${w.key}" aria-label="Remove ${w.name}" data-tip="Remove from the list" ?disabled=${locked} @click=${() => removeExtra(w.key)}>✕</button>`
      : html`<button class="small wl-x" data-action="wl-goal-target" data-id="${w.targetId}" aria-label="Edit ${w.name} in ${TITLE.goal}" data-tip=${TARGET_REMOVE} @click=${() => showGoal(w.targetId!)}>✕</button>`}
    ${alternatives.length ? html`<div class="wl-alts small" data-alternatives="${w.key}"><span class="muted">or instead:</span>${alternatives.map((a) => swapButton(list, a, w.key, locked, entryName(a)))}</div>` : nothing}</li>`;
}

const REASONS: Record<UnlistedReason, { label: (by: string) => string; tip: (by: string) => string }> = {
  hints: { label: () => 'no event choice', tip: () => 'The run gets this skill from hints and events without choosing an option, so listing it changes nothing.' },
  first: { label: () => 'already option 1', tip: () => `${OPTION_1} This skill is on option 1, so the run gets it without a listing.` },
  along: { label: (by) => `comes with ${by}`, tip: (by) => `The option ${by} takes at this event also gives this skill, so it needs no listing of its own.` },
  lost: { label: (by) => `${by} takes its event`, tip: (by) => `${by}, higher in ${TITLE.goal}, takes another option of every event that gives this skill, so it gets only hints. Change their order in ${TITLE.goal}.` },
};
const UNLISTED_TIP = 'Targeted skills the list leaves out, because listing them would change nothing the run does, or because a higher targeted skill takes their event.';

function unlistedTargets(list: PriorityList) {
  if (!list.unlisted.length) return nothing;
  return html`<details class="wl-section small" data-wl-unlisted ?open=${view.showUnlisted} @toggle=${(e: Event) => { view.showUnlisted = isOpen(e); }}>
    <summary>Targeted skills not listed (${list.unlisted.length})${tip(UNLISTED_TIP)}</summary>
    ${view.showUnlisted ? html`<div class="scroll-x"><table class="wl-unlisted"><thead><tr><th>Skill</th><th>Role</th><th>Why it is not listed</th></tr></thead><tbody>
      ${list.unlisted.map(({ entry, reason, by }) => {
        const r = REASONS[reason], holder = by === null ? '' : nameOf(list, by);
        return html`<tr data-wl-unlisted-reason=${reason}><td>${skillWithTip(entry.skillId, entryName(entry), `Source: ${entry.reason}`)}</td><td>${entry.role}</td>
          <td class=${reason === 'lost' ? 'warn' : ''}>${r.label(holder)}${tip(r.tip(holder))}${reason === 'lost' ? html` ${goalLink}` : nothing}</td></tr>`;
      })}</tbody></table></div>` : nothing}
  </details>`;
}

function overflow(list: PriorityList) {
  if (!list.overflow.length) return nothing;
  return html`<p class="small warn" data-wl-overflow>The game takes ${PRIORITIZED_SKILLS_MAX} skills, so these targeted skills do not fit and the run does not steer their events: ${list.overflow.map(entryName).join(', ')}. Remove targeted skills or lower their priority in ${goalLink}.</p>`;
}

/** What listing `w` moves the run away from: option 1 of each event it would steer, and the skills there. */
function addTip(list: PriorityList, w: WishlistEntry) {
  const parts = w.events.filter((e) => e.optionIndex !== 0).map((e) => {
    const given = list.extras.filter((x) => x.entry.events.some((o) => o.key === e.key && o.optionIndex === 0)).map((x) => entryName(x.entry));
    return `${e.label}: option ${e.optionIndex + 1} instead of option 1, ${given.length ? `giving up ${given.join(', ')}` : 'which gives no skill this deck tracks'}`;
  });
  return `Add to the list. ${parts.join('. ')}.`;
}

/** Each unlisted extra with what adding it would do. */
function poolChip(list: PriorityList, w: WishlistEntry, status: ExtraStatus, locked: boolean) {
  const name = skillWithTip(w.skillId, entryName(w), `Source: ${w.reason}`);
  switch (status.kind) {
    case 'add':
    case 'full': {
      const full = status.kind === 'full';
      return html`<span class="chip small" data-wl-extra=${status.kind}>${name} <button data-action="wl-add" data-id="${w.key}" aria-label="Add ${w.name} to the list" data-tip=${full ? `The game takes ${PRIORITIZED_SKILLS_MAX} skills and the list is full.` : addTip(list, w)} ?disabled=${locked || full} @click=${() => addExtra(w.key)}>+</button></span>`;
    }
    case 'swap': return html`<span class="chip small" data-wl-extra="swap">${name} ${swapButton(list, w, status.with, locked, `Swap with ${nameOf(list, status.with)}`)}</span>`;
    case 'blocked': return html`<span class="chip small muted" data-wl-extra="blocked" data-tip=${`${nameOf(list, status.by)} is a targeted skill on another option of this event. To list this skill instead, add it as a target white spark above ${nameOf(list, status.by)} in ${TITLE.goal}.`}>${name} · ${nameOf(list, status.by)} takes this event</span>`;
    case 'anyway': return html`<span class="chip small muted" data-wl-extra="anyway" data-tip=${status.with === null ? `${OPTION_1} This skill is on option 1, so the run gets it without a listing.` : `The option ${nameOf(list, status.with)} takes also gives this skill, so the run gets it without a listing.`}>✓ ${name}</span>`;
  }
}

/** The extras outside the list, grouped by the card or event that offers them. */
function pool(list: PriorityList, locked: boolean) {
  if (!list.extras.length) return nothing;
  const groups = new Map<string, PriorityList['extras']>([...list.entries.values()].filter((w) => !w.isTarget).map((w) => [w.owner, []]));
  for (const x of list.extras) groups.get(x.entry.owner)!.push(x);
  const eventOrder = new Map<string, number>();
  for (const w of list.entries.values()) for (const e of w.events) if (!eventOrder.has(e.key)) eventOrder.set(e.key, eventOrder.size);
  const place = (w: WishlistEntry) => [eventOrder.get(w.events[0]!.key)!, w.events[0]!.optionIndex];
  for (const extras of groups.values()) extras.sort((a, b) => { const [ea, oa] = place(a.entry), [eb, ob] = place(b.entry); return ea! - eb! || oa! - ob!; });
  const addable = list.extras.filter((x) => x.status.kind === 'add').length;
  return html`<details class="wl-pool small" data-wl-pool ?open=${view.showExtras} @toggle=${(e: Event) => { view.showExtras = isOpen(e); }}>
    <summary>Other skills from this deck${addable ? ` (${addable} to add)` : ''}</summary>
    ${view.showExtras ? html`<p class="muted">Add a skill to steer the run to the event option that gives it. Each event's skills appear in option order, and ✓ marks skills the run gets without a listing. The deck search does not consider these; it follows ${goalLink}.</p>
    ${[...groups].filter(([, extras]) => extras.length).map(([owner, extras]) => html`<div class="wl-owner"><span class="muted">${owner}</span> ${extras.map((x) => poolChip(list, x.entry, x.status, locked))}</div>`)}` : nothing}
  </details>`;
}

export function renderPriorities(c: RunPlan) {
  const locked = view.searchPending;
  const list = c.priorities;
  const subtitle = [`${list.listed.length} of ${PRIORITIZED_SKILLS_MAX}`, ...(locked ? ['updating with the deck search'] : [])].join(', ');
  return panel({ title: 'Prioritized skills', kind: 'result', subtitle, tip: `Enter these in independent training's prioritized skills, in this order. ${OPTION_1} So only skills that move the run off option 1 are listed. Targeted skills come from ${TITLE.goal}, in its order; change them there. Below the list, add other skills from this deck; the deck search does not consider them.` }, html`
    ${overflow(list)}
    <ol class="wishlist ${locked ? 'wl-locked' : ''}" data-wl-locked=${locked ? 'true' : nothing}>${repeat(list.listed, (w) => w.key, (w, i) => row(list, w, i, locked))}</ol>
    ${list.listed.length ? nothing : html`<p class="muted small" data-wl-empty>Nothing needs listing: the run gets every targeted skill without steering an event.</p>`}
    ${unlistedTargets(list)}
    ${pool(list, locked)}`);
}
