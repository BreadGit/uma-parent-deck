// Inventory import/export and the advanced settings: every rate the model needs that the game does not publish.
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { ADVANCED_SETTING_GROUPS, DEFAULT_SETTINGS, MAIN_PAGE_SETTINGS, SETTING_HELP, type SettingField, type Settings } from '../../settings.ts';
import { exportInventory, importInventory } from '../../inventory.ts';
import { data, store, update, view } from '../context.ts';
import { panel } from '../panel.ts';
import { tip } from '../tooltip.ts';
import { setSetting } from './run.ts';

const help = (key: keyof Settings) => SETTING_HELP[key] ?? '';
/** A blank number field shows the value the model falls back to. */
const placeholder = (key: keyof Settings) => (key === 'totalTurnsOverride' ? data.model.races.totalTurns.toFixed(1) : '');
function field(f: SettingField) {
  const label = html`<span class="k">${f.label}${tip(help(f.key))}</span>`;
  if (f.kind === 'list') return html`<label class="row">${label}<input type="text" .value=${live((store.settings[f.key] as number[]).join(', '))} data-setting-list="${f.key}" class="w-140" @change=${(e: Event) => setSetting(f.key, (e.target as HTMLInputElement).value)} /></label>`;
  return html`<label class="row">${label}<input type="number" step="${f.step ?? 0.01}" .value=${live(String(store.settings[f.key] ?? ''))} data-setting="${f.key}" class="w-90" placeholder="${placeholder(f.key)}" @change=${(e: Event) => setSetting(f.key, (e.target as HTMLInputElement).value)} /></label>`;
}

async function onImport(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try { const inv = await importInventory(file); update((s) => { s.inventory = inv; }); }
  catch (err) { alert(`Import failed: ${err}`); }
  input.value = ''; // so importing the same file again fires change
}
function resetAdvanced() {
  update((s) => { const keep = Object.fromEntries(MAIN_PAGE_SETTINGS.map((k) => [k, s.settings[k]])); s.settings = { ...structuredClone(DEFAULT_SETTINGS), ...keep }; });
}

// The export is the file format of the repo's inventory.json; dropping an export there makes it the default for a
// fresh browser (README, "What it does").
const INVENTORY_TIP = 'Every card counts as owned at LB4 until you change it in the card ranking. Export saves those changes to a file; import loads one.';
const ADVANCED_TIP = 'Rates and scales the model needs that the game does not publish. Hover the ⓘ next to a field for what it does and where its default comes from.';

export function renderSettings() {
  return panel({ title: 'Inventory & settings' }, html`
    <div class="kv kv-center">
      <span class="k">Inventory${tip(INVENTORY_TIP)}</span>
      <button data-action="export" @click=${() => exportInventory(store.inventory, data.cards, store.settings.defaultLb)}>Export</button>
      <label><button data-action="import-click" @click=${() => document.getElementById('import-file')?.click()}>Import</button><input type="file" id="import-file" accept="application/json" class="hidden" @change=${onImport} /></label>
      ${Object.keys(store.inventory).length ? html`<button data-action="reset-inventory" @click=${() => { if (confirm('Forget every card adjustment and count every card as owned at the default limit break?')) update((s) => { s.inventory = {}; }); }}>Reset inventory</button>` : nothing}
    </div>
    <details ?open=${view.showAdvanced} data-details="advanced" @toggle=${(e: Event) => { view.showAdvanced = (e.target as HTMLDetailsElement).open; }}>
      <summary>Advanced settings${tip(ADVANCED_TIP)}</summary>
      ${ADVANCED_SETTING_GROUPS.map((g) => html`<h3>${g.title}</h3><div class="settings-grid">${g.fields.map(field)}</div>`)}
      <button class="small gap-top" data-action="reset-settings" @click=${resetAdvanced}>Reset advanced settings</button>
    </details>`);
}
