// PROTOTYPE, throwaway. Two independent sets of layout variants, combined through two URL parameters and a floating bar:
//   ?sidebar=1|2|3   how the input column collapses
//     1 Collapsible column: a header button hides the column; the results take the full width.
//     2 Overlay drawer: the results always take the full width; the inputs slide over them from the left.
//     3 Icon rail: the column collapses to a rail of step buttons; a button opens the column at that panel.
//   ?results=1|2|3   how the deck, goal estimate, prioritized skills and predicted run share one screen
//     1 Split: deck, estimate and run stacked on the left, the skill list on the right (the earlier prototype B).
//     2 Deck banner: the deck across the top, then estimate over run on the left and the skill list on the right.
//     3 Report rows: the deck across the top, estimate beside run, then the skill list in two columns.
// Every results variant keeps one "Show details" toggle that swaps to the full stacked panels.
import './prototype-layout.css';
import { html, nothing, type TemplateResult } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import { APTITUDE_LABELS } from '../model/goal-input.ts';
import type { RunPlan } from '../model/run.ts';
import { PRIORITIZED_SKILLS_MAX } from '../model/rules.ts';
import { BLUE_STAR_BANDS } from '../model/stats.ts';
import { STATS } from '../types.ts';
import { openPinkSparks } from './actions.ts';
import { refresh, retrySearch, searchState, store } from './context.ts';
import { COPY } from './copy.ts';
import { capitalize, num, pill, probability } from './format.ts';
import { panel } from './panel.ts';
import { limitations, renderDeck, slot } from './panels/deck.ts';
import { attempts, breakdown, fallback, goalLimits, range, renderGoalResult } from './panels/estimate.ts';
import { addSkill, conflicts, drag, renderPriorities, resetList, restoreSkill, row } from './panels/priorities.ts';
import { renderPrediction, statBreakdown } from './panels/prediction.ts';
import { renderCoverage } from './panels/coverage.ts';
import { renderSchedule } from './panels/schedule.ts';
import { renderRanking } from './panels/ranking.ts';
import { tip } from './tooltip.ts';

const KEYS = ['1', '2', '3'] as const;
type Key = typeof KEYS[number];
export interface Proto { sidebar: Key; results: Key }
const SIDEBAR_NAMES: Record<Key, string> = { 1: 'Collapsible column', 2: 'Overlay drawer', 3: 'Icon rail' };
const RESULTS_NAMES: Record<Key, string> = { 1: 'Split', 2: 'Deck banner', 3: 'Report rows' };
type Section = (name: string, render: () => TemplateResult<1>, deps?: unknown[]) => unknown;

/** Either parameter turns the prototype on; a missing one defaults to 1. */
export function prototypeVariants(): Proto | null {
  if (!import.meta.env.DEV) return null;
  const q = new URL(location.href).searchParams;
  const s = q.get('sidebar'), r = q.get('results');
  if (s === null && r === null) return null;
  const key = (v: string | null): Key => (KEYS as readonly string[]).includes(v ?? '') ? v as Key : '1';
  return { sidebar: key(s), results: key(r) };
}
function go(next: Partial<Proto>) {
  const cur = prototypeVariants() ?? { sidebar: '1', results: '1' };
  const url = new URL(location.href);
  url.searchParams.set('sidebar', next.sidebar ?? cur.sidebar);
  url.searchParams.set('results', next.results ?? cur.results);
  history.replaceState(history.state, '', url.href);
  refresh();
}
const cycle = (k: Key, delta: number): Key => KEYS[(KEYS.indexOf(k) + delta + KEYS.length) % KEYS.length]!;

// Sidebar state is view-only and lives here: open or closed. A rail button opens the column at its panel.
let sidebarOpen = true;
function setSidebar(open: boolean, step: number | null = null) {
  sidebarOpen = open;
  refresh();
  // steps 1 to 4 are numbered panels; 5 is the settings panel at the end of the column
  if (step !== null) requestAnimationFrame(() => (step === 5 ? document.querySelector('.inputs section.panel:last-of-type') : document.querySelector(`h2[data-step="${step}"]`)?.closest('section'))?.scrollIntoView({ block: 'start' }));
}

