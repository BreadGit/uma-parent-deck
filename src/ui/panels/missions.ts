import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import type { Character } from '../../types.ts';
import { distanceCategory, goalRaces, slotOf } from '../../model/races.ts';
import { eventStatus, hasRaceAptitude, missionAgenda, missionRaceFit, parsePastedMissions, recommendMissionTrainees, selectedMissionEvents,
  type Mission, type MissionAgendaEntry, type MissionCatalog, type MissionEvent, type MissionRaceFit } from '../../model/missions.ts';
import { data, refresh, store, update, view } from '../context.ts';
import { agendaGrid, slotLabel } from '../agenda.ts';
import { COPY } from '../copy.ts';
import { inputValue, isChecked, options, searchBox, selectValue } from '../fields.ts';
import { about, panel } from '../panel.ts';

const copy = COPY.missions;
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
  const choices = [{ value: '', label: copy.chooseEvent }, ...catalog.events.filter((event) => !selected.includes(event)).map((event) => ({ value: String(event.id), label: `${eventStatus(event, now)} · ${event.name}` }))];
  const setEvent = (id: number, checked: boolean) => update((state) => {
    state.missions.eventIds = toggle(state.missions.eventIds ?? selected.map((event) => event.id), id, checked);
  });
  return panel({ title: copy.events }, html`
    <label class="mission-check"><input type="checkbox" data-mission-follow .checked=${live(store.missions.eventIds === null)}
      @change=${(event: Event) => update((state) => { state.missions.eventIds = isChecked(event) ? null : selected.map((item) => item.id); })}>${copy.follow}</label>
    ${!active.length ? html`<p class="small muted">${copy.noCurrent}</p>` : nothing}
    ${repeat(visible, (event) => event.id, (event) => html`<label class="mission-event">
      <input type="checkbox" data-mission-event=${event.id} .checked=${live(selected.includes(event))} @change=${(e: Event) => setEvent(event.id, isChecked(e))}>
      <span><strong>${event.name}</strong><span class="mission-date">${eventStatus(event, now)} · ${date(event.start)} – ${date(event.end)}</span></span>
    </label>`)}
    <label class="goal-field gap-top">${copy.addEvent}<select class="wide" data-mission-event-picker .value=${live(view.missionEventPick)}
      @change=${(event: Event) => { const id = Number(selectValue(event)); view.missionEventPick = ''; if (id) setEvent(id, true); }}>${options(choices, view.missionEventPick)}</select></label>
    <p class="small muted">${copy.dates}</p>
    <details class="about"><summary>${copy.pasteTitle}</summary>
      <p class="small">${copy.pasteHelp}</p>
      <label class="goal-field">${copy.pasteLabel}<textarea data-mission-paste rows="7" placeholder=${copy.pastePlaceholder} .value=${live(view.missionPaste)}
        @input=${(event: Event) => { view.missionPaste = inputValue(event); view.missionImportNotice = ''; refresh(); }}></textarea></label>
      <button class="small gap-top" data-action="import-missions" ?disabled=${!view.missionPaste.trim()} @click=${() => {
        const lines = parsePastedMissions(view.missionPaste, catalog.races).map((mission) => mission.text);
        const added = lines.filter((line) => !store.missions.pastedLines.includes(line));
        view.missionImportNotice = copy.imported(added.length);
        view.missionPaste = '';
        update((state) => { state.missions.pastedLines.push(...added); });
      }}>${copy.import}</button>
      <p class="small" role="status">${view.missionImportNotice}</p>
    </details>
    <details class="about"><summary>${copy.manual}</summary>
      <input type="search" class="wide gap-top" data-mission-race-search aria-label=${copy.manual} placeholder=${copy.raceSearch} .value=${live(view.missionRaceQuery)}
        @input=${(event: Event) => { view.missionRaceQuery = inputValue(event); refresh(); }}>
      ${manualMatches(catalog)}
    </details>`);
}

function manualMatches(catalog: MissionCatalog) {
  const query = view.missionRaceQuery.trim().toLowerCase();
  if (!query) return nothing;
  const matches = [...new Map(catalog.races.map((race) => [race.raceId, race])).values()]
    .filter((race) => !store.missions.customRaceIds.includes(race.raceId) && race.name.toLowerCase().includes(query)).slice(0, 12);
  return html`<div class="mission-race-search">${matches.length ? matches.map((race) => html`<button class="small" data-add-mission-race=${race.raceId}
    @click=${() => { view.missionRaceQuery = ''; update((state) => { state.missions.customRaceIds.push(race.raceId); }); }}>${race.name} · ${race.grade}</button>`) : html`<p class="small muted">${copy.noRaces}</p>`}</div>`;
}

