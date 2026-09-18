// PROTOTYPE, throwaway. Three layouts of the result column that fit Suggested deck, Parent goal estimate, Prioritized
// skills and Predicted run on one 1080p screen, switchable with ?variant=A|B|C and the floating bar at the bottom.
// Variant A: dashboard grid, per-panel collapsed details.
// Variant B: two-column split with one "Show details" toggle that swaps to the full stacked panels.
// Variant C: one combined summary card; the four full panels sit under a single collapsed "Full details".
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

export const VARIANTS = ['A', 'B', 'C'] as const;
export type Variant = typeof VARIANTS[number];
const NAMES: Record<Variant, string> = { A: 'Dashboard grid', B: 'Split with details toggle', C: 'Summary card' };
type Section = (name: string, render: () => TemplateResult<1>, deps?: unknown[]) => unknown;

export function layoutVariant(): Variant | null {
  if (!import.meta.env.DEV) return null;
  const v = new URL(location.href).searchParams.get('variant');
  return (VARIANTS as readonly string[]).includes(v ?? '') ? v as Variant : null;
}
function go(v: Variant) {
  const url = new URL(location.href);
  url.searchParams.set('variant', v);
  history.replaceState(history.state, '', url.href);
  refresh();
}
export function installPrototypeKeys() {
  document.addEventListener('keydown', (e) => {
    const v = layoutVariant();
    if (!v || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]')) return;
    const i = VARIANTS.indexOf(v);
    if (e.key === 'ArrowRight') go(VARIANTS[(i + 1) % VARIANTS.length]!);
    if (e.key === 'ArrowLeft') go(VARIANTS[(i + VARIANTS.length - 1) % VARIANTS.length]!);
  });
}
export function prototypeSwitcher(v: Variant) {
  const i = VARIANTS.indexOf(v);
  return html`<div class="proto-bar" role="group" aria-label="Prototype variant">
    <button @click=${() => go(VARIANTS[(i + VARIANTS.length - 1) % VARIANTS.length]!)} aria-label="Previous variant">◀</button>
    <span><b>${v}</b> · ${NAMES[v]}</span>
    <button @click=${() => go(VARIANTS[(i + 1) % VARIANTS.length]!)} aria-label="Next variant">▶</button>
    <a href="?">exit</a>
  </div>`;
}

// ---- compact building blocks shared by the variants ----

/** The six slots with the limitations and the build steps behind one collapsed details. */
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

function estimateHeadline(c: RunPlan, stacked: boolean) {
  const r = c.goalEstimate, p = r.probability, upper = r.upperProbability;
  return html`
    ${p === null ? html`<p class="muted" data-goal-probability>${COPY.estimate.incomplete}</p>` : html`<div class="goal-total" data-goal-probability>${range(p, upper ?? p)}<span class="small muted">${COPY.estimate.headline}</span></div>`}
    ${r.issues.length ? html`<ul class="small" data-goal-issues>${r.issues.map((issue) => html`<li>${issue}</li>`)}</ul>` : nothing}
    ${r.pink.warnings.length ? html`<ul class="small warn" data-goal-warnings>${r.pink.warnings.map((warning) => html`<li>${warning}</li>`)}<li><button class="small" data-action="goal-refine-pink" @click=${openPinkSparks}>${COPY.estimate.editPink}</button></li></ul>` : nothing}
    ${upper === 0 ? html`<p class="warn" data-goal-zero>The modeled outcomes give a zero estimate. Check blue spark thresholds, skill availability, and pink eligibility below.</p>` : nothing}
    ${p !== null ? html`<div class="${stacked ? 'goal-attempts-stacked' : ''}">${attempts(p, upper)}</div>` : nothing}`;
}
/** Everything the estimate panel shows beyond the chance and the attempts. */
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
function compactEstimate(c: RunPlan, opts: { stacked?: boolean } = {}) {
  return panel({ title: COPY.estimate.title, kind: 'result' }, html`<div data-goal-result>${estimateHeadline(c, !!opts.stacked)}${estimateDetails(c)}</div>`);
}

