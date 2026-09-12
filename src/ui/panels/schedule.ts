// The G1 agenda: three career years of half-month slots and the race picked in each. The grid mirrors the game's
// layout and is collapsed by default; the summary line and fan estimate stay visible.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { RunPlan } from '../../model/run.ts';
import { buildSchedule, goalRaces, slotOf, type ScheduledRace } from '../../model/races.ts';
import { racePopularityMap } from '../../model/run.ts';
import { data, plan, refresh, store, update, view } from '../context.ts';
import { COPY } from '../copy.ts';
import { options, selectValue } from '../fields.ts';
import { int, num, pct } from '../format.ts';
import { about, panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YEARS = ['Junior year', 'Classic year', 'Senior year'];
const CATEGORY_SHORT: Record<string, string> = { sprint: 'spr', mile: 'mile', medium: 'med', long: 'long' };
const slotLabel = (slot: number) => `${slot % 2 === 0 ? 'Early' : 'Late'} ${MONTHS[Math.floor((slot % 24) / 2)]}`;
/** Race win chances come in 5% steps; the warn pill marks a streak-reduced chance, a real degradation. */
const winPill = (x: number, cls = '') => html`<span class="pill ${cls}">${pct(x)}</span>`;

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
    <div class="agenda-meta">win ${winPill(sel.base)}${sel.pWin < sel.base ? html`→${winPill(sel.pWin, 'warn')}` : nothing}</div>${sel.consecutive > 2 ? html`<div class="agenda-meta"><span class="tag warn" data-tip=${COPY.agenda.streakTip(sel.consecutive)}>streak ${sel.consecutive}</span></div>` : nothing}`;
}

function cell(slot: number, entries: ScheduledRace[]) {
  const sel = entries.find((e) => e.selected);
  if (!entries.length) return html`<div class="agenda-cell empty"><div class="agenda-body"></div><div class="agenda-pick"></div><div class="agenda-label">${slotLabel(slot)}</div></div>`;
  if (sel?.goal) return html`<div class="agenda-cell sel goal">
    <div class="agenda-body">${raceInfo(sel)}</div>
    <div class="agenda-pick"><span class="tag goal">${COPY.agenda.careerGoal}</span></div>
    <div class="agenda-label">${slotLabel(slot)}</div>
  </div>`;
  const manual = entries.some((e) => store.run.raceOverrides[e.race.calendarId] != null);
  const current = sel?.race.calendarId ?? '';
  const items = [{ value: '', label: COPY.agenda.skip }, ...entries.map((e) => ({ value: e.race.calendarId, label: `${e.race.name} (${pct(e.base)}${e.selected ? '' : `, ${e.reason.toLowerCase()}`})` }))];
  return html`<div class="agenda-cell ${sel ? 'sel' : 'avail'}">
    <div class="agenda-body">${sel ? raceInfo(sel) : html`<div class="agenda-meta muted agenda-avail">${entries.map((e) => `${e.race.name} ${pct(e.base)}`).join(' · ')}</div>`}</div>
    <div class="agenda-pick"><select data-slot="${slot}" aria-label="${slotLabel(slot)} race" .value=${live(current)} @change=${(e: Event) => pickSlot(slot, selectValue(e))}>${options(items, current)}</select>${manual ? tip(COPY.agenda.manualTip) : nothing}</div>
    <div class="agenda-label">${slotLabel(slot)}</div>
  </div>`;
}

export function renderSchedule(c: RunPlan) {
  const bySlot = new Map<number, ScheduledRace[]>();
  for (const r of c.schedule) bySlot.set(r.slot, [...(bySlot.get(r.slot) ?? []), r]);
  const overridden = Object.keys(store.run.raceOverrides).length > 0;
  const subtitle = `${c.sum.count} races${c.sum.goals ? `, ${c.sum.goals} career goals` : ''} · ${num(c.sum.expectedWins, 1)} expected wins, ${num(c.sum.expectedLosses, 1)} expected losses · ${int(c.sum.expectedFans)} expected fans${c.sum.longestStreak > 2 ? ` · longest streak ${c.sum.longestStreak}` : ''}`;
  const actions = overridden ? html`<button class="small" data-action="reset-races" data-tip=${COPY.agenda.resetTip} @click=${() => update((s) => { s.run.raceOverrides = {}; })}>${COPY.agenda.reset}</button>` : nothing;
  return panel({ title: COPY.agenda.title, kind: 'result', subtitle, tip: COPY.agenda.tip, actions }, html`
    <p class="muted" data-fan-estimate>Fans at run completion: ${int(c.fans.calendar)} from the agenda + ${int(c.fans.finale)} from finales + ${int(c.fans.concerts)} from concerts.${tip(COPY.agenda.fansTip(c.fans.bonus))}</p>
    <details data-agenda ?open=${view.showAgenda} @toggle=${(e: Event) => { view.showAgenda = (e.target as HTMLDetailsElement).open; refresh(); }}>
      <summary>${COPY.agenda.open}</summary>
      <div class="agenda">
        ${YEARS.map((y, yi) => html`<div class="agenda-year"><div class="agenda-year-head">${y}</div><div class="agenda-grid">${Array.from({ length: 24 }, (_, i) => cell(yi * 24 + i, bySlot.get(yi * 24 + i) ?? []))}</div></div>`)}
      </div>
    </details>
    ${about(COPY.agenda.aboutTitle, COPY.agenda.about)}`);
}