export function installPrototypeKeys() {
  document.addEventListener('keydown', (e) => {
    const p = prototypeVariants();
    if (!p || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape' && p.sidebar === '2' && sidebarOpen) { setSidebar(false); return; }
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'ArrowRight') go({ results: cycle(p.results, 1) });
    if (e.key === 'ArrowLeft') go({ results: cycle(p.results, -1) });
    if (e.key === ']') go({ sidebar: cycle(p.sidebar, 1) });
    if (e.key === '[') go({ sidebar: cycle(p.sidebar, -1) });
  });
}
export function prototypeSwitcher(p: Proto) {
  return html`<div class="proto-bar" role="group" aria-label="Prototype variants">
    <span class="proto-dim"><button @click=${() => go({ sidebar: cycle(p.sidebar, -1) })} aria-label="Previous sidebar variant">◀</button>
      <span>sidebar <b>${p.sidebar}</b> · ${SIDEBAR_NAMES[p.sidebar]}</span>
      <button @click=${() => go({ sidebar: cycle(p.sidebar, 1) })} aria-label="Next sidebar variant">▶</button></span>
    <span class="proto-dim"><button @click=${() => go({ results: cycle(p.results, -1) })} aria-label="Previous results variant">◀</button>
      <span>results <b>${p.results}</b> · ${RESULTS_NAMES[p.results]}</span>
      <button @click=${() => go({ results: cycle(p.results, 1) })} aria-label="Next results variant">▶</button></span>
    <a href="?">exit</a>
  </div>`;
}

// ---- sidebar variants ----

/** The header button that opens or closes the inputs. The rail has its own controls when closed. */
export function prototypeHeaderActions(p: Proto) {
  // the rail and the open drawer carry their own controls
  if ((p.sidebar === '3' && !sidebarOpen) || (p.sidebar === '2' && sidebarOpen)) return nothing;
  const label = p.sidebar === '2' ? (sidebarOpen ? 'Close inputs' : 'Edit inputs') : (sidebarOpen ? 'Hide inputs' : 'Show inputs');
  return html`<button class="small ${sidebarOpen ? '' : 'primary'}" data-action="proto-sidebar" aria-expanded=${sidebarOpen} @click=${() => setSidebar(!sidebarOpen)}>${label}</button>`;
}
export function prototypeMainClass(p: Proto) {
  return `proto-main proto-sidebar-${p.sidebar} ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`;
}
const STEPS = [{ n: 1, label: 'Trainee' }, { n: 2, label: 'Parent goal' }, { n: 3, label: 'Legacy' }, { n: 4, label: 'Run' }];
function rail(c: RunPlan) {
  return html`<nav class="proto-rail" aria-label="Inputs">
    <button class="proto-rail-open" data-action="proto-sidebar" aria-label="Show inputs" data-tip="Show inputs" @click=${() => setSidebar(true)}>»</button>
    ${STEPS.map((s) => html`<button class="proto-rail-step" data-action="proto-rail" data-step=${s.n} aria-label=${s.label} data-tip=${s.label} @click=${() => setSidebar(true, s.n)}>${s.n}</button>`)}
    <button class="proto-rail-step" data-action="proto-rail" data-step="5" aria-label="Inventory and settings" data-tip="Inventory and settings" @click=${() => setSidebar(true, 5)}>⚙</button>
    ${c.trainee ? html`<img class="proto-rail-trainee" src="/assets/characters/${c.trainee.cardId}.png" alt=${c.trainee.name} data-tip=${c.trainee.name} />` : nothing}
  </nav>`;
}
function sidebar(c: RunPlan, p: Proto, inputs: TemplateResult) {
  if (p.sidebar === '2') return html`
    ${sidebarOpen ? html`<div class="proto-backdrop" data-action="proto-backdrop" @click=${() => setSidebar(false)}></div>` : nothing}
    <div class="inputs proto-drawer" ?inert=${!sidebarOpen} aria-hidden=${!sidebarOpen}>
      <div class="proto-drawer-head"><b>Inputs</b><button class="small" data-action="proto-sidebar" @click=${() => setSidebar(false)}>Close</button></div>
      ${inputs}
    </div>`;
  if (p.sidebar === '3' && !sidebarOpen) return rail(c);
  if (!sidebarOpen) return nothing;
  const collapse = p.sidebar === '3' ? html`<button class="small proto-collapse" data-action="proto-sidebar" aria-label="Collapse inputs" @click=${() => setSidebar(false)}>« Collapse</button>` : nothing;
  return html`<div class="inputs">${collapse}${inputs}</div>`;
}

