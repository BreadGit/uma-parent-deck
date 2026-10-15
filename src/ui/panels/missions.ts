import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import type { Character } from '../../types.ts';
import { distanceCategory, goalRaces, slotOf } from '../../model/races.ts';
import { eventStatus, hasRaceAptitude, missionAgenda, missionRaceFit, parsePastedMissions, recommendMissionTrainees, selectedMissionEvents,
  type Mission, type MissionAgendaEntry, type MissionCatalog, type MissionEvent, type MissionRaceFit } from '../../model/missions.ts';
import { data, store, update, view } from '../context.ts';
import { agendaGrid, slotLabel } from '../agenda.ts';
import { inputValue, isChecked, matchesWords, options, queryWords, selectValue } from '../form.ts';
import { searchBox, SUGGESTION_LIMIT } from '../fields.ts';
import { charImg } from '../format.ts';
import { about, panel } from '../panel.ts';

const SUGGESTED_TRAINEES = 5;

const RANKING_METHOD = 'Ranked by how many different remaining mission races fit in one career, then by overlap with career goals. Uses base surface and distance grades B or better and the standard career goals; inheritance, win chances, fan requirements and other mission conditions are not evaluated.';
const fitSummary = (fit: MissionRaceFit) => `${fit.schedule.size} / ${fit.total} remaining races fit · ${fit.goalMatches} also career goals`;
const date = (time: number) => new Date(time).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const toggle = <T,>(items: T[], value: T, checked: boolean) => checked ? [...new Set([...items, value])] : items.filter((item) => item !== value);
function pickTrainee(id: number | null) {
  view.missionTraineeQuery = '';
  update((state) => { state.missions.traineeCardId = id; });
}
function completeMission(id: string, checked: boolean) {
  update((state) => { state.missions.completedMissionIds = toggle(state.missions.completedMissionIds, id, checked); });
}

function eventPicker(catalog: MissionCatalog, selected: MissionEvent[], now: number) {
  const active = catalog.events.filter((event) => eventStatus(event, now) === 'Active');
  const visible = [...new Map([...active, ...selected].map((event) => [event.id, event])).values()];
  const choices = [{ value: '', label: 'Choose an upcoming or past set…' }, ...catalog.events.filter((event) => !selected.includes(event)).map((event) => ({ value: String(event.id), label: `${eventStatus(event, now)} · ${event.name}` }))];
  const setEvent = (id: number, checked: boolean) => update((state) => {
    state.missions.eventIds = toggle(state.missions.eventIds ?? selectedMissionEvents(catalog.events, state.missions, now).map((event) => event.id), id, checked);
  });
  return panel({ title: 'Mission sets' }, html`
    <label class="mission-check"><input type="checkbox" data-mission-follow .checked=${live(store.missions.eventIds === null)}
      @change=${(event: Event) => update((state) => {
        state.missions.eventIds = isChecked(event) ? null
          : state.missions.eventIds ?? selectedMissionEvents(catalog.events, state.missions, now).map((item) => item.id);
      })}>Follow current events</label>
    ${!active.length ? html`<p class="small muted">No active race mission sets are in the available data. Choose another set or paste missions below.</p>` : nothing}
    ${repeat(visible, (event) => event.id, (event) => html`<label class="mission-event">
      <input type="checkbox" data-mission-event=${event.id} .checked=${live(selected.includes(event))} @change=${(e: Event) => setEvent(event.id, isChecked(e))}>
      <span><strong>${event.name}</strong><span class="mission-date">${eventStatus(event, now)} · ${date(event.start)} – ${date(event.end)}</span></span>
    </label>`)}
    <label class="goal-field gap-top">Add another mission set<select class="wide" data-mission-event-picker .value=${live(view.missionEventPick)}
      @change=${(event: Event) => { const id = Number(selectValue(event)); view.missionEventPick = ''; if (id) setEvent(id, true); }}>${options(choices, view.missionEventPick)}</select></label>
    <p class="small muted">Dates are shown in your local time. Upcoming dates may change.</p>
    <details class="about"><summary>Paste missions from GameTora</summary>
      <p class="small">Copy the mission list, including rewards if you like. Recognized race names appear on the grid; other requirements stay in the checklist.</p>
      <label class="goal-field">Mission text<textarea data-mission-paste rows="7" placeholder="Mile Ch.: Win the Fuji Stakes in Career" .value=${live(view.missionPaste)}
        @input=${(event: Event) => { view.missionPaste = inputValue(event); view.missionImportNotice = ''; }}></textarea></label>
      <button class="small gap-top" data-action="import-missions" ?disabled=${!view.missionPaste.trim()} @click=${() => {
        const lines = parsePastedMissions(view.missionPaste, catalog.races).map((mission) => mission.text);
        view.missionPaste = '';
        update((state) => {
          const added = lines.filter((line) => !state.missions.pastedLines.includes(line));
          view.missionImportNotice = `${added.length} new requirements added.`;
          state.missions.pastedLines.push(...added);
        });
      }}>Add pasted missions</button>
      <p class="small" role="status">${view.missionImportNotice}</p>
    </details>
    <details class="about"><summary>Add a race</summary>
      <input type="search" class="wide gap-top" data-mission-race-search aria-label="Add a race" placeholder="Search race names…" .value=${live(view.missionRaceQuery)}
        @input=${(event: Event) => { view.missionRaceQuery = inputValue(event); }}>
      ${manualMatches(catalog)}
    </details>`);
}

