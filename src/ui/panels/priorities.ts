// The list is what to enter in the game. Targeted skills follow Parent goal; the user adds and removes the extras. While a
// deck search runs the extras are locked, since the deck found may offer different ones.
import { html, nothing } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import { defaultOption } from '../../model/sparks.ts';
import { alternativesTo, sharingOverflow, type ExtraStatus, type PriorityList, type RunPlan, type UnlistedReason } from '../../model/run.ts';
import type { WishlistEntry } from '../../model/deck.ts';
import { PRIORITIZED_SKILLS_MAX } from '../../model/rules.ts';
import { isGold, type Card } from '../../types.ts';
import { data, plan, renderNow, store, update, view } from '../context.ts';
import { TITLE } from '../copy.ts';
import { isOpen } from '../form.ts';
import { cardImg, cardUrl, charImg, skillIcon } from '../format.ts';
import { panel } from '../panel.ts';
import { registerRichTip, tip } from '../tooltip.ts';

const GOAL_TARGETS_ID = 'goal-white-targets';
const OPTION_1 = 'Independent training takes option 1, the top option, of every event unless a listed skill is on another option; the scenario skill event takes its unaffiliated option instead. Guides confirm this for option 1 when nothing is listed; with other skills listed it is assumed.';
const ROLE_TAGS = {
  required: { label: 'required', tip: `A required target white spark from ${TITLE.goal}. Change targeted skills and their order there.` },
  preferred: { label: 'preferred', tip: `A preferred target white spark from ${TITLE.goal}. Change targeted skills and their order there.` },
  extra: { label: 'extra', tip: 'Not a targeted skill. You added it, and listing it steers the run to the event option that gives it.' },
};
const TARGET_REMOVE = `Targeted skills come from ${TITLE.goal}. Opens it there, where you can remove this skill or change its priority.`;
const SCENARIO_LABEL_START = 'Our Grand Concert';

const entryName = (w: WishlistEntry) => w.form ? `${w.name} (for ${w.form})` : w.name;
const nameOf = (list: PriorityList, key: number) => entryName(list.entries.get(key)!);
/** `option 1`, or `the default option` where an event names its own. */
const defaultLabel = (w: WishlistEntry) => w.events.some((e) => defaultOption(e) !== 0) ? 'the default option' : 'option 1';

const PLUS = html`<svg class="wl-ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>`;
const CHECK = html`<svg class="wl-ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" /></svg>`;

/** Shows Parent goal's targeted skills, with `targetId`'s editor open when given. */
function showGoal(targetId?: number | null) {
  if (store.ui.inputsHidden) update((s) => { s.ui.inputsHidden = false; });
  if (targetId != null) view.targetEditorId = targetId;
  renderNow();
  const editor = targetId == null ? null : document.querySelector<HTMLElement>(`[data-target-editor="${targetId}"]`);
  (editor ?? document.getElementById(GOAL_TARGETS_ID))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  editor?.querySelector<HTMLElement>('[data-action="remove-target"]')?.focus({ preventScroll: true });
}

const addExtra = (key: number) => update((s) => { s.run.addedExtras = [...s.run.addedExtras.filter((k) => k !== key), key]; });
const removeExtra = (key: number) => update((s) => { s.run.addedExtras = s.run.addedExtras.filter((k) => k !== key); });
/** `alternative` takes `listed`'s place, so it steers the event they share instead. */
const swapExtra = (alternative: number, listed: number) => update((s) => {
  const rest = s.run.addedExtras.filter((k) => k !== alternative);
  const i = rest.indexOf(listed);
  s.run.addedExtras = i < 0 ? [...rest, alternative] : [...rest.slice(0, i), alternative, ...rest.slice(i + 1)];
});
const dismiss = (key: string) => { view.dismissedWarnings = [...view.dismissedWarnings, key]; };

