import { html, render } from 'lit-html';
import catalogJson from '../../data/missions.json' with { type: 'json' };
import type { MissionCatalog } from '../model/missions.ts';
import { onRender, renderNow, store, update } from './context.ts';
import { TITLE } from './copy.ts';
import { applyTheme, followTheme, themeToggle } from './theme.ts';
import { installTooltips } from './tooltip.ts';
import { installSuggestDismiss } from './fields.ts';
import { renderMissions } from './panels/missions.ts';
import { storageNotice } from './storage-notice.ts';

const root = document.getElementById('app')!;
const catalog = catalogJson as MissionCatalog;
function draw() {
  applyTheme(store.ui.theme);
  render(html`<header>
    <h1>${TITLE.missions}</h1>
    <span class="meta">Find the races for limited missions, choose a trainee and track what you have finished.</span>
    <span class="header-actions">
      <a class="button" href="./" data-page="planner">Uma parent deck</a>
      ${themeToggle(store.ui.theme, (theme) => update((state) => { state.ui.theme = theme; }))}
    </span>
  </header>
  ${storageNotice()}
  ${renderMissions(catalog, Date.now())}
  <div class="footer">Mission data checked ${new Date(catalog.fetchedAt).toLocaleDateString()}.
    <a href="https://gametora.com/umamusume/missions" target="_blank" rel="noopener">Missions on GameTora</a>
  </div>`, root);
}
onRender(draw);
followTheme(() => store.ui.theme);
installTooltips(root);
installSuggestDismiss(root);
renderNow();
// Re-evaluate event windows when a page remains open through a mission deadline.
setInterval(renderNow, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderNow(); });
