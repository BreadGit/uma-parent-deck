// Inventory import/export and the advanced settings: every rate the model needs that the game does not publish.
// Each field shows its default, marks a changed value, and explains the accepted range when a value is rejected.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { ADVANCED_SETTING_GROUPS, DEFAULT_SETTINGS, MAIN_PAGE_SETTINGS, SETTING_HELP, type SettingField, type Settings } from '../../settings.ts';
import { exportInventory, importInventory } from '../../inventory.ts';
import { downloadText } from '../../download.ts';
import { data, refresh, store, update, view } from '../context.ts';
import { setSetting } from '../actions.ts';
import { COPY, SCANNER_COPY } from '../copy.ts';
import { openScanner } from './scanner.ts';
import { confirmDialog, notice } from '../dialog.ts';
import { inputValue } from '../fields.ts';
import { panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

const help = (key: keyof Settings) => SETTING_HELP[key] ?? '';
const shown = (v: unknown) => Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
/** A blank number field shows the value the model falls back to. */
const placeholder = (key: keyof Settings) => (key === 'totalTurnsOverride' ? data.model.races.totalTurns.toFixed(1) : '');

function field(f: SettingField) {
  const value = shown(store.settings[f.key]), fallback = shown(DEFAULT_SETTINGS[f.key]);
  const modified = value !== fallback;
  const error = view.settingErrors[f.key];
  const draft = error?.value ?? value;
  const input = f.kind === 'list'
    ? html`<input type="text" .value=${live(draft)} data-setting-list="${f.key}" class="w-140" aria-invalid=${error ? 'true' : nothing} @change=${(e: Event) => setSetting(f.key, inputValue(e))} />`
    : html`<input type="number" step="${f.step ?? 0.01}" .value=${live(draft)} data-setting="${f.key}" class="w-90" placeholder="${placeholder(f.key)}" aria-invalid=${error ? 'true' : nothing} @change=${(e: Event) => setSetting(f.key, inputValue(e))} />`;
  return html`<div class="setting ${modified ? 'modified' : ''}" data-setting-field=${f.key}>
    <label class="row"><span class="row-k">${f.label}${tip(help(f.key))}<span class="setting-default">${COPY.settings.defaultLabel} ${fallback || placeholder(f.key) || 'blank'}</span></span>${input}</label>
    ${error ? html`<p class="field-error small" role="alert" data-setting-error=${f.key}>${error.message}</p>` : nothing}
  </div>`;
}

async function onImport(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try { const inv = await importInventory(file); update((s) => { s.inventory = inv; }); }
  catch (err) { await notice(COPY.settings.importFailed(err instanceof Error ? err.message : String(err))); }
  input.value = ''; // so importing the same file again fires change
}
async function resetInventory() {
  if (await confirmDialog(COPY.settings.resetInventoryConfirm, 'Reset')) update((s) => { s.inventory = {}; });
}
function resetAdvanced() {
  view.settingErrors = {};
  update((s) => { const keep = Object.fromEntries(MAIN_PAGE_SETTINGS.map((k) => [k, s.settings[k]])); s.settings = { ...structuredClone(DEFAULT_SETTINGS), ...keep }; });
}

// The inventory sits above the numbered steps: screenshots are the main way to set it up, and the file buttons keep
// the export format of the repo's inventory.json; dropping an export there makes it the default for a fresh browser
// (README, "What it does").
export function renderInventory() {
  return panel({ title: COPY.settings.inventoryTitle, tip: COPY.settings.inventoryTip }, html`
    <button class="primary inventory-scan" data-action="open-scanner" ?disabled=${view.scannerLoading} @click=${() => void openScanner()}>${view.scannerLoading ? SCANNER_COPY.loadingScanner : COPY.settings.scan}</button>
    <div class="kv kv-center">
      <button class="small" data-action="export" @click=${() => exportInventory(store.inventory, data.cards, store.settings.defaultLb)}>${COPY.settings.export}</button>
      <button class="small" data-action="import-click" @click=${() => document.getElementById('import-file')?.click()}>${COPY.settings.import}</button><input type="file" id="import-file" accept="application/json" class="hidden" aria-label="Import inventory file" @change=${onImport} />
      ${Object.keys(store.inventory).length ? html`<button class="small" data-action="reset-inventory" @click=${resetInventory}>${COPY.settings.reset}</button>` : nothing}
    </div>`);
}

export function renderSettings() {
  return panel({ title: COPY.settings.title }, html`
    <details ?open=${view.showAdvanced} data-details="advanced" @toggle=${(e: Event) => { view.showAdvanced = (e.target as HTMLDetailsElement).open; refresh(); }}>
      <summary>${COPY.settings.advanced}${tip(COPY.settings.advancedTip)}</summary>
      <button class="small gap-top" data-action="export-settings" @click=${() => downloadText('settings.json', JSON.stringify(store.settings, null, 2) + '\n', 'application/json')}>${COPY.settings.exportSettings}</button>
      ${ADVANCED_SETTING_GROUPS.map((g) => html`<h3>${g.title}</h3><div class="settings-grid">${g.fields.map(field)}</div>`)}
      <button class="small gap-top" data-action="reset-settings" @click=${resetAdvanced}>${COPY.settings.resetAdvanced}</button>
    </details>`);
}