// ---- compact result panels, shared by the results variants ----

function compactDeck(c: RunPlan, opts: { small?: boolean } = {}) {
  const d = c.deckResult;
  const ordered = [...d.deck.filter((x) => !x.borrowed), ...d.deck.filter((x) => x.borrowed)];
  return panel({ title: COPY.deck.title, kind: 'result', tip: COPY.deck.tip }, html`
    ${searchState.pending ? html`<p class="status small muted" data-plan-pending role="status" aria-live="polite">${COPY.app.searching}</p>` : nothing}
    ${d.deck.length ? html`<div class="deck ${opts.small ? 'deck-compact' : ''}">${repeat(ordered, (cs) => `${cs.card.id}:${cs.borrowed ? 'b' : 'o'}`, (cs) => slot(c, cs))}</div>` : html`<div class="muted">${COPY.deck.noCards}</div>`}
    ${c.issues.length ? html`<div role="alert" data-plan-issues>${c.issues.map((issue) => html`<p class="warn">${issue}</p>`)}</div>` : nothing}
    <details class="proto-details"><summary>Limitations and how the deck was built</summary>
      ${limitations(c)}
      <ol class="small">${d.steps.map((s) => html`<li>${s}</li>`)}</ol>
    </details>`);
}

function estimateHeadline(c: RunPlan) {
  const r = c.goalEstimate, p = r.probability, upper = r.upperProbability;
  return html`
    ${p === null ? html`<p class="muted" data-goal-probability>${COPY.estimate.incomplete}</p>` : html`<div class="goal-total" data-goal-probability>${range(p, upper ?? p)}<span class="small muted">${COPY.estimate.headline}</span></div>`}
    ${r.issues.length ? html`<ul class="small" data-goal-issues>${r.issues.map((issue) => html`<li>${issue}</li>`)}</ul>` : nothing}
    ${r.pink.warnings.length ? html`<ul class="small warn" data-goal-warnings>${r.pink.warnings.map((warning) => html`<li>${warning}</li>`)}<li><button class="small" data-action="goal-refine-pink" @click=${openPinkSparks}>${COPY.estimate.editPink}</button></li></ul>` : nothing}
    ${upper === 0 ? html`<p class="warn" data-goal-zero>The modeled outcomes give a zero estimate. Check blue spark thresholds, skill availability, and pink eligibility below.</p>` : nothing}
    ${p !== null ? attempts(p, upper) : nothing}`;
}
function estimateDetails(c: RunPlan) {
  const r = c.goalEstimate, limits = goalLimits(c), selected = c.search?.score;
  return html`<details class="proto-details"><summary>What limits it, per-spark breakdown and assumptions</summary>
    ${limits.length ? html`<ul class="small" data-goal-limits>${limits.map((limit) => html`<li>${limit}</li>`)}</ul>` : nothing}
    ${fallback(c)}
    ${selected && r.preferred.length ? html`<p class="small" data-goal-preferred>Preferred score: ${selected.preferred.toFixed(2)} ${selected.count ? 'on parents meeting ' + (selected.count === selected.total ? 'every requirement' : 'the remaining goal') : 'per final spark roll'}.</p>` : nothing}
    ${breakdown(c)}
    ${r.preferred.length ? html`<p class="small"><b>${COPY.estimate.preferred}:</b> ${r.preferred.map((w) => `${w.target.name} ${probability(w.probability)}`).join(' · ')}. ${COPY.estimate.preferredNote}</p>` : nothing}
    <p class="small"><b>${COPY.estimate.assumptions}</b></p>
    <ul class="small">${r.notes.map((note) => html`<li>${note}</li>`)}</ul>
    <p class="small muted">${COPY.estimate.assumptionsNote}</p>
    <ul class="small">${r.pink.eligibility.filter((e) => e.probability === null || (e.probability > 0 && e.probability < 1)).map((e) => html`<li>${APTITUDE_LABELS[e.aptitude]} eligible at the end: ${e.probability === null ? '0% to 100%' : probability(e.probability)}</li>`)}</ul>
  </details>`;
}
const compactEstimate = (c: RunPlan) => panel({ title: COPY.estimate.title, kind: 'result' }, html`<div data-goal-result>${estimateHeadline(c)}${estimateDetails(c)}</div>`);

