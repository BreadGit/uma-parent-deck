// Root template and mount: renders the whole page from the run plan and keeps the theme in sync. The left column
// is the input flow in step order and scrolls on its own; it can be hidden so the results take the full width, with a
// one-line run summary keeping the context. The right column is every result, most useful first.
import { html, nothing, render } from 'lit-html';
import meta from '../../data/meta.json' with { type: 'json' };
import { resetRun } from '../state.ts';
import { data, endPanelTracking, onRender, plan, refresh, stateRevision, store, trackedPanel, update, view } from './context.ts';
import { TITLE } from './copy.ts';
import { confirmDialog } from './dialog.ts';
import { installSuggestDismiss } from './fields.ts';
import { panel } from './panel.ts';
import { installTooltips } from './tooltip.ts';
import { applyTheme, followTheme, themeToggle } from './theme.ts';
import { installScrollAnchor } from './scroll-anchor.ts';
import { runSummary } from './summary.ts';
import { renderGoalEditor } from './panels/goal.ts';
import { renderGoalResult } from './panels/estimate.ts';
import { renderTrainee } from './panels/trainee.ts';
import { renderLegacy } from './panels/legacy.ts';
import { renderRun } from './panels/run.ts';
import { renderInventory, renderSettings } from './panels/settings.ts';
import { renderDeck } from './panels/deck.ts';
import { renderPriorities } from './panels/priorities.ts';
import { renderPrediction } from './panels/prediction.ts';
import { renderPredictionDetails } from './panels/details.ts';
import { renderSchedule } from './panels/schedule.ts';
import { renderRanking } from './panels/ranking.ts';
import { renderScannerOverlay } from './panels/scanner.ts';
import { hasWarnings, renderWarnings } from './panels/warnings.ts';
import { clearSharedUrl } from './share.ts';
import { unavailableRunChoices } from '../model/run.ts';
import { storageNotice } from './storage-notice.ts';

const RESET_ALL = 'Reset all';

async function resetAll() {
  if (!await confirmDialog(`${RESET_ALL}? This clears the trainee, parent goal, targets, legacy screen, pinned and ignored cards, agenda picks, prioritized order, training focus and win threshold. Your inventory and advanced settings are kept.`, RESET_ALL)) return;
  const saved = update((state) => Object.assign(state, resetRun(state, data)));
  clearSharedUrl();
  // A reload reads the save back, so it would restore the old run if the reset was not written.
  if (saved) location.reload();
}