function traineePicker(recommendations: MissionRaceFit[], chosen: MissionRaceFit | null, now: number) {
  const words = view.missionTraineeQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = words.length ? data.characters.filter((trainee) => Date.parse(trainee.releaseEn) <= now && words.every((word) => `${trainee.name} ${trainee.title}`.toLowerCase().includes(word)))
    .sort((a, b) => a.name.localeCompare(b.name) || a.cardId - b.cardId).slice(0, 12) : [];
  const trainee = chosen?.trainee;
  return panel({ title: copy.trainee }, html`
    ${trainee ? html`<div class="trainee-card">
      <img class="thumb thumb-lg" src="/assets/characters/${trainee.cardId}.png" alt="">
      <div class="trainee-id"><span class="trainee-k">${trainee.title}</span><span class="trainee-v">${trainee.name}</span></div>
      <button class="small" data-action="clear-mission-trainee" @click=${() => pickTrainee(null)}>${copy.remove}</button>
    </div><p class="small" data-mission-fit>${copy.fit(chosen.schedule.size, chosen.total)} · ${copy.overlap(chosen.goalMatches)}</p>
      ${chosen.total && !chosen.schedule.size ? html`<p class="small warn">${copy.noFit}</p>` : nothing}` : html`<p class="small muted">${copy.noTrainee}</p>`}
    ${searchBox<Character>({ id: 'mission-trainee-search', field: 'missionTraineeQuery', placeholder: copy.traineePlaceholder, items: matches,
      key: (item) => item.cardId, action: 'pick-mission-trainee', pick: (item) => pickTrainee(item.cardId),
      row: (item) => html`${item.name}<span class="suggest-r">${item.title}</span>` })}
    ${recommendations[0]?.total ? html`<h3>${copy.recommendations}</h3><div class="mission-recommendations">
      ${recommendations.slice(0, 5).map((fit) => html`<button class="mission-recommendation ${fit.trainee.cardId === trainee?.cardId ? 'active' : ''}"
        data-mission-recommend=${fit.trainee.cardId} aria-pressed=${fit.trainee.cardId === trainee?.cardId} @click=${() => pickTrainee(fit.trainee.cardId)}>
        <strong>${fit.trainee.name}</strong><span class="small">${fit.trainee.title}</span>
        <span class="small">${copy.fit(fit.schedule.size, fit.total)} · ${copy.overlap(fit.goalMatches)}</span>
      </button>`)}
    </div>` : nothing}
    ${about(copy.rankingTitle, [copy.recommendationHelp])}
    <a class="button small gap-top" href="#mission-agenda">${copy.jump}</a>`);
}

function checklistItem(mission: Mission, catalog: MissionCatalog, now: number, pasted = false) {
  const matched = mission.raceInstanceIds.some((id) => catalog.races.some((race) => race.raceInstanceId === id));
  return html`<div class="mission-check-row">
    <label class="mission-check ${store.missions.completedMissionIds.includes(mission.id) ? 'mission-done' : ''}">
      <input type="checkbox" data-mission-complete=${mission.id} .checked=${live(store.missions.completedMissionIds.includes(mission.id))}
        @change=${(event: Event) => completeMission(mission.id, isChecked(event))}>
      <span>${mission.text}${!matched && (mission.raceInstanceIds.length || (pasted && /\b(win|place|run in|participate in|enter)\b/i.test(mission.text))) ? html`<span class="mission-date">${copy.noSlot}</span>` : nothing}
        ${now < mission.start || now > mission.end ? html`<span class="mission-date">${now < mission.start ? 'Upcoming' : 'Ended'}</span>` : nothing}</span>
    </label>
    ${pasted ? html`<button class="small" data-remove-pasted-mission=${mission.id} aria-label="${copy.remove}: ${mission.text}"
      @click=${() => update((state) => { state.missions.pastedLines = state.missions.pastedLines.filter((line) => line !== mission.text); })}>×</button>` : nothing}
  </div>`;
}

