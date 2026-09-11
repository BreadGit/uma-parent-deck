// Root template and mount: renders the whole page from the run plan and keeps the theme in sync.
import { html, nothing, render } from 'lit-html';
import meta from '../../data/meta.json' with { type: 'json' };
import { resetRun, saveState, type Theme } from '../state.ts';
import { data, onRender, plan, retrySearch, searchState, store, update } from './context.ts';
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
      <div>${renderTrainee(c)}${renderGoalEditor(c)}${renderLegacy(c)}${renderRun(c)}${renderSettings()}</div>
      <div>${searchState.pending && !searchState.refining ? panel({ title: 'Suggested deck' }, html`<div data-plan-pending role="status" aria-live="polite" aria-busy="true"><p>Finding a deck…</p><p class="small muted">Comparing your required goals and preferred sparks. You can keep editing your inputs.</p></div>`)
        : html`${searchState.refining ? html`<p class="small muted" data-plan-refining role="status" aria-live="polite">Looking for a better deck… The recommendation below is fully checked for your current inputs.</p>` : nothing}
          ${searchState.error ? panel({ title: 'Deck search' }, html`<p role="alert">Deck search could not finish. ${c.search ? 'The fully checked recommendation below is still available.' : 'Your inputs are saved.'}</p><button data-action="retry-search" @click=${retrySearch}>Retry search</button>`) : nothing}
          ${!searchState.error || c.search ? html`${renderDeck(c)}${renderGoalResult(c)}` : nothing}`}${renderSchedule(c)}${renderRanking(c)}</div>
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
