// The list is what to enter in the game. Targeted skills follow Parent goal; the user adds and removes the extras. While a deck
// search runs the extras are locked, since the deck found may offer different ones.
import { html, nothing } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import { defaultOption } from '../../model/sparks.ts';
import { alternativesTo, defendedBy, type PriorityList, type RunPlan, type UnlistedReason } from '../../model/run.ts';
import type { WishlistEntry } from '../../model/deck.ts';
import { PRIORITIZED_SKILLS_MAX } from '../../model/rules.ts';
import { renderNow, store, update, view } from '../context.ts';
import { TITLE } from '../copy.ts';
import { isOpen } from '../form.ts';
import { skillTipText, skillWithTip } from '../format.ts';
import { panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

const GOAL_TARGETS_ID = 'goal-white-targets';
const OPTION_1 = 'Independent training takes option 1, the top option, of every event unless a listed skill is on another option; the scenario skill event takes its unaffiliated option instead. Guides confirm this for option 1 when nothing is listed; with other skills listed it is assumed.';
/** `already option 1`, or the default option's own name where an event has one. */
const defaultLabel = (w: WishlistEntry) => w.events.some((e) => defaultOption(e) !== 0) ? 'the default option' : 'option 1';
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
  const first = alternative.events.some((e) => shared.includes(e.key) && e.optionIndex === defaultOption(e));
  const swap = first ? `Removes ${nameOf(list, listed)}, so the run takes ${defaultLabel(alternative)} of the event they share and gets ${entryName(alternative)} there.`
    : `Lists ${entryName(alternative)} instead of ${nameOf(list, listed)}: they share an event, and the run takes only one of its options.`;
  const tip = skillTipText(alternative.skillId, `${swap}\n\nSource: ${alternative.reason}`);
  return html`<button class="wl-swap" data-action="wl-swap" data-id="${alternative.key}" data-for="${listed}" aria-label="List ${entryName(alternative)} instead of ${nameOf(list, listed)}" ?disabled=${locked} data-tip=${tip} @click=${() => swapExtra(alternative.key, listed)}>${label}</button>`;
}

function roleTag(w: WishlistEntry) {
  const role = ROLE_TAGS[w.role];
  return html`<span class="tag ${w.role === 'required' ? 'gold' : w.role === 'preferred' ? 'ok' : ''} wl-kind" data-tip=${role.tip}>${role.label}</span>`;
}

function row(list: PriorityList, w: WishlistEntry, i: number, locked: boolean) {
  const extra = w.role === 'extra';
  const alternatives = extra ? alternativesTo(list, w.key) : [];
  return html`<li data-wl-key="${w.key}" data-wl-role="${w.role}" class="${extra ? 'wl-extra' : 'wl-target'}">
    <span class="wl-num">${i + 1}.</span>
    <span class="wl-body">${roleTag(w)}${skillWithTip(w.skillId, w.form ? html`${w.name} <span class="muted">(for ${w.form})</span>` : w.name, `Source: ${w.reason}`)}</span>
    ${extra ? html`<button class="small wl-x" data-action="wl-remove" data-id="${w.key}" aria-label="Remove ${w.name}" data-tip="Remove from the list" ?disabled=${locked} @click=${() => removeExtra(w.key)}>✕</button>`
      : html`<button class="small wl-x wl-x-goal" data-action="wl-goal-target" data-id="${w.targetId}" aria-label="Edit ${w.name} in ${TITLE.goal}" data-tip=${TARGET_REMOVE} @click=${() => showGoal(w.targetId!)}>✕</button>`}
    ${alternatives.length ? html`<div class="wl-alts small" data-alternatives="${w.key}"><span class="muted">or instead:</span>${alternatives.map((a) => swapButton(list, a, w.key, locked, entryName(a)))}</div>` : nothing}</li>`;
}

const REASONS: Record<UnlistedReason, { label: (by: string, w: WishlistEntry) => string; tip: (by: string, w: WishlistEntry) => string }> = {
  hints: { label: () => 'no event choice', tip: () => 'The run gets this skill from hints and events without choosing an option, so listing it changes nothing.' },
  first: { label: (_, w) => `already ${defaultLabel(w)}`, tip: (_, w) => `${OPTION_1} This skill is on ${defaultLabel(w)}, so the run gets it without a listing.` },
  along: { label: (by) => `comes with ${by}`, tip: (by) => `The option ${by} takes at this event also gives this skill, so it needs no listing of its own.` },
  lost: { label: (by) => `${by} takes its event`, tip: (by) => `${by}, higher in ${TITLE.goal}, takes another option of every event that gives this skill, so it gets only hints. Change their order in ${TITLE.goal}.` },
};
const UNLISTED_TIP = 'The list leaves these out: listing them would change nothing the run does, or a higher targeted skill takes their event.';

