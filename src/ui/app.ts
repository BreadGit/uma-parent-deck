// Root template and mount: renders the whole page from the run plan and keeps the theme in sync.
import { guard } from 'lit-html/directives/guard.js';
import { html, nothing, render } from 'lit-html';
import meta from '../../data/meta.json' with { type: 'json' };
import { resetRun, saveState, type Theme } from '../state.ts';
import { data, onRender, plan, retrySearch, searchState, stateRevision, store, update, view } from './context.ts';
import { panel } from './panel.ts';
import { installTooltips } from './tooltip.ts';
import { renderGoalEditor, renderGoalResult } from './panels/goal.ts';
import { renderTrainee } from './panels/trainee.ts';
import { renderLegacy } from './panels/legacy.ts';
import { renderRun } from './panels/run.ts';
import { renderSettings } from './panels/settings.ts';
import { renderDeck } from './panels/deck.ts';
import { renderSchedule } from './panels/schedule.ts';
import { renderRanking } from './panels/ranking.ts';

const THEMES: { id: Theme; label: string }[] = [{ id: 'system', label: 'Auto' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }];
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const dark = store.ui.theme === 'dark' || (store.ui.theme === 'system' && systemDark.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function resetAll() {
  if (!confirm('Clear the deck targets, parent goal, trainee, pinned cards, legacy screen, agenda picks and prioritized order? Your inventory and settings are kept.')) return;
  saveState(resetRun(store, data));
  location.reload();
}

function page() {
  const c = plan();
  return html`
    <header>
      <h1>Uma parent deck</h1>
      <span class="meta">Independent-training deck builder for white-spark farming</span>
      <span class="header-actions">
        <span class="theme-toggle" role="group" aria-label="Theme">${THEMES.map((t) => html`<button class="${store.ui.theme === t.id ? 'active' : ''}" data-theme-pick="${t.id}" @click=${() => { update((s) => { s.ui.theme = t.id; }); applyTheme(); }}>${t.label}</button>`)}</span>
        <button class="danger" data-action="reset-all" title="Start a new run: clears every choice except your inventory and settings" @click=${resetAll}>Reset run</button>
      </span>
    </header>
    <main>
      <div>
        ${guard([c, stateRevision, view.traineeQuery], () => renderTrainee(c))}
        ${guard([c, stateRevision, view.query, view.targetEditorId], () => renderGoalEditor(c))}
        ${guard([c, stateRevision, view.showSparks, view.showPinkSparks], () => renderLegacy(c))}
        ${guard([c, stateRevision, view.cardQuery], () => renderRun(c))}
        ${guard([c, stateRevision, view.showAdvanced], () => renderSettings())}
      </div>
      <div>${searchState.pending ? html`<span class="visually-hidden" data-plan-pending role="status" aria-live="polite">Searching for a better deck…</span>` : nothing}
        ${guard([c, stateRevision, searchState.pending], () => renderDeck(c))}${guard([c, stateRevision], () => renderGoalResult(c))}
        ${searchState.error ? panel({ title: 'Deck search' }, html`<p role="alert">Deck search could not finish. The displayed deck's estimates match your current inputs.</p><button data-action="retry-search" @click=${retrySearch}>Retry search</button>`) : nothing}${guard([c, stateRevision], () => renderSchedule(c))}${guard([c, stateRevision], () => renderRanking(c))}</div>
    </main>
    <div id="tooltip" role="tooltip"></div>
    <div class="footer">Card, skill, character and race data from <a href="https://gametora.com">GameTora</a>, fetched ${String(meta.fetchedAt).slice(0, 10)} (${data.cards.length} Global cards). Stat model fitted on the Loopacord research sheet and cross-checked with fujikiseki.xyz. Game assets belong to Cygames; this is a personal tool.</div>`;
}

export function mount(root: HTMLElement) {
  const draw = () => render(page(), root);
  onRender(draw);
  systemDark.addEventListener('change', applyTheme);
  installTooltips(root);
  applyTheme();
  draw();
}
