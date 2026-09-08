// Disposable UI comparison. The development-only entry point keeps all edits in memory.
import { html, render, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import { loadData } from '../data.ts';
import { resolveTarget } from '../model/sparks.ts';
import './white-sparks.css';

type Role = 'required' | 'preferred';
type Variant = 'A' | 'B' | 'C';
interface Entry { id: number; role: Role; stars: number; copies: number[]; totals: number[] }
const data = loadData();
const families = [...new Map(data.skills.map((s) => resolveTarget(s.id, data)).filter((t) => t?.white && !t.white.unreleasedEn && !t.white.name.includes('×')).map((t) => [t!.id, t!])).values()].sort((a, b) => a.name.localeCompare(b.name));
const labels: Record<Variant, string> = { A: 'Role on each skill', B: 'Required and preferred groups', C: 'Chips with a shared editor' };
const descriptions: Record<Variant, string> = {
  A: 'One searchable list. Switch each skill between Required and Preferred where it sits.',
  B: 'Required skills stay together at the top. Add skills directly to either group or move them between groups.',
  C: 'Keep the panel compact. Select a chip to edit its role, minimum stars, and lineage below the list.',
};
const newEntry = (id: number, role: Role): Entry => ({ id, role, stars: 2, copies: [0, 0], totals: [0, 0] });
const sample = () => [newEntry(201601, 'required'), newEntry(200352, 'required'), newEntry(200012, 'preferred'), newEntry(201032, 'preferred'), newEntry(201562, 'preferred')].filter((e) => families.some((t) => t.id === e.id));
const name = (id: number) => families.find((t) => t.id === id)!.name;
const icon = (id: number) => `/assets/skills/${families.find((t) => t.id === id)!.white!.iconId}.png`;

export function mount(root: HTMLElement) {
  const requested = new URLSearchParams(location.search).get('variant');
  let variant: Variant = requested === 'B' || requested === 'C' ? requested : 'A';
  let entries = sample(), selected = entries[0]!.id;
  let queries: Record<string, string> = {}, notice = '', dark = false;
  let blue = 'Any stat', blueStars = '2', pink = 'End Closer', pinkStars = '2';
  const required = () => entries.filter((e) => e.role === 'required');
  const preferred = () => entries.filter((e) => e.role === 'preferred');
  const update = (fn: () => void) => { fn(); draw(); };
  const chooseVariant = (v: Variant) => update(() => {
    variant = v; queries = {}; notice = '';
    const url = new URL(location.href); url.searchParams.set('variant', v); history.replaceState(null, '', url);
  });
  function setRole(entry: Entry, role: Role) {
    update(() => {
      if (role === 'required' && entry.role !== role && required().length === 2) { notice = 'Two skills are already required. Change one to Preferred first.'; return; }
      entry.role = role;
      if (role === 'preferred') entry.stars = 2;
      notice = '';
    });
  }
  function add(id: number, role: Role, key: string) {
    update(() => {
      if (entries.some((e) => e.id === id)) return;
      if (role === 'required' && required().length === 2) { notice = 'Two skills are already required. Change one to Preferred first.'; return; }
      entries.push(newEntry(id, role)); selected = id; queries[key] = ''; notice = '';
    });
  }
  const remove = (id: number) => update(() => { entries = entries.filter((e) => e.id !== id); if (selected === id) selected = entries[0]?.id ?? 0; notice = ''; });
  const roleControls = (entry: Entry) => html`<div class="proto-roles" role="group" aria-label="Role for ${name(entry.id)}">
    ${(['required', 'preferred'] as const).map((role) => html`<button data-role=${role} data-id=${entry.id} class=${entry.role === role ? 'active' : ''} aria-pressed=${entry.role === role} @click=${() => setRole(entry, role)}>${role === 'required' ? 'Required' : 'Preferred'}</button>`)}
  </div>`;
  const starControl = (entry: Entry) => entry.role === 'required' ? html`<label class="proto-stars">Minimum
    <select aria-label="Minimum stars for ${name(entry.id)}" data-stars=${entry.id} .value=${live(String(entry.stars))} @change=${(e: Event) => update(() => { entry.stars = Number((e.target as HTMLSelectElement).value); })}>
      ${[1, 2, 3].map((n) => html`<option value=${n} ?selected=${entry.stars === n}>${n}★+</option>`)}
    </select></label>` : html`<span class="small muted">2★+ extra</span>`;
  const lineage = (entry: Entry) => html`<div class="proto-lineage">${[0, 1].map((side) => html`<div><span>P${side + 1}</span>
    <select aria-label="Parent ${side + 1} copies of ${name(entry.id)}" data-copies=${entry.id} data-side=${side} .value=${live(String(entry.copies[side]))} @change=${(e: Event) => update(() => { entry.copies[side] = Number((e.target as HTMLSelectElement).value); entry.totals[side] = entry.copies[side]! * 3; })}>
      ${[0, 1, 2, 3].map((n) => html`<option value=${n} ?selected=${entry.copies[side] === n}>${n} copies</option>`)}
    </select>
    <select aria-label="Parent ${side + 1} total stars of ${name(entry.id)}" data-total=${entry.id} data-side=${side} ?disabled=${!entry.copies[side]} .value=${live(String(entry.totals[side]))} @change=${(e: Event) => update(() => { entry.totals[side] = Number((e.target as HTMLSelectElement).value); })}>
      ${Array.from({ length: entry.copies[side]! * 2 + 1 }, (_, i) => i + entry.copies[side]!).map((n) => html`<option value=${n} ?selected=${entry.totals[side] === n}>${n}★ total</option>`)}
    </select></div>`)}</div>`;
  const lineageDetails = (entry: Entry) => html`<details class="proto-lineage-details"><summary>Lineage · ${entry.copies.reduce((a, b) => a + b, 0)} copies</summary>${lineage(entry)}</details>`;
  const search = (key: string, role: Role) => {
    const query = queries[key] ?? '';
    const matches = query.trim() ? families.filter((t) => !entries.some((e) => e.id === t.id) && `${t.name} ${t.gold?.name ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6) : [];
    return html`<div class="proto-search"><label class="proto-search-label">${variant === 'B' ? `Add ${role} skill` : 'Add a skill'}
      <input class="wide" type="search" data-search=${key} placeholder="Search skill name…" .value=${live(query)} @input=${(e: Event) => update(() => { queries[key] = (e.target as HTMLInputElement).value; })} />
    </label>${query ? html`<div class="proto-matches">${matches.length ? matches.map((t) => html`<button data-add=${t.id} data-add-role=${role} @click=${() => add(t.id, role, key)}><img src=${icon(t.id)} alt="" /><span>${t.name}</span><span class="muted small">+ ${role}</span></button>`) : html`<p class="small muted">No new skills match.</p>`}</div>` : nothing}</div>`;
  };
  const row = (entry: Entry, grouped = false) => html`<div class="proto-skill ${entry.role}" data-entry=${entry.id}>
    <div class="proto-skill-name"><img src=${icon(entry.id)} alt="" /><b>${name(entry.id)}</b><button class="proto-remove" data-remove=${entry.id} aria-label="Remove ${name(entry.id)}" @click=${() => remove(entry.id)}>×</button></div>
    <div class="proto-row-controls">${grouped ? starControl(entry) : roleControls(entry)}${grouped ? html`<button class="small" data-move=${entry.id} @click=${() => setRole(entry, entry.role === 'required' ? 'preferred' : 'required')}>${entry.role === 'required' ? 'Make preferred' : 'Make required'}</button>` : starControl(entry)}</div>
    ${lineageDetails(entry)}
  </div>`;
  function targets() {
    const active = entries.find((e) => e.id === selected);
    return html`<section class="panel proto-target-panel"><div class="panel-head"><h2>Target white sparks</h2><span class="proto-count ${required().length === 2 ? 'complete' : ''}" data-required-count>${required().length}/2 required</span></div>
      <p class="small muted">Your parent needs both required sparks. Preferred sparks are optional extras.</p>
      ${variant === 'A' ? html`${search('all', 'preferred')}<p class="small muted">New skills start as Preferred.</p><div class="proto-list">${repeat(entries, (e) => e.id, (e) => row(e))}</div>` : variant === 'B' ? html`
        <div class="proto-group"><div class="proto-group-head"><b>Required</b><span class="small muted">${required().length} of 2</span></div>
          <div class="proto-list">${repeat(required(), (e) => e.id, (e) => row(e, true))}</div>
          ${required().length < 2 ? search('required', 'required') : html`<p class="small muted">Both requirements selected. Move one to Preferred to replace it.</p>`}
        </div><div class="proto-group"><div class="proto-group-head"><b>Preferred</b><span class="small muted">${preferred().length} extras</span></div>
          ${search('preferred', 'preferred')}<div class="proto-list">${repeat(preferred(), (e) => e.id, (e) => row(e, true))}</div>
        </div>` : html`${search('chips', 'preferred')}
        <div class="proto-chips">${repeat(entries, (e) => e.id, (e) => html`<button class="proto-chip ${e.role} ${selected === e.id ? 'selected' : ''}" data-chip=${e.id} aria-pressed=${selected === e.id} @click=${() => update(() => { selected = e.id; notice = ''; })}><img src=${icon(e.id)} alt="" /><span>${name(e.id)}<small>${e.role === 'required' ? 'Required' : 'Preferred'} · ${e.stars}★+</small></span></button>`)}</div>
        ${active ? html`<div class="proto-chip-editor" data-chip-editor=${active.id}><div class="proto-skill-name"><b>${name(active.id)}</b><button class="proto-remove" data-remove=${active.id} aria-label="Remove ${name(active.id)}" @click=${() => remove(active.id)}>×</button></div><div class="proto-row-controls">${roleControls(active)}${starControl(active)}</div><p class="small muted">White sparks in lineage</p>${lineage(active)}</div>` : html`<p class="muted small">Add a skill to get started.</p>`}
      `}
      ${notice ? html`<p class="proto-notice" role="status">${notice}</p>` : nothing}
      ${required().length < 2 ? html`<p class="small warn" data-incomplete>Choose ${2 - required().length} more required skill${required().length === 0 ? 's' : ''} to complete the white goal.</p>` : nothing}
    </section>`;
  }
  const selectField = (label: string, value: string, options: string[], set: (v: string) => void) => html`<label class="proto-field">${label}<select .value=${live(value)} @change=${(e: Event) => update(() => set((e.target as HTMLSelectElement).value))}>${options.map((v) => html`<option value=${v} ?selected=${value === v}>${v}</option>`)}</select></label>`;
  function draw() {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    render(html`<header><h1>Uma parent deck</h1><span class="meta">White spark interface comparison</span><div class="header-actions"><button data-theme @click=${() => update(() => { dark = !dark; })}>${dark ? 'Light theme' : 'Dark theme'}</button><a href="/">Back to app</a></div></header>
      <div class="proto-toolbar"><div class="proto-toolbar-title"><b>Compare layouts</b><span class="small muted">Interactive sample · changes stay in this preview</span><button class="small" data-reset @click=${() => update(() => { entries = sample(); selected = entries[0]!.id; queries = {}; notice = ''; })}>Reset sample</button></div>
        <nav aria-label="Prototype variants">${(['A', 'B', 'C'] as const).map((v) => html`<button data-variant=${v} class=${variant === v ? 'active' : ''} aria-pressed=${variant === v} @click=${() => chooseVariant(v)}>${v} · ${labels[v]}</button>`)}</nav><p data-variant-description>${descriptions[variant]}</p>
      </div>
      <main class="proto-layout"><div>${targets()}<section class="panel"><div class="panel-head"><h2>Parent goal</h2></div><p class="small muted">White sparks are managed above.</p><div class="proto-goal-fields">
        ${selectField('Blue spark', blue, ['Any stat', 'Speed', 'Stamina', 'Power', 'Guts', 'Wit'], (v) => { blue = v; })}${selectField('Minimum stars', blueStars, ['1', '2', '3'], (v) => { blueStars = v; })}
        ${selectField('Pink spark', pink, ['End Closer', 'Late Surger', 'Pace Chaser', 'Front Runner', 'Turf', 'Dirt', 'Sprint', 'Mile', 'Medium', 'Long'], (v) => { pink = v; })}${selectField('Minimum stars', pinkStars, ['1', '2', '3'], (v) => { pinkStars = v; })}
      </div></section></div>
      <div class="proto-context"><section class="panel"><div class="panel-head"><h2>Goal overview</h2><span class="panel-sub">Updates as you edit</span></div>
        <p>One parent with all of these sparks:</p><ul class="proto-overview" data-overview><li><span class="proto-dot blue"></span>${blue} · ${blueStars}★+ blue</li><li><span class="proto-dot pink"></span>${pink} · ${pinkStars}★+ pink</li>${required().map((e) => html`<li><img src=${icon(e.id)} alt="" />${name(e.id)} · ${e.stars}★+ white</li>`)}</ul>
        ${required().length < 2 ? html`<p class="warn small">White goal incomplete</p>` : html`<p class="ok small">Both required white sparks selected</p>`}
        <div class="proto-overview-preferred"><b>Preferred extras</b><p data-overview-preferred>${preferred().map((e) => name(e.id)).join(' · ') || 'None selected'}</p><span class="small muted">These do not count toward the required goal.</span></div>
      </section><section class="panel proto-explanation"><h2>Try the interaction</h2><ol><li>Change a required skill to Preferred.</li><li>Make another skill Required.</li><li>Change its minimum stars and lineage.</li><li>Search for another skill and add it.</li></ol><p class="small muted">Switching layouts keeps your sample edits, so you can compare the same target list. Reloading resets the sample.</p><p class="small muted">This preview compares the editor only. It does not calculate a new deck or change saved goals.</p></section></div>
      </main>`, root);
  }
  draw();
}