function manualMatches(catalog: MissionCatalog) {
  const words = queryWords(view.missionRaceQuery);
  if (!words.length) return nothing;
  const matches = [...new Map(catalog.races.map((race) => [race.raceId, race])).values()]
    .filter((race) => !store.missions.customRaceIds.includes(race.raceId) && matchesWords(words, race.name)).slice(0, SUGGESTION_LIMIT);
  return html`<div class="mission-race-search">${matches.length ? matches.map((race) => html`<button class="small" data-add-mission-race=${race.raceId}
    @click=${() => { view.missionRaceQuery = ''; update((state) => { state.missions.customRaceIds = toggle(state.missions.customRaceIds, race.raceId, true); }); }}>${race.name} · ${race.grade}</button>`) : html`<p class="small muted">No matching races.</p>`}</div>`;
}

function traineePicker(recommendations: MissionRaceFit[], chosen: MissionRaceFit | null, now: number) {
  const words = queryWords(view.missionTraineeQuery);
  const matches = words.length ? data.characters.filter((trainee) => Date.parse(trainee.releaseEn) <= now && matchesWords(words, `${trainee.name} ${trainee.title}`))
    .sort((a, b) => a.name.localeCompare(b.name) || a.cardId - b.cardId).slice(0, SUGGESTION_LIMIT) : [];
  const trainee = chosen?.trainee;
  return panel({ title: 'Trainee' }, html`
    ${trainee ? html`<div class="trainee-card">
      <img class="thumb thumb-lg" src=${charImg(trainee)} alt="">
      <div class="trainee-id"><span class="trainee-k">${trainee.title}</span><span class="trainee-v">${trainee.name}</span></div>
      <button class="small" data-action="clear-mission-trainee" @click=${() => pickTrainee(null)}>Remove</button>
    </div><p class="small" data-mission-fit>${fitSummary(chosen)}</p>
      ${chosen.total && !chosen.schedule.size ? html`<p class="small warn">No remaining races fit this trainee at base grades B or better. You can still use the grid to plan with improved aptitudes or another career.</p>` : nothing}` : html`<p class="small muted">Choose a trainee to see career goals, conflicts and a suggested schedule.</p>`}
    ${searchBox<Character>({ id: 'mission-trainee-search', field: 'missionTraineeQuery', label: 'Search trainees', placeholder: 'Search Global trainees…', items: matches,
      key: (item) => item.cardId, action: 'pick-mission-trainee', pick: (item) => pickTrainee(item.cardId),
      row: (item) => html`${item.name}<span class="suggest-r">${item.title}</span>` })}
    ${recommendations[0]?.total ? html`<h3>Suggested trainees</h3><div class="mission-recommendations">
      ${recommendations.slice(0, SUGGESTED_TRAINEES).map((fit) => html`<button class="mission-recommendation ${fit.trainee.cardId === trainee?.cardId ? 'active' : ''}"
        data-mission-recommend=${fit.trainee.cardId} aria-pressed=${fit.trainee.cardId === trainee?.cardId} @click=${() => pickTrainee(fit.trainee.cardId)}>
        <strong>${fit.trainee.name}</strong><span class="small">${fit.trainee.title}</span>
        <span class="small">${fitSummary(fit)}</span>
      </button>`)}
    </div>` : nothing}
    ${about('How trainees are ranked', [RANKING_METHOD])}
    <a class="button small gap-top" href="#mission-agenda">Show agenda</a>`);
}