function unavailableChoices() {
  const missing = unavailableRunChoices(store.run, data);
  if (missing.trainee === null && !missing.cards.length && !missing.skills.length) return nothing;
  return html`<div class="banner small" data-unavailable-choices role="status">
    <p>Some saved choices are unavailable in this game data. Their IDs are kept in your save and share code, but excluded from calculations. Estimates cover only the available choices.</p>
    ${missing.trainee !== null ? html`<p>Unavailable trainee: ${missing.trainee}</p>` : nothing}
    ${missing.cards.length ? html`<p>Unavailable pinned cards: ${missing.cards.join(', ')}</p>` : nothing}
    ${missing.skills.length ? html`<p>Unavailable skills: ${missing.skills.join(', ')}</p>` : nothing}
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
  const section = (name: string, render: () => ReturnType<typeof panel>) => trackedPanel(name, [c, stateRevision], render);
  return html`
    <header>
      <h1>Uma parent deck</h1>
      <span class="meta">Independent-training deck builder for white-spark farming</span>
      <span class="header-actions">
        <a class="button" href="./missions.html" data-page="missions">${TITLE.missions}</a>
        ${themeToggle(store.ui.theme, (theme) => update((s) => { s.ui.theme = theme; }))}
        <button class="danger" data-action="reset-all" data-tip="Start over: clears every choice except your inventory and advanced settings" @click=${resetAll}>${RESET_ALL}</button>
      </span>
    </header>
    ${storageNotice()}
    <main class="${inputsHidden ? 'inputs-hidden' : ''}">
      ${inputsHidden ? nothing : html`<div class="inputs" id="inputs" data-inputs>
        ${ready ? html`<div class="inputs-head"><button class="small" data-action="hide-inputs" aria-expanded="true" aria-controls="inputs" data-tip="Give the results the full width. The summary line keeps the run in view." @click=${() => setInputsHidden(true)}>« Hide inputs</button></div>` : nothing}
        ${unavailableChoices()}
        ${section('inventory', () => renderInventory())}
        ${section('trainee', () => renderTrainee(c))}
        ${section('goal', () => renderGoalEditor(c))}
        ${section('legacy', () => renderLegacy(c))}
        ${section('run', () => renderRun(c))}
        ${section('settings', () => renderSettings())}
      </div>`}
      <div class="results ${ready ? '' : 'waiting'}">
        ${inputsHidden ? html`<div class="results-head"><button class="small" data-action="show-inputs" aria-expanded="false" aria-controls="inputs" @click=${() => setInputsHidden(false)}>» Show inputs</button>${runSummary(c)}</div>${unavailableChoices()}` : nothing}
        ${ready ? nothing : html`<p class="banner" data-waiting>Start with step 1: pick the uma you will train. The deck, estimate and agenda fill in from there. Your card inventory can be set in ${TITLE.ranking} at any time.</p>`}
        ${hasWarnings(c) ? section('warnings', () => renderWarnings(c)) : nothing}
        ${section('deck', () => renderDeck(c))}
        ${complete ? html`<div class="results-split">
          <div class="results-col">
            ${section('estimate', () => renderGoalResult(c))}
            ${section('prediction', () => renderPrediction(c))}
          </div>
          <div class="results-col">${section('priorities', () => renderPriorities(c))}</div>
        </div>
        ${section('schedule', () => renderSchedule(c))}` : section('estimate', () => renderGoalResult(c))}
        ${section('details', () => renderPredictionDetails(c))}
        ${section('ranking', () => renderRanking(c))}
      </div>
    </main>
    ${renderScannerOverlay()}
    <div class="footer">Version ${__APP_VERSION__}. Card, skill, character and race data from <a href="https://gametora.com">GameTora</a>, fetched ${String(meta.fetchedAt).slice(0, 10)} (${data.cards.length} Global cards). Stat model fitted on the Loopacord research sheet and cross-checked with fujikiseki.xyz. Game assets belong to Cygames; this is a personal tool.</div>`;
}

/** Recheck chip bounds after layout, including content edits and resizing an expanded list. */
function watchCandidates(root: HTMLElement) {
  let watched: HTMLElement | null = null;
  let frame = 0;
  const measure = () => {
    frame = 0;
    const bottom = watched ? watched.getBoundingClientRect().top + parseFloat(getComputedStyle(watched).getPropertyValue('--wl-candidates-height')) : 0;
    const overflow = !!watched && [...watched.children].some((chip) => chip.getBoundingClientRect().bottom > bottom + 1);
    if (overflow === view.candidatesOverflow && (overflow || !view.showAllCandidates)) return;
    view.candidatesOverflow = overflow;
    if (!overflow) view.showAllCandidates = false;
    refresh();
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
  const observer = new ResizeObserver(schedule);
  return () => {
    const el = root.querySelector<HTMLElement>('[data-candidates]');
    if (el !== watched) {
      if (watched) observer.unobserve(watched);
      watched = el;
      if (el) observer.observe(el);
    }
    schedule();
  };
}

export function mount(root: HTMLElement) {
  const preserveScroll = installScrollAnchor(root);
  const watch = watchCandidates(root);
  const draw = () => { applyTheme(store.ui.theme); preserveScroll(() => render(page(), root)); endPanelTracking(); watch(); };
  onRender(draw);
  followTheme(() => store.ui.theme);
  installTooltips(root);
  installSuggestDismiss(root);
  draw();
  // lit keeps the same <header> across renders; its height sizes the pinned input column below it
  const header = root.querySelector('header')!;
  new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`)).observe(header);
}