function checklist(events: MissionEvent[], pasted: Mission[], catalog: MissionCatalog, now: number) {
  const missions = [...events.flatMap((event) => event.missions), ...pasted];
  const extra = store.missions.customRaceIds;
  const done = missions.filter((mission) => store.missions.completedMissionIds.includes(mission.id)).length + extra.filter((id) => store.missions.completedCustomRaceIds.includes(id)).length;
  return panel({ title: copy.checklist, subtitle: copy.progress(done, missions.length + extra.length) }, html`
    <p class="small muted">${copy.checklistHelp}</p>
    ${!missions.length && !extra.length ? html`<p class="muted">${copy.waiting}</p>` : nothing}
    ${repeat(events, (event) => event.id, (event) => html`<h3>${event.name}</h3>${repeat(event.missions, (mission) => mission.id, (mission) => checklistItem(mission, catalog, now))}`)}
    ${pasted.length ? html`<h3>${copy.custom}</h3>${repeat(pasted, (mission) => mission.id, (mission) => checklistItem(mission, catalog, now, true))}` : nothing}
    ${extra.length ? html`<h3>${copy.addedRaces}</h3>${repeat(extra, (id) => id, (id) => html`<div class="mission-check-row">
      <label class="mission-check"><input type="checkbox" data-custom-race-complete=${id} .checked=${live(store.missions.completedCustomRaceIds.includes(id))}
        @change=${(event: Event) => update((state) => { state.missions.completedCustomRaceIds = toggle(state.missions.completedCustomRaceIds, id, isChecked(event)); })}>
        ${catalog.races.find((race) => race.raceId === id)?.name ?? `#${id}`}</label>
      <button class="small" data-remove-mission-race=${id} aria-label="${copy.remove}: ${catalog.races.find((race) => race.raceId === id)?.name ?? id}"
        @click=${() => update((state) => { state.missions.customRaceIds = state.missions.customRaceIds.filter((raceId) => raceId !== id); })}>×</button>
    </div>`)}` : nothing}`);
}

function missionGrid(bySlot: Map<number, MissionAgendaEntry[]>, chosen: MissionRaceFit | null) {
  const goals = new Map(goalRaces(chosen?.trainee ?? null).map((goal) => [slotOf(goal), goal]));
  return panel({ title: copy.grid, kind: 'result' }, html`
    <p class="small muted">${copy.gridHelp}</p>
    <div class="mission-legend small"><span class="tag">${copy.remaining}</span><span class="tag goal">${copy.goal}</span><span class="tag ok">${copy.complete}</span><span class="tag warn">${copy.conflict}</span></div>
    ${!bySlot.size ? html`<p class="banner">${copy.emptyGrid}</p>` : nothing}
    <div class="mission-agenda">${agendaGrid((slot) => {
      const entries = bySlot.get(slot) ?? [];
      const goal = goals.get(slot);
      const conflict = new Set(entries.filter((entry) => !entry.complete).map((entry) => entry.race.raceId)).size > 1;
      return html`<div class="agenda-cell ${entries.length || goal ? '' : 'empty'} ${goal ? 'goal' : ''}" data-mission-slot=${slot}>
        <div class="agenda-body">
          ${goal && !entries.some((entry) => entry.race.raceId === goal.raceId) ? html`<div class="mission-goal"><span class="tag goal">${copy.goal}</span><div class="agenda-race">${goal.name}</div></div>` : nothing}
          ${conflict ? html`<span class="tag warn" data-tip=${copy.conflictHelp}>${copy.conflict}</span>` : nothing}
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
              ${goal?.raceId === race.raceId ? html`<span class="tag goal">${copy.goal}</span>` : nothing}
              ${suggested ? html`<span class="tag">${copy.suggested}</span>` : nothing}
              ${entry.complete ? html`<span class="tag ok">${copy.complete}</span>` : nothing}
              ${blocked ? html`<span class="tag warn" data-mission-goal-conflict data-tip=${copy.goalConflict(goal.name)}>${copy.goalConflictShort}</span>` : nothing}
              ${poor ? html`<span class="tag warn" data-tip=${copy.aptitude(chosen.trainee.aptitudes[race.surface], chosen.trainee.aptitudes[distanceCategory(race.distance)])}>${copy.lowAptitude}</span>` : nothing}
              ${repeat(quick, (mission) => mission.id, (mission) => html`<label class="mission-quick-check" data-tip=${mission.text}>
                <input type="checkbox" data-mission-complete=${mission.id} aria-label=${mission.text} .checked=${live(store.missions.completedMissionIds.includes(mission.id))}
                  @change=${(event: Event) => completeMission(mission.id, isChecked(event))}>${copy.complete}
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
