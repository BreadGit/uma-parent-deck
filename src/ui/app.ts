// Root template and mount: renders the whole page from the run plan and keeps the theme in sync. The left column
// is the input flow in step order; the right column is every result, most useful first.
import { html, nothing, render } from 'lit-html';
import meta from '../../data/meta.json' with { type: 'json' };
import { resetRun, saveState, type Theme } from '../state.ts';
import { data, endPanelTracking, onRender, plan, retrySearch, searchState, stateRevision, store, trackedPanel, update } from './context.ts';
import { COPY } from './copy.ts';
import { confirmDialog } from './dialog.ts';
import { installSuggestDismiss } from './fields.ts';
import { panel } from './panel.ts';
import { installTooltips } from './tooltip.ts';
import { installScrollAnchor } from './scroll-anchor.ts';
import { renderGoalEditor } from './panels/goal.ts';
import { renderGoalResult } from './panels/estimate.ts';
import { renderTrainee } from './panels/trainee.ts';
import { renderLegacy } from './panels/legacy.ts';
import { renderRun } from './panels/run.ts';
import { renderSettings } from './panels/settings.ts';
import { renderDeck } from './panels/deck.ts';
import { renderPriorities } from './panels/priorities.ts';
import { renderPrediction } from './panels/prediction.ts';
import { renderCoverage } from './panels/coverage.ts';
import { renderSchedule } from './panels/schedule.ts';
import { renderRanking } from './panels/ranking.ts';
import { clearSharedUrl } from './share.ts';
import { renderShare } from './panels/share.ts';

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

function page() {
  const c = plan();
  const ready = !!c.trainee;
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
    <main>
      <div class="inputs">
        ${section('share', renderShare)}
        ${section('trainee', () => renderTrainee(c))}
        ${section('goal', () => renderGoalEditor(c))}
        ${section('legacy', () => renderLegacy(c))}
        ${section('run', () => renderRun(c))}
        ${section('settings', () => renderSettings())}
      </div>
      <div class="results ${ready ? '' : 'waiting'}">
        ${ready ? nothing : html`<p class="banner" data-waiting>${COPY.app.waiting}</p>`}
        ${section('deck', () => renderDeck(c), [searchState.pending])}
        ${searchState.error ? panel({ title: 'Deck search', kind: 'result' }, html`<p role="alert">${COPY.app.searchFailed}</p><button data-action="retry-search" @click=${retrySearch}>${COPY.app.retrySearch}</button>`) : nothing}
        ${section('estimate', () => renderGoalResult(c))}
        ${c.issues.length ? nothing : html`
          ${section('priorities', () => renderPriorities(c))}
          ${section('schedule', () => renderSchedule(c))}
          ${section('prediction', () => renderPrediction(c))}
          ${section('coverage', () => renderCoverage(c))}`}
        ${section('ranking', () => renderRanking(c))}
      </div>
    </main>
    <div id="tooltip" role="tooltip"></div>
    <div class="footer">Card, skill, character and race data from <a href="https://gametora.com">GameTora</a>, fetched ${String(meta.fetchedAt).slice(0, 10)} (${data.cards.length} Global cards). Stat model fitted on the Loopacord research sheet and cross-checked with fujikiseki.xyz. Game assets belong to Cygames; this is a personal tool.</div>`;
}

export function mount(root: HTMLElement) {
  const preserveScroll = installScrollAnchor(root);
  const draw = () => { preserveScroll(() => render(page(), root)); endPanelTracking(); };
  onRender(draw);
  systemDark.addEventListener('change', applyTheme);
  installTooltips(root);
  installSuggestDismiss(root);
  applyTheme();
  draw();
}