/* The skill tooltip: each card, trainee or scenario event that offers the skill, its event and option, then the skill. */
let cardsByName: Map<string, Card> | null = null;
type Owner = { name: string; card: Card | null };
/** The card or trainee a source text such as `Owner's chain event 1 "…"` or `Owner: Hint …` names; null for the scenario. */
function ownerOf(text: string): Owner | null {
  if (text.startsWith(SCENARIO_LABEL_START)) return null;
  cardsByName ??= new Map(data.cards.map((c) => [c.name, c]));
  const names = [...cardsByName.keys(), plan().trainee?.name ?? ''];
  const name = names.find((n) => n && (text === n || text.startsWith(`${n}'s `) || text.startsWith(`${n}: `)));
  return name ? { name, card: cardsByName.get(name) ?? null } : null;
}
function ownerHead(owner: Owner | null, scenario: string) {
  if (!owner) return html`<div class="tt-head"><span class="tt-art tt-scenario" aria-hidden="true">★</span><div><b>Scenario event</b><span class="tt-k">${scenario}</span></div></div>`;
  const { card } = owner, trainee = plan().trainee;
  if (!card) return html`<div class="tt-head">${trainee ? html`<img class="tt-art" src=${charImg(trainee)} alt="" />` : nothing}<div><b>${owner.name}</b><span class="tt-k">Trainee events</span></div></div>`;
  return html`<div class="tt-head"><img class="tt-art" src=${cardImg(card)} alt="" />
    <div><b><img class="type-icon" src="/assets/icons/type_${card.type}.png" alt=${card.type} /> <a class="card-link" href=${cardUrl(card)} target="_blank" rel="noopener">${card.charName}</a></b><span class="tt-k">${card.title}</span></div></div>`;
}
function eventLine(label: string, owner: Owner | null) {
  if (!owner) return 'Lyrics choice';
  const rest = label.startsWith(`${owner.name}'s `) ? label.slice(owner.name.length + 3) : label;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
function skillTip(key: string) {
  const w = plan().priorities.entries.get(Number(key));
  if (!w) return null;
  const sk = data.skillById.get(w.skillId);
  const places = w.events.length
    ? w.events.map((e) => { const owner = ownerOf(e.label); return html`${ownerHead(owner, e.label)}<div class="tt-ev">${eventLine(e.label, owner)}, <b>option ${e.optionIndex + 1}</b></div>`; })
    : w.reason.split('; ').map((part) => { const owner = ownerOf(part); return html`${owner ? ownerHead(owner, part) : nothing}<div class="tt-ev">${owner ? part.slice(owner.name.length + 2) : part}</div>`; });
  return html`${places.map((p, i) => html`<div class=${i ? 'tt-sec' : ''}>${p}</div>`)}
    <div class="tt-sec"><b>${entryName(w)}</b>${sk && isGold(sk) ? html` <span class="tag gold">gold</span>` : nothing}<div class="tt-k">${sk?.desc ?? ''}</div></div>`;
}
registerRichTip('wl', skillTip);

const icon = (w: WishlistEntry) => { const src = skillIcon(data.skillById.get(w.skillId)); return src ? html`<img class="wl-icon" src=${src} alt="" />` : nothing; };
const nameTip = (w: WishlistEntry, cls = 'wl-name') => html`<span class=${cls} data-rich="wl:${w.key}" tabindex="0" role="button" aria-describedby="tooltip">${entryName(w)}</span>`;
function roleTag(w: WishlistEntry) {
  const role = ROLE_TAGS[w.role];
  return html`<span class="tag ${w.role === 'required' ? 'gold' : w.role === 'preferred' ? 'ok' : ''} wl-kind" data-tip=${role.tip}>${role.label}</span>`;
}
const extrasWhere = (list: PriorityList, test: (s: ExtraStatus) => boolean) => list.extras.filter((x) => test(x.status)).map((x) => x.entry);

/** What adding `w` moves the run off: the default option of each event it would steer, and any targeted skill it also lists. */
function addTip(list: PriorityList, w: WishlistEntry, lists: readonly number[]) {
  const parts = w.events.filter((e) => e.optionIndex !== defaultOption(e) && !list.holders.has(e.key)).map((e) => {
    const given = [...list.entries.values()].filter((x) => x !== w && x.events.some((o) => o.key === e.key && o.optionIndex === defaultOption(e))).map(entryName);
    return `${e.label}: option ${e.optionIndex + 1} instead of option ${defaultOption(e) + 1} (${given.length ? `giving up ${given.join(', ')}` : 'which gives no skill this deck tracks'})`;
  });
  const kept = lists.map((key) => nameOf(list, key));
  return `Add to the list. ${parts.join('. ')}.${kept.length ? ` Also lists ${kept.join(', ')} above it, so ${kept.length === 1 ? 'that targeted skill keeps its option' : 'those targeted skills keep their options'}.` : ''}`;
}
function swapTip(list: PriorityList, alternative: WishlistEntry, listed: number) {
  const shared = list.entries.get(listed)!.events.map((e) => e.key);
  return alternative.events.some((e) => shared.includes(e.key) && e.optionIndex === defaultOption(e))
    ? `Removes ${nameOf(list, listed)}, so the run takes ${defaultLabel(alternative)} of the event they share and gets ${entryName(alternative)} there.`
    : `Lists ${entryName(alternative)} instead of ${nameOf(list, listed)}: they share an event, and the run takes only one of its options.`;
}

/** Options a targeted skill keeps the run from taking, and targeted skills that lose their event to it; each + opens Parent goal. */
function heldLine(list: PriorityList, holderKey: number) {
  const lost = list.unlisted.filter((u) => u.reason === 'lost' && u.by === holderKey).map((u) => u.entry);
  const items = [...lost, ...extrasWhere(list, (s) => s.kind === 'blocked' && s.by === holderKey)];
  if (!items.length) return nothing;
  const holder = nameOf(list, holderKey);
  const tipFor = (w: WishlistEntry) => w.isTarget
    ? `${entryName(w)} is a targeted skill below ${holder} in ${TITLE.goal}, and they share an event that the run takes one option of. To list ${entryName(w)} instead, raise it above ${holder} in ${TITLE.goal}. Opens ${TITLE.goal}.`
    : `${entryName(w)} shares an event with ${holder}, a targeted skill, and the run takes only one option. To list ${entryName(w)} instead, add it as a target white spark above ${holder} in ${TITLE.goal}. Opens ${TITLE.goal}.`;
  return html`<div class="wl-alts small" data-wl-held=${holderKey}><span class="muted">or instead:</span>${items.map((w) => html`<span class="wl-chip held">${icon(w)}${nameTip(w, 'wl-chip-name')}<button class="wl-chip-btn" data-action="wl-goal" data-id=${w.key} data-tip=${tipFor(w)} aria-label="List ${entryName(w)} instead of ${holder}: opens ${TITLE.goal}" @click=${() => showGoal(w.isTarget ? w.targetId : null)}>${PLUS}</button></span>`)}</div>`;
}
function comesWithLine(list: PriorityList, key: number) {
  const items = extrasWhere(list, (s) => s.kind === 'anyway' && s.with === key);
  if (!items.length) return nothing;
  return html`<div class="wl-alts small" data-wl-comes=${key}><span class="muted">comes with:</span>${items.map((w) => html`<span class="wl-chip">${icon(w)}${nameTip(w, 'wl-chip-name')}${tip(`On the same option as ${nameOf(list, key)}, so the run gets both from that one listing.`)}</span>`)}</div>`;
}
function swapLine(list: PriorityList, key: number, locked: boolean) {
  const items = alternativesTo(list, key);
  if (!items.length) return nothing;
  return html`<div class="wl-alts small" data-alternatives=${key}><span class="muted">or instead:</span>${items.map((w) => html`<button class="wl-swap" data-action="wl-swap" data-id=${w.key} data-for=${key} aria-label="List ${entryName(w)} instead of ${nameOf(list, key)}" ?disabled=${locked} data-tip=${swapTip(list, w, key)} @click=${() => swapExtra(w.key, key)}>${icon(w)}${entryName(w)}</button>`)}</div>`;
}
/** A targeted skill on its event's default option is listed only to keep a lower listed skill from taking that event: say which. */
function keepsTip(list: PriorityList, w: WishlistEntry) {
  if (!w.isTarget || w.events.some((e) => e.optionIndex !== defaultOption(e))) return nothing;
  for (const e of w.events) {
    if (list.holders.get(e.key) !== w.key) continue;
    const rival = list.listed.find((x) => x !== w && x.events.some((o) => o.key === e.key && o.optionIndex !== e.optionIndex));
    if (!rival) continue;
    const at = rival.events.find((o) => o.key === e.key)!.optionIndex + 1;
    return tip(`Listed to keep its event. ${w.name} is ${defaultLabel(w)} of ${e.label}, which the run would take anyway, but ${entryName(rival)} is listed and on option ${at} of that event. Listing ${w.name} above it keeps the run on ${defaultLabel(w)}.`);
  }
  return nothing;
}

function row(list: PriorityList, w: WishlistEntry, i: number, locked: boolean) {
  const extra = w.role === 'extra';
  return html`<li data-wl-key=${w.key} data-wl-role=${w.role} class=${extra ? 'wl-extra' : 'wl-target'}>
    <span class="wl-num">${i + 1}.</span>
    <span class="wl-body">${roleTag(w)}${icon(w)}${nameTip(w)}${keepsTip(list, w)}</span>
    ${extra ? html`<button class="small wl-x" data-action="wl-remove" data-id=${w.key} aria-label="Remove ${entryName(w)}" data-tip="Remove from the list" ?disabled=${locked} @click=${() => removeExtra(w.key)}>✕</button>`
      : html`<button class="small wl-x wl-x-goal" data-action="wl-goal-target" data-id=${w.targetId} aria-label="Edit ${entryName(w)} in ${TITLE.goal}" data-tip=${TARGET_REMOVE} @click=${() => showGoal(w.targetId)}>✕</button>`}
    ${extra ? swapLine(list, w.key, locked) : heldLine(list, w.key)}${comesWithLine(list, w.key)}</li>`;
}

/** A warning the user can dismiss; a different warning, such as one naming other skills, shows again. */
function warning(key: string, body: string) {
  if (view.dismissedWarnings.includes(key)) return nothing;
  return html`<div class="wl-warning small" role="status" data-wl-warning=${key.split(':')[0]}><p>${body}</p><button class="wl-dismiss" data-action="wl-dismiss" aria-label="Dismiss this warning" data-tip="Dismiss" @click=${() => dismiss(key)}>✕</button></div>`;
}
function warnings(list: PriorityList) {
  const lost = list.unlisted.filter((u) => u.reason === 'lost');
  const over = list.overflow, one = over.length === 1, sharing = sharingOverflow(list);
  const caveat = sharing.length ? ` ${sharing.map(entryName).join(', ')} ${sharing.length === 1 ? 'shares an event' : 'share events'} with ${one ? 'it' : 'them'}, so ${sharing.length === 1 ? 'its status' : 'their statuses'} here may be wrong: the run takes the default option of an event no listed skill steers.` : '';
  return html`${over.length ? warning(`overflow:${over.map((w) => w.key).join(',')}`, `The game takes ${PRIORITIZED_SKILLS_MAX} skills, so ${one ? 'this targeted skill does' : 'these targeted skills do'} not fit and the run does not steer ${one ? 'its' : 'their'} events: ${over.map(entryName).join(', ')}.${caveat} Consider removing targeted skills or lowering their priority if that isn't what you want.`) : nothing}
    ${lost.length ? warning(`lost:${lost.map((u) => u.entry.key).join(',')}`, lost.length === 1
      ? `${entryName(lost[0]!.entry)} gets only hints, because ${nameOf(list, lost[0]!.by!)}, a higher targeted skill, takes every event that gives it. Consider changing their order if that isn't what you want.`
      : `${lost.length} targeted skills get only hints, because a higher targeted skill takes every event that gives them: ${lost.map((u) => `${entryName(u.entry)} (${nameOf(list, u.by!)} takes its event)`).join(', ')}. Consider changing their order if that isn't what you want.`) : nothing}`;
}

const REASONS: Record<UnlistedReason | 'overflow', { label: (by: string, w: WishlistEntry) => string; tip: (by: string, w: WishlistEntry) => string }> = {
  hints: { label: () => 'no event choice', tip: () => 'The run gets this skill from hints and events without choosing an option, so listing it changes nothing.' },
  first: { label: (_, w) => `already ${defaultLabel(w)}`, tip: (_, w) => `${OPTION_1} This skill is on ${defaultLabel(w)}, so the run gets it without a listing.` },
  along: { label: (by) => `comes with ${by}`, tip: (by) => `The option ${by} takes at this event also gives this skill, so it needs no listing of its own.` },
  lost: { label: (by) => `${by} takes its event`, tip: (by) => `${by}, higher in ${TITLE.goal}, takes another option of every event that gives this skill, so it gets only hints. Consider changing their order in ${TITLE.goal} if that isn't what you want.` },
  overflow: { label: () => 'does not fit', tip: () => `The game takes ${PRIORITIZED_SKILLS_MAX} skills, and higher targeted skills fill the list, so the run does not steer this one's events. Remove targeted skills or lower their priority in ${TITLE.goal} to make room.` },
};
const UNLISTED_NOTE = 'The list leaves these out: listing them would change nothing the run does, a higher targeted skill takes their event, or the list is full.';

/** Collapsed unless something here needs attention: a targeted skill that does not fit or gets only hints. */
function unlistedTargets(list: PriorityList) {
  const rows = [...list.overflow.map((entry) => ({ entry, reason: 'overflow' as const, by: null })), ...list.unlisted];
  if (!rows.length) return nothing;
  const warned = list.overflow.length > 0 || list.unlisted.some((u) => u.reason === 'lost');
  const open = view.showUnlisted ?? warned;
  return html`<details class="wl-section small" data-wl-unlisted ?open=${open} @toggle=${(e: Event) => { if (isOpen(e) !== open) view.showUnlisted = isOpen(e); }}>
    <summary>Targeted skills not listed (${rows.length})</summary>
    ${open ? html`<p class="muted wl-note">${UNLISTED_NOTE}</p><div class="scroll-x"><table class="wl-unlisted"><thead><tr><th>Targeted skill</th><th>Why it is not listed</th></tr></thead><tbody>
      ${rows.map(({ entry, reason, by }) => {
        const r = REASONS[reason], holder = by === null ? '' : nameOf(list, by);
        return html`<tr data-wl-unlisted-reason=${reason}><td><span class="wl-body">${roleTag(entry)}${icon(entry)}${nameTip(entry)}</span>${heldLine(list, entry.key)}${comesWithLine(list, entry.key)}</td>
          <td class="wl-reason ${reason === 'lost' || reason === 'overflow' ? 'warn' : ''}">${r.label(holder, entry)}${tip(r.tip(holder, entry))}</td></tr>`;
      })}</tbody></table></div>` : nothing}
  </details>`;
}

function poolChip(list: PriorityList, w: WishlistEntry, status: ExtraStatus, locked: boolean) {
  if (status.kind !== 'add' && status.kind !== 'full') return html`<span class="wl-chip quiet" data-wl-extra=${status.kind}>${icon(w)}${nameTip(w, 'wl-chip-name')}</span>`;
  const full = status.kind === 'full';
  return html`<span class="wl-chip add" data-wl-extra=${status.kind}>${icon(w)}${nameTip(w, 'wl-chip-name')}<button class="wl-chip-btn" data-action="wl-add" data-id=${w.key} aria-label="Add ${entryName(w)} to the list" data-tip=${full ? `The game takes ${PRIORITIZED_SKILLS_MAX} skills and the list is full.` : addTip(list, w, status.lists)} ?disabled=${locked || full} @click=${() => addExtra(w.key)}>${PLUS}</button></span>`;
}
const POOL_TIP = `Skills this deck's events offer outside the targeted skills. Hover or tap a skill for its card, event and option. The deck search does not consider them; it follows ${TITLE.goal}.`;

function pool(list: PriorityList, locked: boolean) {
  const addable = list.extras.filter((x) => x.status.kind === 'add' || x.status.kind === 'full');
  const byDefault = list.extras.filter((x) => x.status.kind === 'anyway');
  const chips = (items: PriorityList['extras']) => items.length
    ? html`<div class="wl-chips">${repeat(items, (x) => x.entry.key, (x) => poolChip(list, x.entry, x.status, locked))}</div>` : html`<div class="muted">None</div>`;
  return html`<div class="wl-pool small" data-wl-pool>
    <div class="wl-pool-head"><h3>Extra skills <span class="muted">(${list.extras.length})</span></h3>${tip(POOL_TIP)}</div>
    <div class="wl-row"><div class="wl-row-k wl-row-add">${PLUS}Can add <span class="muted">${addable.length}</span></div>${chips(addable)}</div>
    <details class="wl-row" data-wl-default ?open=${view.showDefaultExtras} @toggle=${(e: Event) => { view.showDefaultExtras = isOpen(e); }}>
      <summary class="wl-row-k wl-row-default">${CHECK}Obtained by default <span class="muted">${byDefault.length}</span></summary>${view.showDefaultExtras ? chips(byDefault) : nothing}
    </details>
  </div>`;
}

export function renderPriorities(c: RunPlan) {
  const locked = view.searchPending;
  const list = c.priorities;
  const lost = list.unlisted.some((u) => u.reason === 'lost');
  const subtitle = [`${list.listed.length} of ${PRIORITIZED_SKILLS_MAX}`, ...(locked ? ['updating with the deck search'] : [])].join(', ');
  return panel({ title: 'Prioritized skills', kind: 'result', subtitle, tip: `Enter these in independent training's prioritized skills, in this order. ${OPTION_1} So only skills that move the run off that option are listed. Targeted skills come from ${TITLE.goal}, in its order; change them there. Below the list, add other skills from this deck; the deck search does not consider them.` }, html`
    ${warnings(list)}
    <ol class="wishlist ${locked ? 'wl-locked' : ''}" data-wl-locked=${locked ? 'true' : nothing}>${repeat(list.listed, (w) => w.key, (w, i) => row(list, w, i, locked))}</ol>
    ${list.listed.length ? nothing : html`<p class="muted small" data-wl-empty>${lost ? 'Nothing to list.' : 'Nothing needs listing: the run gets every targeted skill without steering an event.'}</p>`}
    ${unlistedTargets(list)}
    ${pool(list, locked)}`);
}
