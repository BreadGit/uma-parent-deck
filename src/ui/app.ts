// Root template and mount: renders the whole page from the run plan and keeps the theme in sync. The left column
// is the input flow in step order and scrolls on its own; it can be hidden so the results take the full width, with a
// one-line run summary keeping the context. The right column is every result, most useful first.
import { html, nothing, render } from 'lit-html';
import meta from '../../data/meta.json' with { type: 'json' };
import { resetRun, saveState, type Theme } from '../state.ts';
import { data, endPanelTracking, onRender, plan, refresh, searchState, stateRevision, store, trackedPanel, update, view } from './context.ts';
import { COPY } from './copy.ts';
import { confirmDialog } from './dialog.ts';
import { installSuggestDismiss } from './fields.ts';
import { panel } from './panel.ts';
import { installTooltips } from './tooltip.ts';
import { installScrollAnchor } from './scroll-anchor.ts';
import { runSummary } from './summary.ts';
import { renderGoalEditor } from './panels/goal.ts';
import { renderGoalResult } from './panels/estimate.ts';
import { renderTrainee } from './panels/trainee.ts';
import { renderLegacy } from './panels/legacy.ts';
import { renderRun } from './panels/run.ts';
import { renderSettings } from './panels/settings.ts';
import { renderDeck } from './panels/deck.ts';
import { renderPriorities } from './panels/priorities.ts';
import { renderPrediction } from './panels/prediction.ts';
import { renderPredictionDetails } from './panels/details.ts';
import { renderSchedule } from './panels/schedule.ts';
import { renderRanking } from './panels/ranking.ts';
import { hasWarnings, renderWarnings } from './panels/warnings.ts';
import { clearSharedUrl } from './share.ts';
import { unavailableRunChoices } from '../model/run.ts';

