import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { RunPlan } from '../../model/run.ts';
import { buildSchedule, goalRaces, slotOf, type ScheduledRace } from '../../model/races.ts';
import { racePopularityMap } from '../../model/run.ts';
import { data, plan, store, update, view } from '../context.ts';
import { LABEL, TITLE } from '../copy.ts';
import { isOpen, options, selectValue } from '../form.ts';
import { int, num, pct, pill } from '../format.ts';
import { about, panel } from '../panel.ts';
import { tip } from '../tooltip.ts';
import { agendaGrid, slotLabel } from '../agenda.ts';

const AGENDA_RESET = 'Reset';

const SCHEDULING_METHOD = [
  'Career goal races are fixed. Every other G1 the trainee can win at or above the threshold is scheduled once, in the year that costs fewer expected losses. When two G1s share a slot, the one more umas can run comfortably wins the tie, a stand-in for how common the race is on parents.',
  "Win chances follow Shoppo_ura's independent-training data: 110% at A/A minus a penalty per surface grade (B −10, C −20, D −30, E −50, F −60, G −90) and per distance grade (B −10, C −20, D −30, E −40, F −60, G −90), minus the streak penalty for consecutive races (3rd in a row −5, 4th −20, 5th −30, 6th and later −50), clamped to 0 to 100%.",
  'Stats, skills and mood do not matter. A career goal the run would end on losing is always won; a participation-only goal rolls the odds.',
];

const CATEGORY_SHORT: Record<string, string> = { sprint: 'spr', mile: 'mile', medium: 'med', long: 'long' };

/**
 * Pick a race for a slot (or none). A pick equal to what the automatic rule would choose clears the slot's
 * overrides; anything else forces the chosen race in and the slot's other races out.
 */
function pickSlot(slot: number, calendarId: string) {
  const inSlot = data.races.filter((r) => !r.unreleasedEn && slotOf(r) === slot);
  update((s) => {
    const auto = new Map(Object.entries(s.run.raceOverrides));
    for (const r of inSlot) auto.delete(r.calendarId);
    const c = plan();
    const autoPick = buildSchedule(data.races, c.apt, s.settings.winThreshold, auto, racePopularityMap(data), goalRaces(c.trainee)).find((x) => x.slot === slot && x.selected)?.race.calendarId ?? '';
    for (const r of inSlot) delete s.run.raceOverrides[r.calendarId];
    if (calendarId !== autoPick) for (const r of inSlot) s.run.raceOverrides[r.calendarId] = r.calendarId === calendarId;
  });
}

function raceInfo(sel: ScheduledRace) {
  return html`<div class="agenda-race ${sel.race.surface}">${sel.race.name}</div>
    <div class="agenda-meta">${sel.race.surface} ${CATEGORY_SHORT[sel.race.category]} ${sel.race.distance}</div>
    <div class="agenda-meta">win ${pill(pct(sel.base))}${sel.pWin < sel.base ? html`→${pill(pct(sel.pWin), 'warn')}` : nothing}</div>${sel.consecutive > 2 ? html`<div class="agenda-meta"><span class="tag warn" data-tip=${`${sel.consecutive} races in consecutive half-month slots: the streak penalty applies`}>streak ${sel.consecutive}</span></div>` : nothing}`;
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
  const current = sel?.race.calendarId ?? '';
  const items = [{ value: '', label: '— skip —' }, ...entries.map((e) => ({ value: e.race.calendarId, label: `${e.race.name} (${pct(e.base)}${e.selected ? '' : `, ${e.reason.toLowerCase()}`})` }))];
  return html`<div class="agenda-cell ${sel ? 'sel' : 'avail'}">
    <div class="agenda-body">${sel ? raceInfo(sel) : html`<div class="agenda-meta muted agenda-avail">${entries.map((e) => `${e.race.name} ${pct(e.base)}`).join(' · ')}</div>`}</div>
    <div class="agenda-pick"><select data-slot="${slot}" aria-label="${slotLabel(slot)} race" .value=${live(current)} @change=${(e: Event) => pickSlot(slot, selectValue(e))}>${options(items, current)}</select>${manual ? tip(`Picked by hand. ${AGENDA_RESET} returns every slot to the automatic rule.`) : nothing}</div>
    <div class="agenda-label">${slotLabel(slot)}</div>
  </div>`;
}

export function renderSchedule(c: RunPlan) {
  const bySlot = new Map<number, ScheduledRace[]>();
  for (const r of c.schedule) bySlot.set(r.slot, [...(bySlot.get(r.slot) ?? []), r]);
  const overridden = Object.keys(store.run.raceOverrides).length > 0;
  const subtitle = `${c.sum.count} races${c.sum.goals ? `, ${c.sum.goals} career goals` : ''} · ${num(c.sum.expectedWins, 1)} expected wins, ${num(c.sum.expectedLosses, 1)} expected losses · ${int(c.sum.expectedFans)} expected fans${c.sum.longestStreak > 2 ? ` · longest streak ${c.sum.longestStreak}` : ''}`;
  const actions = overridden ? html`<button class="small" data-action="reset-races" data-tip="Return every slot to the automatic rule" @click=${() => update((s) => { s.run.raceOverrides = {}; })}>${AGENDA_RESET}</button>` : nothing;
  return panel({ title: 'G1 agenda', kind: 'result', subtitle, tip: `Career goal races are fixed and shown in gold. Every other G1 the trainee can win at or above the threshold in ${TITLE.run} is scheduled once. Pick a race by hand to override the rule.`, actions }, html`
    <p class="muted" data-fan-estimate>Fans at run completion: ${int(c.fans.calendar)} from the agenda + ${int(c.fans.finale)} from finales + ${int(c.fans.concerts)} from concerts.${tip(`Race rewards include the selected deck's ${c.fans.bonus}% Fan Bonus and estimated non-win placings. Finale rewards assume completion and do not add to the calendar race count or earlier fan checks. Concert rewards use manual JP measurements and the ${LABEL.scenario} settings. Random race reward increases are omitted, so the estimate can remain low.`)}</p>
    <details data-agenda ?open=${view.showAgenda} @toggle=${(e: Event) => { view.showAgenda = isOpen(e); }}>
      <summary>Show the race grid</summary>
      ${agendaGrid((slot) => cell(slot, bySlot.get(slot) ?? []))}
    </details>
    ${about('How races are scheduled', SCHEDULING_METHOD)}`);
}