function checklistItem(mission: Mission, catalog: MissionCatalog, now: number, pasted = false) {
  const matched = mission.raceInstanceIds.some((id) => catalog.races.some((race) => race.raceInstanceId === id));
  return html`<div class="mission-check-row">
    <label class="mission-check ${store.missions.completedMissionIds.includes(mission.id) ? 'mission-done' : ''}">
      <input type="checkbox" data-mission-complete=${mission.id} .checked=${live(store.missions.completedMissionIds.includes(mission.id))}
        @change=${(event: Event) => completeMission(mission.id, isChecked(event))}>
      <span>${mission.text}${!matched && (mission.raceInstanceIds.length || (pasted && /\b(win|place|run in|participate in|enter)\b/i.test(mission.text))) ? html`<span class="mission-date">No fixed race date matched — check the requirement in the game.</span>` : nothing}
        ${now < mission.start || now > mission.end ? html`<span class="mission-date">${now < mission.start ? 'Upcoming' : 'Ended'}</span>` : nothing}</span>
    </label>
    ${pasted ? html`<button class="small" data-remove-pasted-mission=${mission.id} aria-label="Remove: ${mission.text}"
      @click=${() => update((state) => { state.missions.pastedLines = state.missions.pastedLines.filter((line) => line !== mission.text); })}>×</button>` : nothing}
  </div>`;
}

