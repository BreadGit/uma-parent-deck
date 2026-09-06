// Root template and mount: renders the whole page from the run plan, keeps the theme in sync, and draws the
// parent-slider notches after each render.
import { html, render } from 'lit-html';
import meta from '../../data/meta.json' with { type: 'json' };
import { resetRun, saveState, type Theme } from '../state.ts';
import { MAX_PARENT_STARS } from '../model/rules.ts';
import { data, onRender, plan, store, update } from './context.ts';
import { installTooltips } from './tooltip.ts';
import { renderTargets } from './panels/targets.ts';
import { renderTrainee } from './panels/trainee.ts';
import { renderRun } from './panels/run.ts';
import { renderSettings } from './panels/settings.ts';
import { renderDeck } from './panels/deck.ts';
import { renderSchedule } from './panels/schedule.ts';
import { renderRanking } from './panels/ranking.ts';

const THEMES: Theme[] = ['system', 'light', 'dark'];
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const dark = store.ui.theme === 'dark' || (store.ui.theme === 'system' && systemDark.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function resetAll() {
  if (!confirm('Clear targets, trainee, pinned cards, parent sparks, agenda picks and the prioritized order? Inventory and settings are kept.')) return;
  saveState(resetRun(store, data));
  location.reload();
}

function page() {
  const c = plan();
  return html`
    <header><h1>Uma parent deck</h1><span class="meta">Independent training deck builder for white-spark farming · data ${String(meta.fetchedAt).slice(0, 10)} from GameTora · ${data.cards.length} Global cards</span>
      <span class="theme-toggle">Theme ${THEMES.map((t) => html`<button class="${store.ui.theme === t ? 'active' : ''}" data-theme-pick="${t}" @click=${() => { update((s) => { s.ui.theme = t; }); applyTheme(); }}>${t === 'system' ? 'OS' : t}</button>`)}</span></header>
    <main>
      <div><div class="reset-bar"><button class="danger" data-action="reset-all" @click=${resetAll}>Reset all</button></div>${renderTargets(c)}${renderTrainee(c)}${renderRun(c)}${renderSettings()}</div>
      <div>${renderDeck(c)}${renderSchedule(c)}${renderRanking(c)}</div>
    </main>
    <div id="tooltip" role="tooltip"></div>
    <div class="footer">Card, skill, character and race data from <a href="https://gametora.com">GameTora</a>. Independent training stat model fitted on the Loopacord research sheet and cross-checked with fujikiseki.xyz. Game assets belong to Cygames; this is a personal tool.</div>`;
}

// ----- parent blue spark slider notches: one device pixel per tick, redrawn on resize -----
function drawNotches(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * pixelRatio));
  const height = Math.max(1, Math.round(rect.height * pixelRatio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#aeb6c1';
  for (let tick = 0; tick <= MAX_PARENT_STARS; tick++) ctx.fillRect(Math.round(tick * (width - 1) / MAX_PARENT_STARS), 0, 1, height);
}
const observed = new WeakSet<HTMLCanvasElement>();
const notchObserver = new ResizeObserver((entries) => { for (const e of entries) drawNotches(e.target as HTMLCanvasElement); });
function drawAllNotches(root: HTMLElement) {
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>('.blue-slider-notches')) {
    drawNotches(canvas);
    if (!observed.has(canvas)) { observed.add(canvas); notchObserver.observe(canvas); }
  }
}

export function mount(root: HTMLElement) {
  const draw = () => { render(page(), root); drawAllNotches(root); };
  onRender(draw);
  systemDark.addEventListener('change', applyTheme);
  window.addEventListener('resize', () => drawAllNotches(root));
  installTooltips(root);
  applyTheme();
  draw();
}
