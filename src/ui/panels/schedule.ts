import { html, nothing } from 'lit-html';
import type { RunPlan } from '../../model/run.ts';
import { buildSchedule, goalRaces, slotOf, type ScheduledRace } from '../../model/races.ts';
import { racePopularityMap } from '../../model/run.ts';
import { data, plan, store, update } from '../context.ts';
import { num, pct, pill } from '../format.ts';
import { tip } from '../tooltip.ts';

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
    <div class="agenda-pick"><select data-slot="${slot}" @change=${(e: Event) => pickSlot(slot, (e.target as HTMLSelectElement).value)}>
      <option value="" ?selected=${!sel}>— skip —</option>
      ${entries.map((e) => html`<option value="${e.race.calendarId}" ?selected=${e.selected}>${e.race.name} (${pct(e.base)}${e.selected ? '' : `, ${e.reason.toLowerCase()}`})</option>`)}
    </select>${manual ? tip('Manual pick for this slot. "Clear manual picks" returns it to the automatic rule.') : nothing}</div>
    <div class="agenda-label">${slotLabel(slot)}</div>
  </div>`;
}

export function renderSchedule(c: RunPlan) {
  const bySlot = new Map<number, ScheduledRace[]>();
  for (const r of c.schedule) bySlot.set(r.slot, [...(bySlot.get(r.slot) ?? []), r]);
  const overridden = Object.keys(store.run.raceOverrides).length > 0;
  return html`
    <section class="panel">
      <h2>G1 agenda <span class="small muted">(${c.sum.count} races, ${c.sum.unique} unique${c.sum.goals ? `, ${c.sum.goals} career goals` : ''} · threshold ${pct(store.settings.winThreshold)} · ${num(c.sum.expectedWins, 1)} expected wins, ${num(c.sum.expectedLosses, 1)} expected losses${c.sum.longestStreak > 2 ? ` · longest streak ${c.sum.longestStreak}` : ''})</span></h2>
      <div class="agenda">
        ${YEARS.map((y, yi) => html`<div class="agenda-year"><div class="agenda-year-head">${y}</div><div class="agenda-grid">${Array.from({ length: 24 }, (_, i) => cell(yi * 24 + i, bySlot.get(yi * 24 + i) ?? []))}</div></div>`)}
      </div>
      <div class="small muted gap-top">
        ${overridden ? html`<button class="small" data-action="reset-races" @click=${() => update((s) => { s.run.raceOverrides = {}; })}>Clear manual picks</button> ` : nothing}
        Career goal races are fixed and highlighted in gold. Each G1 is scheduled once (a win only has to happen once for affinity) in the year that costs fewer expected losses. Where two G1s share a slot the one more umas can run comfortably wins the tie (B or better on both surface and distance across the ${data.characters.length} Global umas), a stand-in for how common the race is on parents. Win chances follow Shoppo_ura's independent-training data: 110% at A/A (S counts as A) minus a penalty per surface grade (B −10, C −20, D −30, E −50, F −60, G −90) and per distance grade (B −10, C −20, D −30, E −40, F −60, G −90), minus the streak penalty (3rd race in a row −5, 4th −20, 5th −30, 6th and later −50), clamped to 0 to 100%. Stats, skills and mood do not matter. A career goal the run would end on losing is always won; a participation-only goal rolls the odds.
      </div>
    </section>`;
}
