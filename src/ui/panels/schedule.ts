// The G1 agenda: three career years of half-month slots, the race picked in each, and the win threshold that
// decides which races the automatic rule schedules.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { RunPlan } from '../../model/run.ts';
import { buildSchedule, goalRaces, slotOf, type ScheduledRace } from '../../model/races.ts';
import { racePopularityMap } from '../../model/run.ts';
import { data, plan, store, update } from '../context.ts';
import { num, pct, pill } from '../format.ts';
import { panel } from '../panel.ts';
import { tip } from '../tooltip.ts';
import { setSetting } from './run.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YEARS = ['Junior year', 'Classic year', 'Senior year'];
const CATEGORY_SHORT: Record<string, string> = { sprint: 'spr', mile: 'mile', medium: 'med', long: 'long' };
const slotLabel = (slot: number) => `${slot % 2 === 0 ? 'Early' : 'Late'} ${MONTHS[Math.floor((slot % 24) / 2)]}`;

/**
 * Pick a race for a slot (or none). A pick equal to what the automatic rule would choose clears the slot's
 * overrides; anything else forces the chosen race in and the slot's other races out.
 */
function pickSlot(slot: number, calendarId: string) {
  const inSlot = data.races.filter((r) => !r.unreleasedEn && slotOf(r) === slot);
  const auto = new Map(Object.entries(store.run.raceOverrides));
  for (const r of inSlot) auto.delete(r.calendarId);
  const c = plan();
  const autoPick = buildSchedule(data.races, c.apt, store.settings.winThreshold, auto, racePopularityMap(data), goalRaces(c.trainee)).find((x) => x.slot === slot && x.selected)?.race.calendarId ?? '';
  update((s) => {
    for (const r of inSlot) delete s.run.raceOverrides[r.calendarId];
    if (calendarId !== autoPick) for (const r of inSlot) s.run.raceOverrides[r.calendarId] = r.calendarId === calendarId;
  });
}

function raceInfo(sel: ScheduledRace) {
  return html`<div class="agenda-race ${sel.race.surface}">${sel.race.name}</div>
    <div class="agenda-meta">${sel.race.surface} ${CATEGORY_SHORT[sel.race.category]} ${sel.race.distance}</div>
    <div class="agenda-meta">win ${pill(sel.base)}${sel.pWin < sel.base ? html`→${pill(sel.pWin, 'warn')}` : nothing}</div>${sel.consecutive > 2 ? html`<div class="agenda-meta"><span class="tag warn" title="${sel.consecutive} races in consecutive half-month slots: the streak penalty applies">streak ${sel.consecutive}</span></div>` : nothing}`;
}

function cell(slot: number, entries: ScheduledRace[]) {
  const sel = entries.find((e) => e.selected);
  if (!entries.length) return html`<div class="agenda-cell empty"><div class="agenda-body"></div><div class="agenda-pick"></div><div class="agenda-label">${slotLabel(slot)}</div></div>`;
  if (sel?.goal) return html`<div class="agenda-cell sel goal">
    <div class="agenda-body">${raceInfo(sel)}</div>
    <div class="agenda-pick"><span class="tag goal">career goal</span></div>
    <div class="agenda-label">${slotLabel(slot)}</div>
  </div>`;
  const manual = entries.some((e) => store.run.raceOverrides[e.race.calendarId] != null);
  return html`<div class="agenda-cell ${sel ? 'sel' : 'avail'}">
    <div class="agenda-body">${sel ? raceInfo(sel) : html`<div class="agenda-meta muted agenda-avail">${entries.map((e) => `${e.race.name} ${pct(e.base)}`).join(' · ')}</div>`}</div>
    <div class="agenda-pick"><select data-slot="${slot}" .value=${live(sel?.race.calendarId ?? '')} @change=${(e: Event) => pickSlot(slot, (e.target as HTMLSelectElement).value)}>
      <option value="" ?selected=${!sel}>— skip —</option>
      ${entries.map((e) => html`<option value="${e.race.calendarId}" ?selected=${e.selected}>${e.race.name} (${pct(e.base)}${e.selected ? '' : `, ${e.reason.toLowerCase()}`})</option>`)}
    </select>${manual ? tip('Picked by hand. "Clear manual picks" returns this slot to the automatic rule.') : nothing}</div>
    <div class="agenda-label">${slotLabel(slot)}</div>
  </div>`;
}

const AGENDA_TIP = `Career goal races are fixed and shown in gold. Every other G1 the trainee can win at or above the threshold is scheduled once, in the year that costs fewer expected losses; when two G1s share a slot, the one more umas can run comfortably wins the tie (a stand-in for how common the race is on parents). Pick a race by hand to override the rule.

Win chances follow Shoppo_ura's independent-training data: 110% at A/A minus a penalty per surface grade (B −10, C −20, D −30, E −50, F −60, G −90) and per distance grade (B −10, C −20, D −30, E −40, F −60, G −90), minus the streak penalty for consecutive races (3rd in a row −5, 4th −20, 5th −30, 6th and later −50), clamped to 0 to 100%. Stats, skills and mood do not matter. A career goal the run would end on losing is always won; a participation-only goal rolls the odds.`;
const THRESHOLD_TIP = 'A G1 is scheduled automatically when its win chance is at least this. Lower it for more races and more fans; raise it for fewer expected losses.';

export function renderSchedule(c: RunPlan) {
  const bySlot = new Map<number, ScheduledRace[]>();
  for (const r of c.schedule) bySlot.set(r.slot, [...(bySlot.get(r.slot) ?? []), r]);
  const overridden = Object.keys(store.run.raceOverrides).length > 0;
  const subtitle = `(${c.sum.count} races${c.sum.goals ? `, ${c.sum.goals} career goals` : ''} · ${num(c.sum.expectedWins, 1)} expected wins, ${num(c.sum.expectedLosses, 1)} expected losses${c.sum.longestStreak > 2 ? ` · longest streak ${c.sum.longestStreak}` : ''})`;
  const actions = html`
    ${overridden ? html`<button class="small" data-action="reset-races" @click=${() => update((s) => { s.run.raceOverrides = {}; })}>Clear manual picks</button>` : nothing}
    <label class="threshold"><span class="k">Win chance at least${tip(THRESHOLD_TIP)}</span>
      <input type="range" min="0" max="1" step="0.05" .value=${live(String(store.settings.winThreshold))} data-setting="winThreshold"
        @input=${(e: Event) => { const out = (e.target as HTMLElement).parentElement?.querySelector('output'); if (out) out.value = pct(Number((e.target as HTMLInputElement).value)); }}
        @change=${(e: Event) => setSetting('winThreshold', (e.target as HTMLInputElement).value)} /><output data-setting-output="winThreshold" .value=${live(pct(store.settings.winThreshold))}></output></label>`;
  return panel({ title: 'G1 agenda', subtitle, tip: AGENDA_TIP, actions }, html`
    <div class="agenda">
      ${YEARS.map((y, yi) => html`<div class="agenda-year"><div class="agenda-year-head">${y}</div><div class="agenda-grid">${Array.from({ length: 24 }, (_, i) => cell(yi * 24 + i, bySlot.get(yi * 24 + i) ?? []))}</div></div>`)}
    </div>`);
}