function skillList(c: RunPlan, cls = '') {
  return c.wl.length
    ? html`<ol class="wishlist ${cls}" @dragstart=${drag.dragstart} @dragover=${drag.dragover} @drop=${drag.drop} @dragend=${drag.dragend}>${repeat(c.wl, (w) => w.key, (w, i) => row(c, w, i, false))}</ol>`
    : html`<div class="muted small">${COPY.priorities.empty}</div>`;
}
/** The candidates outside the top ten and the removed ones, each with a button that brings it into the list. */
function skillExtras(c: RunPlan) {
  if (!c.wlRest.length && !c.wlExcluded.length) return nothing;
  return html`<div class="small muted wl-extra">
    ${c.wlRest.length ? html`<span>${COPY.priorities.notListed}</span> ${c.wlRest.map((w) => html`<span class="chip small">${w.name} <button data-action="wl-add" data-id="${w.key}" aria-label="Add ${w.name} to the list" @click=${() => addSkill(w.key)}>+</button></span>`)}` : nothing}
    ${c.wlExcluded.length ? html`<span>${COPY.priorities.removed}</span> ${c.wlExcluded.map((w) => html`<span class="chip small">${w.name} <button data-action="wl-restore" data-id="${w.key}" aria-label="Put ${w.name} back" @click=${() => restoreSkill(w.key)}>+</button></span>`)}` : nothing}
  </div>`;
}
function skillDetails(c: RunPlan) {
  return html`<details class="proto-details"><summary>Sources and choice conflicts</summary>
    ${c.wl.length ? html`<ol class="small proto-sources">${c.wl.map((w) => html`<li><b>${w.name}</b> <span class="muted">${w.reason}</span></li>`)}</ol>` : nothing}
    ${conflicts(c)}
  </details>`;
}
function compactPriorities(c: RunPlan, opts: { columns?: boolean } = {}) {
  const customized = store.run.wishlistOrder.length > 0 || store.run.wishlistExcluded.length > 0;
  const actions = customized ? html`<button class="small" data-action="wl-reset" @click=${resetList}>${COPY.priorities.reset}</button>` : nothing;
  return panel({ title: COPY.priorities.title, kind: 'result', subtitle: `up to ${PRIORITIZED_SKILLS_MAX}`, tip: COPY.priorities.tip, actions }, html`
    ${c.priorityIssues.map((note) => html`<p class="small warn" data-priority-conflict>${note}</p>`)}
    ${skillList(c, opts.columns ? 'wishlist-columns' : '')}
    ${skillExtras(c)}
    ${skillDetails(c)}`);
}