function unlistedTargets(list: PriorityList) {
  if (!list.unlisted.length) return nothing;
  return html`<details class="wl-section small" data-wl-unlisted ?open=${view.showUnlisted} @toggle=${(e: Event) => { view.showUnlisted = isOpen(e); }}>
    <summary>Targeted skills not listed (${list.unlisted.length})</summary>
    ${view.showUnlisted ? html`<p class="muted wl-legend">${UNLISTED_TIP}</p><div class="scroll-x"><table class="wl-unlisted"><thead><tr><th>Targeted skill</th><th>Why it is not listed</th></tr></thead><tbody>
      ${list.unlisted.map(({ entry, reason, by }) => {
        const r = REASONS[reason], holder = by === null ? '' : nameOf(list, by);
        const label = r.label(holder, entry), tipText = r.tip(holder, entry);
        return html`<tr data-wl-unlisted-reason=${reason}><td>${roleTag(entry)}${skillWithTip(entry.skillId, entryName(entry), `Source: ${entry.reason}`)}</td>
          <td class="wl-reason ${reason === 'lost' ? 'warn' : ''}">${label}${tip(tipText)}</td></tr>`;
      })}</tbody></table></div>` : nothing}
  </details>`;
}

/** Targeted skills that lose every event to a higher one get only hints, which the user should not have to expand a section to see. */
function lostWarning(list: PriorityList) {
  const lost = list.unlisted.filter((u) => u.reason === 'lost');
  if (!lost.length) return nothing;
  return html`<p class="small warn" data-wl-lost>${lost.length === 1 ? '1 targeted skill gets' : `${lost.length} targeted skills get`} only hints, because a higher targeted skill takes every event that gives it:
    ${lost.map((u) => `${entryName(u.entry)} (${nameOf(list, u.by!)} takes its event)`).join(', ')}. Change their order in ${goalLink}.</p>`;
}

function overflow(list: PriorityList) {
  if (!list.overflow.length) return nothing;
  return html`<p class="small warn" data-wl-overflow>The game takes ${PRIORITIZED_SKILLS_MAX} skills, so these targeted skills do not fit and the run does not steer their events: ${list.overflow.map(entryName).join(', ')}. Remove targeted skills or lower their priority in ${goalLink}.</p>`;
}

/** What listing `w` moves the run away from: the default option of each event it would steer, and the skills there. */
function addTip(list: PriorityList, w: WishlistEntry) {
  const parts = w.events.filter((e) => e.optionIndex !== defaultOption(e) && !list.holders.has(e.key)).map((e) => {
    const given = list.extras.filter((x) => x.entry.events.some((o) => o.key === e.key && o.optionIndex === defaultOption(e))).map((x) => entryName(x.entry));
    return `${e.label}: option ${e.optionIndex + 1} instead of option ${defaultOption(e) + 1} (${given.length ? `giving up ${given.join(', ')}` : 'which gives no skill this deck tracks'})`;
  });
  const kept = defendedBy(list, w).map((t) => entryName(t));
  return `Add to the list. ${parts.join('. ')}.${kept.length ? ` Also lists ${kept.join(', ')} above it, so ${kept.length === 1 ? 'that targeted skill keeps its option' : 'those targeted skills keep their options'}.` : ''}`;
}

/** A skill's name with its description and sources on hover, without a tab stop of its own. */
const quietName = (w: WishlistEntry) => html`<span class="wl-name" data-tip=${skillTipText(w.skillId, `Source: ${w.reason}`)}>${entryName(w)}</span>`;

/** One skill on one option of an event, with the action that would list it. */
function optionSkill(list: PriorityList, w: WishlistEntry, locked: boolean) {
  const at = list.listed.indexOf(w);
  if (at >= 0) return html`<span class="wl-skill" data-wl-extra="listed">${quietName(w)} <span class="tag">listed #${at + 1}</span></span>`;
  if (w.isTarget) return html`<span class="wl-skill" data-wl-extra="target">${quietName(w)} ${roleTag(w)}</span>`;
  const status = list.extras.find((x) => x.entry === w)!.status;
  switch (status.kind) {
    case 'add':
    case 'full': {
      const full = status.kind === 'full';
      return html`<span class="wl-skill" data-wl-extra=${status.kind}>${quietName(w)} <button class="small wl-add" data-action="wl-add" data-id="${w.key}" aria-label="Add ${entryName(w)} to the list" data-tip=${full ? `The game takes ${PRIORITIZED_SKILLS_MAX} skills and the list is full.` : addTip(list, w)} ?disabled=${locked || full} @click=${() => addExtra(w.key)}>+ Add</button></span>`;
    }
    case 'swap': return html`<span class="wl-skill" data-wl-extra="swap">${quietName(w)} ${swapButton(list, w, status.with, locked, 'Swap in')}</span>`;
    case 'blocked': return html`<span class="wl-skill muted" data-wl-extra="blocked">${quietName(w)}</span>`;
    case 'anyway': return html`<span class="wl-skill muted" data-wl-extra="anyway" data-tip=${status.with === null ? `${OPTION_1} This skill is on ${defaultLabel(w)}, so the run gets it without a listing.` : `The option ${nameOf(list, status.with)} takes also gives this skill, so the run gets it without a listing.`}>✓ ${quietName(w)}</span>`;
  }
}