function checklist(events: MissionEvent[], pasted: Mission[], catalog: MissionCatalog, now: number) {
  const missions = [...events.flatMap((event) => event.missions), ...pasted];
  const extra = store.missions.customRaceIds;
  const done = missions.filter((mission) => store.missions.completedMissionIds.includes(mission.id)).length + extra.filter((id) => store.missions.completedCustomRaceIds.includes(id)).length;
  return panel({ title: 'Mission checklist', subtitle: `${done} / ${missions.length + extra.length} requirements checked` }, html`
    <p class="small muted">Check a requirement after completing it in the game. Progress stays saved when you change sets or trainees.</p>
    ${!missions.length && !extra.length ? html`<p class="muted">No requirements selected.</p>` : nothing}
    ${repeat(events, (event) => event.id, (event) => html`<h3>${event.name}</h3>${repeat(event.missions, (mission) => mission.id, (mission) => checklistItem(mission, catalog, now))}`)}
    ${pasted.length ? html`<h3>Pasted missions</h3>${repeat(pasted, (mission) => mission.id, (mission) => checklistItem(mission, catalog, now, true))}` : nothing}
    ${extra.length ? html`<h3>Extra races</h3>${repeat(extra, (id) => id, (id) => html`<div class="mission-check-row">
      <label class="mission-check"><input type="checkbox" data-custom-race-complete=${id} .checked=${live(store.missions.completedCustomRaceIds.includes(id))}
        @change=${(event: Event) => update((state) => { state.missions.completedCustomRaceIds = toggle(state.missions.completedCustomRaceIds, id, isChecked(event)); })}>
        ${catalog.races.find((race) => race.raceId === id)?.name ?? `#${id}`}</label>
      <button class="small" data-remove-mission-race=${id} aria-label="Remove: ${catalog.races.find((race) => race.raceId === id)?.name ?? id}"
        @click=${() => update((state) => { state.missions.customRaceIds = state.missions.customRaceIds.filter((raceId) => raceId !== id); })}>×</button>
    </div>`)}` : nothing}`);
}

function missionGrid(bySlot: Map<number, MissionAgendaEntry[]>, chosen: MissionRaceFit | null) {
  const goals = new Map(goalRaces(chosen?.trainee ?? null).map((goal) => [slotOf(goal), goal]));
  return panel({ title: 'Mission agenda', kind: 'result' }, html`
    <p class="small muted">Every available running is shown. Repeated appearances are alternatives. Only one race can be run per half-month; use another year or career for clashes. Check the full requirement below before marking it done.</p>
    <div class="mission-legend small"><span class="tag">Mission race</span><span class="tag goal">Career goal</span><span class="tag ok">Done</span><span class="tag warn">Same date</span></div>
    ${!bySlot.size ? html`<p class="banner">Select a mission set, paste requirements or add a race to fill the grid.</p>` : nothing}
    <div class="mission-agenda">${agendaGrid((slot) => {
      const entries = bySlot.get(slot) ?? [];
      const goal = goals.get(slot);
      const conflict = new Set(entries.filter((entry) => !entry.complete).map((entry) => entry.race.raceId)).size > 1;
      return html`<div class="agenda-cell ${entries.length || goal ? '' : 'empty'} ${goal ? 'goal' : ''}" data-mission-slot=${slot}>
        <div class="agenda-body">
          ${goal && !entries.some((entry) => entry.race.raceId === goal.raceId) ? html`<div class="mission-goal"><span class="tag goal">Career goal</span><div class="agenda-race">${goal.name}</div></div>` : nothing}
          ${conflict ? html`<span class="tag warn" data-tip="These remaining races share this date. Use different years or careers.">Same date</span>` : nothing}
          ${repeat(entries, (entry) => entry.race.calendarId, (entry) => {
            const { race } = entry;
            const suggested = chosen?.schedule.get(slot)?.raceId === race.raceId;
            const blocked = goal && goal.raceId !== race.raceId;
            const poor = chosen && !hasRaceAptitude(chosen.trainee, race);
            const quick = entry.missions.filter((mission) => mission.raceInstanceIds.length === 1);
            return html`<div class="mission-race ${entry.complete ? 'mission-done' : ''} ${suggested ? 'mission-suggested' : ''}" data-mission-race=${race.calendarId}>
              <div class="agenda-race ${race.surface}">${race.name}</div>
              <div class="mission-race-meta">${race.grade} · ${race.surface} · ${race.distance} m</div>
              <div class="mission-race-meta">${race.fansNeeded.toLocaleString()} fans</div>
              ${goal?.raceId === race.raceId ? html`<span class="tag goal">Career goal</span>` : nothing}
              ${suggested ? html`<span class="tag">Suggested</span>` : nothing}
              ${entry.complete ? html`<span class="tag ok">Done</span>` : nothing}
              ${blocked ? html`<span class="tag warn" data-mission-goal-conflict data-tip=${`Career goal: ${goal.name} occupies this date.`}>Goal conflict</span>` : nothing}
              ${poor ? html`<span class="tag warn" data-tip=${`Base grades: ${chosen.trainee.aptitudes[race.surface]} surface / ${chosen.trainee.aptitudes[distanceCategory(race.distance)]} distance`}>Low base aptitude</span>` : nothing}
              ${repeat(quick, (mission) => mission.id, (mission) => html`<label class="mission-quick-check" data-tip=${mission.text}>
                <input type="checkbox" data-mission-complete=${mission.id} aria-label=${mission.text} .checked=${live(store.missions.completedMissionIds.includes(mission.id))}
                  @change=${(event: Event) => completeMission(mission.id, isChecked(event))}>Done
              </label>`)}
            </div>`;
          })}
        </div><div class="agenda-label">${slotLabel(slot)}</div>
      </div>`;
    })}</div>`);
}

export function renderMissions(catalog: MissionCatalog, now: number) {
  const events = selectedMissionEvents(catalog.events, store.missions, now);
  const pasted = parsePastedMissions(store.missions.pastedLines.join('\n'), catalog.races);
  const bySlot = missionAgenda(catalog.races, [...events.flatMap((event) => event.missions), ...pasted], store.missions);
  const entries = [...bySlot.values()].flat();
  const trainee = data.characters.find((character) => character.cardId === store.missions.traineeCardId);
  const chosen = trainee ? missionRaceFit(trainee, entries) : null;
  const recommendations = recommendMissionTrainees(data.characters, entries, now);
  return html`<main class="missions-page">
    <div class="mission-inputs">${eventPicker(catalog, events, now)}${traineePicker(recommendations, chosen, now)}${checklist(events, pasted, catalog, now)}</div>
    <div class="results" id="mission-agenda">${missionGrid(bySlot, chosen)}</div>
  </main>`;
}
