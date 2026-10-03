// The standalone scanner page: a header with the theme control around one scanner session that ends in a download.
import { html, render } from 'lit-html';
import { cards } from 'virtual:scanner-catalog';
import type { Theme } from '../state.ts';
import { SCANNER_COPY as C } from '../ui/copy.ts';
import { followTheme, themeToggle } from '../ui/theme.ts';
import { createScanner } from './session.ts';
import '../style.css';

const root = document.getElementById('scanner')!;
/** Relative, so the standalone build links to a planner served beside it. */
const PLANNER = './index.html';
let theme: Theme = 'system';

const scanner = createScanner({ cards, onChange: paint, plannerUrl: PLANNER });
function paint() {
  render(html`<header class="scan-header">
      <div><a class="scan-planner-link" href=${PLANNER}>${C.planner}</a><h1>${C.title}</h1><p>${C.subtitle}</p></div>
      ${themeToggle(theme, picked => { theme = picked; paint(); })}
    </header>
    <main class="scan-main">${scanner.render()}</main>`, root);
}
followTheme(() => theme);
paint();