function compactPrediction(c: RunPlan) {
  const subtitle = `${c.sum.count} calendar + ${c.ctx.races - c.sum.count} finale races · ${capitalize(store.settings.focus)} focus${c.trainee ? ` · ${c.trainee.name}` : ''}`;
  return panel({ title: COPY.prediction.title, kind: 'result', subtitle, tip: COPY.prediction.tip }, html`
    <div class="stats">
      <div class="stat outcome">
        <div class="outcome-item"><div class="stat-k">SS or better${tip(COPY.prediction.ssTip)}</div><div class="stat-v">${pill(c.rank.pSS, '', true)}</div></div>
        <div class="outcome-item"><div class="stat-k">Rank score</div><div class="stat-v">${num(c.rank.score)} <span class="sd">±${num(c.rank.sd)}</span></div></div>
        <div class="outcome-item"><div class="stat-k">Estimated SP</div><div class="stat-v">${num(c.pred.sp)}</div></div>
      </div>
      ${STATS.map((s, i) => html`
      <div class="stat"><div class="stat-k">${s}</div><div class="stat-v">${num(c.finalMean[i]!)} <span class="sd">±${num(c.finalSd[i]!)}</span></div>
        <div class="stat-s"><span class="band">≥${BLUE_STAR_BANDS.mid} ${pill(c.statChances[i]!.mid, '', true)}</span> <span class="band">≥${BLUE_STAR_BANDS.high} ${pill(c.statChances[i]!.high, '', true)}</span></div></div>`)}
    </div>
    <details class="proto-details"><summary>${COPY.prediction.breakdown}</summary>${statBreakdown(c)}</details>`);
}

const searchError = () => searchState.error
  ? panel({ title: 'Deck search', kind: 'result' }, html`<p role="alert">${COPY.app.searchFailed}</p><button data-action="retry-search" @click=${retrySearch}>${COPY.app.retrySearch}</button>`)
  : nothing;
/** The result panels outside the one-screen set, in their usual order. */
const rest = (c: RunPlan, section: Section) => html`
  ${c.issues.length ? nothing : html`${section('schedule', () => renderSchedule(c))}${section('coverage', () => renderCoverage(c))}`}
  ${section('ranking', () => renderRanking(c))}`;

// ---- results variants ----

let showDetails = false;
function results(c: RunPlan, section: Section, p: Proto) {
  const ok = !c.issues.length, r = p.results;
  const toggle = html`<div class="proto-toolbar"><span class="small muted">${showDetails ? 'Full panels with every detail.' : 'Compact view for a one-screen screenshot.'}</span>
    <button class="small ${showDetails ? 'active' : ''}" data-action="proto-details" @click=${() => { showDetails = !showDetails; refresh(); }}>${showDetails ? 'Hide details' : 'Show details'}</button></div>`;
  if (showDetails) return html`${toggle}
    ${section('deck', () => renderDeck(c), [searchState.pending, 'full'])}
    ${searchError()}
    ${section('estimate', () => renderGoalResult(c), ['full'])}
    ${ok ? html`${section('priorities', () => renderPriorities(c), ['full'])}${section('prediction', () => renderPrediction(c), ['full'])}` : nothing}
    ${rest(c, section)}`;
  const deck = (small: boolean) => html`${section('deck', () => compactDeck(c, { small }), [searchState.pending, r])}${searchError()}`;
  const estimate = section('estimate', () => compactEstimate(c), [r]);
  const skills = ok ? section('priorities', () => compactPriorities(c, { columns: r === '3' }), [r]) : nothing;
  const prediction = ok ? section('prediction', () => compactPrediction(c), [r]) : nothing;
  if (r === '1') return html`${toggle}
    <div class="proto-split"><div class="proto-col">${deck(true)}${estimate}${prediction}</div><div class="proto-col">${skills}</div></div>
    ${rest(c, section)}`;
  if (r === '2') return html`${toggle}
    ${deck(false)}
    <div class="proto-split"><div class="proto-col">${estimate}${prediction}</div><div class="proto-col">${skills}</div></div>
    ${rest(c, section)}`;
  return html`${toggle}
    ${deck(false)}
    <div class="proto-pair">${estimate}${prediction}</div>
    ${skills}
    ${rest(c, section)}`;
}

/** The whole <main> content: the sidebar in its variant and the results in theirs. */
export function renderPrototypeMain(c: RunPlan, section: Section, p: Proto, inputs: TemplateResult) {
  const ready = !!c.trainee;
  return html`${sidebar(c, p, inputs)}
    <div class="results ${ready ? '' : 'waiting'}">
      ${ready ? nothing : html`<p class="banner" data-waiting>${COPY.app.waiting}</p>`}
      ${results(c, section, p)}
    </div>`;
}