interface PoolEvent { key: string; label: string; options: Map<number, WishlistEntry[]> }
/** The events the deck's extras are on, with every skill on each option, grouped by the card or event that holds them. */
function poolEvents(list: PriorityList): Map<string, PoolEvent[]> {
  const all = [...list.entries.values()], extras = all.filter((w) => !w.isTarget);
  const owners = [...new Set(extras.map((w) => w.owner))];
  const groups = new Map<string, PoolEvent[]>();
  const events = new Map<string, PoolEvent>();
  for (const w of extras) for (const e of w.events) if (!events.has(e.key)) {
    const owner = owners.find((o) => e.label === o || e.label.startsWith(`${o}'s `)) ?? w.owner;
    const rest = e.label === owner ? '' : e.label.slice(owner.length + 3);
    const ev = { key: e.key, label: rest.charAt(0).toUpperCase() + rest.slice(1), options: new Map<number, WishlistEntry[]>() };
    events.set(e.key, ev);
    groups.set(owner, [...(groups.get(owner) ?? []), ev]);
  }
  for (const w of all) for (const e of w.events) {
    const options = events.get(e.key)?.options;
    if (options && !options.get(e.optionIndex)?.includes(w)) options.set(e.optionIndex, [...(options.get(e.optionIndex) ?? []), w]);
  }
  for (const ev of events.values()) ev.options = new Map([...ev.options].sort(([a], [b]) => a - b));
  return groups;
}

/** Said once per event: a targeted skill holds it, so its other options can only be listed through Parent goal. */
function heldNote(list: PriorityList, ev: PoolEvent) {
  const by = list.holders.get(ev.key);
  const holder = by === undefined ? null : list.entries.get(by)!;
  const blocked = [...ev.options.values()].flat().filter((w) => list.extras.some((x) => x.entry === w && x.status.kind === 'blocked'));
  if (!holder?.isTarget || !blocked.length) return nothing;
  return html`<div class="muted wl-held" data-wl-held>${entryName(holder)}, a targeted skill, holds this event. To list another option instead, add that skill as a target white spark above ${entryName(holder)} in ${goalLink}.</div>`;
}

const POOL_TIP = `Skills this deck's events offer outside the targeted skills, by card and event, with each event's options in order. The deck search does not consider them; it follows ${TITLE.goal}.`;

function pool(list: PriorityList, locked: boolean) {
  if (!list.extras.length) return nothing;
  return html`<details class="wl-pool small" data-wl-pool ?open=${view.showExtras} @toggle=${(e: Event) => { view.showExtras = isOpen(e); }}>
    <summary>Extra skills (${list.extras.length})</summary>
    ${view.showExtras ? html`<p class="muted wl-legend">${POOL_TIP}<br>+ Add steers the run to that option · ✓ the run gets it anyway · Swap in replaces the listed skill on that event</p>
    ${[...poolEvents(list)].map(([owner, events]) => html`<div class="wl-owner"><div class="wl-owner-name">${owner}</div>
      ${events.map((ev) => html`<div class="wl-event" data-wl-event=${ev.key}>${ev.label ? html`<div class="muted wl-event-name">${ev.label}</div>` : nothing}
        <div class="wl-options">${[...ev.options].map(([option, skills]) => html`<span class="wl-option"><span class="wl-option-n" aria-label="Option ${option + 1}">${option + 1}</span>${skills.map((w) => optionSkill(list, w, locked))}</span>`)}</div>
        ${heldNote(list, ev)}</div>`)}</div>`)}` : nothing}
  </details>`;
}

export function renderPriorities(c: RunPlan) {
  const locked = view.searchPending;
  const list = c.priorities;
  const subtitle = [`${list.listed.length} of ${PRIORITIZED_SKILLS_MAX}`, ...(locked ? ['updating with the deck search'] : [])].join(', ');
  return panel({ title: 'Prioritized skills', kind: 'result', subtitle, tip: `Enter these in independent training's prioritized skills, in this order. ${OPTION_1} So only skills that move the run off that option are listed. Targeted skills come from ${TITLE.goal}, in its order; change them there. Below the list, add other skills from this deck; the deck search does not consider them.` }, html`
    ${overflow(list)}
    ${lostWarning(list)}
    <ol class="wishlist ${locked ? 'wl-locked' : ''}" data-wl-locked=${locked ? 'true' : nothing}>${repeat(list.listed, (w) => w.key, (w, i) => row(list, w, i, locked))}</ol>
    ${list.listed.length ? nothing : html`<p class="muted small" data-wl-empty>${list.unlisted.some((u) => u.reason === 'lost') ? 'Nothing to list.' : 'Nothing needs listing: the run gets every targeted skill without steering an event.'}</p>`}
    ${pool(list, locked)}
    ${unlistedTargets(list)}`);
}
