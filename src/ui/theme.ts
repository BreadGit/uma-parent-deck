// The Auto / Light / Dark control shared by the planner and the scanner. Each page owns where the choice is kept.
import { html } from 'lit-html';
import type { Theme } from '../state.ts';

const THEMES: { id: Theme; label: string }[] = [{ id: 'system', label: 'Auto' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }];
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme === 'dark' || (theme === 'system' && systemDark.matches) ? 'dark' : 'light';
}

/** Apply the current choice now and again whenever the system theme changes. */
export function followTheme(current: () => Theme) {
  systemDark.addEventListener('change', () => applyTheme(current()));
  applyTheme(current());
}

export const themeToggle = (current: Theme, pick: (theme: Theme) => void) => html`<span class="theme-toggle" role="group" aria-label="Theme">
  ${THEMES.map((t) => html`<button class=${current === t.id ? 'active' : ''} data-theme-pick=${t.id} aria-pressed=${current === t.id}
    @click=${() => { pick(t.id); applyTheme(t.id); }}>${t.label}</button>`)}</span>`;