function skillList(c: RunPlan, cls = '') {
  return c.wl.length
    ? html`<ol class="wishlist ${cls}" @dragstart=${drag.dragstart} @dragover=${drag.dragover} @drop=${drag.drop} @dragend=${drag.dragend}>${repeat(c.wl, (w) => w.key, (w, i) => row(c, w, i, false))}</ol>`
    : html`<div class="muted small">${COPY.priorities.empty}</div>`;
}
/** Where each skill comes from, the chips to add or restore, and the choice conflicts. */
function skillDetails(c: RunPlan) {
  return html`<details class="proto-details"><summary>Sources, other candidates and choice conflicts</summary>
    ${c.wl.length ? html`<ol class="small proto-sources">${c.wl.map((w) => html`<li><b>${w.name}</b> <span class="muted">${w.reason}</span></li>`)}</ol>` : nothing}
    ${c.wlRest.length || c.wlExcluded.length ? html`<div class="small muted wl-extra">
      ${c.wlRest.length ? html`<span>${COPY.priorities.notListed}</span> ${c.wlRest.map((w) => html`<span class="chip small">${w.name} <button data-action="wl-add" data-id="${w.key}" aria-label="Add ${w.name} to the list" @click=${() => addSkill(w.key)}>+</button></span>`)}` : nothing}
      ${c.wlExcluded.length ? html`<span>${COPY.priorities.removed}</span> ${c.wlExcluded.map((w) => html`<span class="chip small">${w.name} <button data-action="wl-restore" data-id="${w.key}" aria-label="Put ${w.name} back" @click=${() => restoreSkill(w.key)}>+</button></span>`)}` : nothing}
    </div>` : nothing}
    ${conflicts(c)}
  </details>`;
}
function compactPriorities(c: RunPlan, opts: { columns?: boolean } = {}) {
  const customized = store.run.wishlistOrder.length > 0 || store.run.wishlistExcluded.length > 0;
  const actions = customized ? html`<button class="small" data-action="wl-reset" @click=${resetList}>${COPY.priorities.reset}</button>` : nothing;
  return panel({ title: COPY.priorities.title, kind: 'result', subtitle: `up to ${PRIORITIZED_SKILLS_MAX}`, tip: COPY.priorities.tip, actions }, html`
    ${c.priorityIssues.map((note) => html`<p class="small warn" data-priority-conflict>${note}</p>`)}
    ${skillList(c, opts.columns ? 'wishlist-columns' : '')}
    ${skillDetails(c)}`);
}

function outcomeBox(c: RunPlan) {
  return html`<div class="stat outcome">
    <div class="outcome-item"><div class="stat-k">SS or better${tip(COPY.prediction.ssTip)}</div><div class="stat-v">${pill(c.rank.pSS, '', true)}</div></div>
    <div class="outcome-item"><div class="stat-k">Rank score</div><div class="stat-v">${num(c.rank.score)} <span class="sd">±${num(c.rank.sd)}</span></div></div>
    <div class="outcome-item"><div class="stat-k">Estimated SP</div><div class="stat-v">${num(c.pred.sp)}</div></div>
  </div>`;
}
function statBoxes(c: RunPlan) {
  return STATS.map((s, i) => html`
    <div class="stat"><div class="stat-k">${s}</div><div class="stat-v">${num(c.finalMean[i]!)} <span class="sd">±${num(c.finalSd[i]!)}</span></div>
      <div class="stat-s"><span class="band">≥${BLUE_STAR_BANDS.mid} ${pill(c.statChances[i]!.mid, '', true)}</span> <span class="band">≥${BLUE_STAR_BANDS.high} ${pill(c.statChances[i]!.high, '', true)}</span></div></div>`);
}
function compactPrediction(c: RunPlan, opts: { rows?: boolean } = {}) {
  const subtitle = `${c.sum.count} calendar + ${c.ctx.races - c.sum.count} finale races · ${capitalize(store.settings.focus)} focus${c.trainee ? ` · ${c.trainee.name}` : ''}`;
  return panel({ title: COPY.prediction.title, kind: 'result', subtitle, tip: COPY.prediction.tip }, html`
    <div class="stats ${opts.rows ? 'stats-rows' : ''}">${outcomeBox(c)}${statBoxes(c)}</div>
    <details class="proto-details"><summary>${COPY.prediction.breakdown}</summary>${statBreakdown(c)}</details>`);
}

const searchError = () => searchState.error
  ? panel({ title: 'Deck search', kind: 'result' }, html`<p role="alert">${COPY.app.searchFailed}</p><button data-action="retry-search" @click=${retrySearch}>${COPY.app.retrySearch}</button>`)
  : nothing;
/** The result panels that are not part of the one-screen set, in their usual order. */
const rest = (c: RunPlan, section: Section) => html`
  ${c.issues.length ? nothing : html`${section('schedule', () => renderSchedule(c))}${section('coverage', () => renderCoverage(c))}`}
  ${section('ranking', () => renderRanking(c))}`;

// ---- Variant A: dashboard grid. Deck across the top, then estimate | skills | run side by side. ----
function variantA(c: RunPlan, section: Section) {
  const ok = !c.issues.length;
  return html`
    ${section('deck', () => compactDeck(c), [searchState.pending, 'A'])}
    ${searchError()}
    <div class="proto-grid-3">
      ${section('estimate', () => compactEstimate(c, { stacked: true }), ['A'])}
      ${ok ? section('priorities', () => compactPriorities(c), ['A']) : nothing}
      ${ok ? section('prediction', () => compactPrediction(c, { rows: true }), ['A']) : nothing}
    </div>
    ${rest(c, section)}`;
}

