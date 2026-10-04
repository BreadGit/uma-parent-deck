import { html, render } from 'lit-html';
import catalogJson from '../../data/missions.json' with { type: 'json' };
import type { MissionCatalog } from '../model/missions.ts';
import { onRender, store, update } from './context.ts';
import { COPY } from './copy.ts';
import { applyTheme, followTheme, themeToggle } from './theme.ts';
import { installTooltips } from './tooltip.ts';
import { installSuggestDismiss } from './fields.ts';
import { renderMissions } from './panels/missions.ts';

const root = document.getElementById('app')!;
const catalog = catalogJson as MissionCatalog;
function draw() {
  applyTheme(store.ui.theme);
  render(html`<header>
    <h1>${COPY.missions.title}</h1>
    <span class="meta">${COPY.missions.intro}</span>
    <span class="header-actions">
      <a class="button" href="./" data-page="planner">Uma parent deck</a>
      ${themeToggle(store.ui.theme, (theme) => update((state) => { state.ui.theme = theme; }))}
    </span>
  </header>
  ${renderMissions(catalog, Date.now())}
  <div id="tooltip" role="tooltip"></div>
  <div class="footer">${COPY.missions.checkedAt(new Date(catalog.fetchedAt).toLocaleDateString())}
    <a href="https://gametora.com/umamusume/missions" target="_blank" rel="noopener">${COPY.missions.source}</a>
  </div>`, root);
}
onRender(draw);
followTheme(() => store.ui.theme);
installTooltips(root);
installSuggestDismiss(root);
draw();
// Re-evaluate event windows when a page remains open through a mission deadline.
setInterval(draw, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