const THEMES: { id: Theme; label: string }[] = [{ id: 'system', label: 'Auto' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }];
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const dark = store.ui.theme === 'dark' || (store.ui.theme === 'system' && systemDark.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

async function resetAll() {
  if (!await confirmDialog(COPY.app.resetAllConfirm, COPY.app.resetAll)) return;
  saveState(resetRun(store, data));
  clearSharedUrl();
  location.reload();
}

function unavailableChoices() {
  const missing = unavailableRunChoices(store.run, data);
  if (missing.trainee === null && !missing.cards.length && !missing.skills.length) return nothing;
  return html`<div class="banner small" data-unavailable-choices role="status">
    <p>${COPY.share.unavailable}</p>
    ${missing.trainee !== null ? html`<p>${COPY.share.missingTrainee(missing.trainee)}</p>` : nothing}
    ${missing.cards.length ? html`<p>${COPY.share.missingCards(missing.cards)}</p>` : nothing}
    ${missing.skills.length ? html`<p>${COPY.share.missingSkills(missing.skills)}</p>` : nothing}
  </div>`;
}

/** Hide or show the input column and move focus to the button that reverses it, so a keyboard user keeps their place. */
function setInputsHidden(hidden: boolean) {
  update((s) => { s.ui.inputsHidden = hidden; });
  document.querySelector<HTMLElement>(`[data-action="${hidden ? 'show' : 'hide'}-inputs"]`)?.focus();
}

function page() {
  const c = plan();
  const ready = !!c.trainee;
  // the column can only be hidden once there is a run to show; until then the inputs are the page
  const inputsHidden = ready && store.ui.inputsHidden;
  const complete = !c.issues.length;
  const section = (name: string, render: () => ReturnType<typeof panel>, deps: unknown[] = []) => trackedPanel(name, [c, stateRevision, ...deps], render);
  return html`
    <header>
      <h1>Uma parent deck</h1>
      <span class="meta">${COPY.app.tagline}</span>
      <span class="header-actions">
        <span class="theme-toggle" role="group" aria-label="Theme">${THEMES.map((t) => html`<button class="${store.ui.theme === t.id ? 'active' : ''}" data-theme-pick="${t.id}" @click=${() => { update((s) => { s.ui.theme = t.id; }); applyTheme(); }}>${t.label}</button>`)}</span>
        <button class="danger" data-action="reset-all" data-tip=${COPY.app.resetAllTip} @click=${resetAll}>${COPY.app.resetAll}</button>
      </span>
    </header>
    <main class="${inputsHidden ? 'inputs-hidden' : ''}">
      ${inputsHidden ? nothing : html`<div class="inputs" id="inputs" data-inputs>
        ${ready ? html`<div class="inputs-head"><button class="small" data-action="hide-inputs" aria-expanded="true" aria-controls="inputs" data-tip=${COPY.app.hideInputsTip} @click=${() => setInputsHidden(true)}>${COPY.app.hideInputs}</button></div>` : nothing}
        ${unavailableChoices()}
        ${section('trainee', () => renderTrainee(c))}
        ${section('goal', () => renderGoalEditor(c))}
        ${section('legacy', () => renderLegacy(c))}
        ${section('run', () => renderRun(c))}
        ${section('settings', () => renderSettings())}
      </div>`}
      <div class="results ${ready ? '' : 'waiting'}">
        ${inputsHidden ? html`<div class="results-head"><button class="small" data-action="show-inputs" aria-expanded="false" aria-controls="inputs" @click=${() => setInputsHidden(false)}>${COPY.app.showInputs}</button>${runSummary(c)}</div>${unavailableChoices()}` : nothing}
        ${ready ? nothing : html`<p class="banner" data-waiting>${COPY.app.waiting}</p>`}
        ${hasWarnings(c) ? section('warnings', () => renderWarnings(c), [searchState.error]) : nothing}
        ${section('deck', () => renderDeck(c), [searchState.pending])}
        ${complete ? html`<div class="results-split">
          <div class="results-col">
            ${section('estimate', () => renderGoalResult(c))}
            ${section('prediction', () => renderPrediction(c))}
          </div>
          <div class="results-col">${section('priorities', () => renderPriorities(c), [searchState.pending])}</div>
        </div>
        ${section('schedule', () => renderSchedule(c))}` : section('estimate', () => renderGoalResult(c))}
        ${section('details', () => renderPredictionDetails(c))}
        ${section('ranking', () => renderRanking(c))}
      </div>
    </main>
    <div id="tooltip" role="tooltip"></div>
    <div class="footer">Card, skill, character and race data from <a href="https://gametora.com">GameTora</a>, fetched ${String(meta.fetchedAt).slice(0, 10)} (${data.cards.length} Global cards). Stat model fitted on the Loopacord research sheet and cross-checked with fujikiseki.xyz. Game assets belong to Cygames; this is a personal tool.</div>`;
}

/**
 * The skill candidates are clamped by CSS to three lines. Whether that clips anything is only known after layout, so a
 * ResizeObserver reads it whenever the row's box changes (its first layout, a window resize, more or fewer chips) and
 * the panel is drawn again only when the answer changed. The answer is left alone while the row is expanded, so the
 * toggle that opened it stays in place, and focused, when it closes the row again.
 */
function watchCandidates(root: HTMLElement) {
  let watched: Element | null = null;
  const observer = new ResizeObserver(([entry]) => {
    if (!entry || view.showAllCandidates) return;
    const overflow = entry.target.scrollHeight > entry.target.clientHeight + 1;
    if (overflow === view.candidatesOverflow) return;
    view.candidatesOverflow = overflow;
    refresh();
  });
  return () => {
    const el = root.querySelector('[data-candidates]');
    if (el === watched) return;
    if (watched) observer.unobserve(watched);
    watched = el;
    if (el) observer.observe(el);
  };
}

export function mount(root: HTMLElement) {
  const preserveScroll = installScrollAnchor(root);
  const watch = watchCandidates(root);
  const draw = () => { preserveScroll(() => render(page(), root)); endPanelTracking(); watch(); };
  onRender(draw);
  systemDark.addEventListener('change', applyTheme);
  installTooltips(root);
  installSuggestDismiss(root);
  applyTheme();
  draw();
  // lit keeps the same <header> across renders; its height sizes the pinned input column below it
  const header = root.querySelector('header')!;
  new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`)).observe(header);
}