// ---- Variant B: two columns, one toggle that swaps to the full stacked panels. ----
let showDetails = false;
function variantB(c: RunPlan, section: Section) {
  const ok = !c.issues.length;
  const toggle = html`<div class="proto-toolbar"><span class="small muted">${showDetails ? 'Full panels with every detail.' : 'Compact view for a one-screen screenshot.'}</span>
    <button class="small ${showDetails ? 'active' : ''}" data-action="proto-details" @click=${() => { showDetails = !showDetails; refresh(); }}>${showDetails ? 'Hide details' : 'Show details'}</button></div>`;
  if (showDetails) return html`${toggle}
    ${section('deck', () => renderDeck(c), [searchState.pending, 'B-full'])}
    ${searchError()}
    ${section('estimate', () => renderGoalResult(c), ['B-full'])}
    ${ok ? html`${section('priorities', () => renderPriorities(c), ['B-full'])}${section('prediction', () => renderPrediction(c), ['B-full'])}` : nothing}
    ${rest(c, section)}`;
  return html`${toggle}
    <div class="proto-split">
      <div class="proto-col">
        ${section('deck', () => compactDeck(c, { small: true }), [searchState.pending, 'B'])}
        ${searchError()}
        ${ok ? section('priorities', () => compactPriorities(c), ['B']) : nothing}
      </div>
      <div class="proto-col">
        ${section('estimate', () => compactEstimate(c, { stacked: true }), ['B'])}
        ${ok ? section('prediction', () => compactPrediction(c, { rows: true }), ['B']) : nothing}
      </div>
    </div>
    ${rest(c, section)}`;
}

// ---- Variant C: one summary card built for the screenshot; the four full panels under a single details. ----
function summaryCard(c: RunPlan) {
  const d = c.deckResult, ok = !c.issues.length;
  const ordered = [...d.deck.filter((x) => !x.borrowed), ...d.deck.filter((x) => x.borrowed)];
  const subtitle = c.trainee ? `${c.trainee.name} · ${c.sum.count} calendar + ${c.ctx.races - c.sum.count} finale races · ${capitalize(store.settings.focus)} focus` : '';
  return panel({ title: 'Run summary', kind: 'result', subtitle, cls: 'proto-summary' }, html`
    ${searchState.pending ? html`<p class="status small muted" data-plan-pending role="status" aria-live="polite">${COPY.app.searching}</p>` : nothing}
    ${d.deck.length ? html`<div class="deck deck-compact">${repeat(ordered, (cs) => `${cs.card.id}:${cs.borrowed ? 'b' : 'o'}`, (cs) => slot(c, cs))}</div>` : html`<div class="muted">${COPY.deck.noCards}</div>`}
    ${c.issues.length ? html`<div role="alert" data-plan-issues>${c.issues.map((issue) => html`<p class="warn">${issue}</p>`)}</div>` : nothing}
    <div class="proto-band">
      <div class="proto-band-goal"><h3>${COPY.estimate.title}</h3><div data-goal-result>${estimateHeadline(c, false)}</div></div>
      ${ok ? html`<div class="proto-band-run"><h3>${COPY.prediction.title}${tip(COPY.prediction.tip)}</h3><div class="stats">${outcomeBox(c)}${statBoxes(c)}</div></div>` : nothing}
    </div>
    ${ok ? html`<div class="proto-band-skills"><h3>${COPY.priorities.title} <span class="sub-note">enter in this order</span>${tip(COPY.priorities.tip)}</h3>
      ${c.priorityIssues.map((note) => html`<p class="small warn" data-priority-conflict>${note}</p>`)}
      ${skillList(c, 'wishlist-columns')}</div>` : nothing}`);
}
function variantC(c: RunPlan, section: Section) {
  const ok = !c.issues.length;
  return html`
    ${section('summary', () => summaryCard(c), [searchState.pending, 'C'])}
    ${searchError()}
    <details class="proto-full" data-full-details><summary>Full details: deck, estimate, prioritized skills and predicted run</summary>
      ${section('deck-full', () => renderDeck(c), [searchState.pending, 'C'])}
      ${section('estimate-full', () => renderGoalResult(c), ['C'])}
      ${ok ? html`${section('priorities-full', () => renderPriorities(c), ['C'])}${section('prediction-full', () => renderPrediction(c), ['C'])}` : nothing}
    </details>
    ${rest(c, section)}`;
}

export function renderPrototypeResults(c: RunPlan, section: Section, v: Variant) {
  return v === 'A' ? variantA(c, section) : v === 'B' ? variantB(c, section) : variantC(c, section);
}
