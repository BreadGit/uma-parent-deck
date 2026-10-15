import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { ADVANCED_SETTING_GROUPS, DEFAULT_SETTINGS, MAIN_PAGE_SETTINGS, SETTING_HELP, type SettingField, type Settings } from '../../settings.ts';
import { exportInventory, importInventory } from '../../inventory.ts';
import { downloadText } from '../../download.ts';
import { errorMessage, RARITIES } from '../../types.ts';
import { LIMIT_BREAKS, MAX_LB } from '../../model/rules.ts';
import { data, store, update, view } from '../context.ts';
import { setSetting } from '../actions.ts';
import { LABEL, TITLE } from '../copy.ts';
import { openScanner } from './scanner.ts';
import { confirmDialog, notice } from '../dialog.ts';
import { chosenFiles, clearFiles, inputValue, isOpen, options, selectValue } from '../form.ts';
import { panel } from '../panel.ts';
import { tip } from '../tooltip.ts';

const help = (key: keyof Settings) => SETTING_HELP[key] ?? '';
const settingText = (v: unknown) => Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
/** A blank number field shows the value the model falls back to. */
const placeholder = (key: keyof Settings) => (key === 'totalTurnsOverride' ? data.model.races.totalTurns.toFixed(1) : '');
const overrideLabel = (lb: number | null) => lb === null ? LABEL.useInventory : `Assume all LB${lb}${lb === MAX_LB ? ' (MLB)' : ''}`;

function field(f: SettingField) {
  if (f.kind === 'inventory-overrides') {
    const choices = [{ value: '', label: LABEL.useInventory }, ...LIMIT_BREAKS.map((lb) => ({ value: String(lb), label: overrideLabel(lb) }))];
    return html`<div data-setting-field="inventoryOverrides">
      <p class="small muted">${help('inventoryOverrides')}</p>
      ${RARITIES.map((rarity) => {
        const lb = store.settings.inventoryOverrides[rarity];
        const fallback = DEFAULT_SETTINGS.inventoryOverrides[rarity];
        const value = lb === null ? '' : String(lb);
        return html`<div class="setting ${lb !== fallback ? 'modified' : ''}">
          <label class="row"><span class="row-k">${rarity} cards<span class="setting-default">default ${overrideLabel(fallback)}</span></span>
            <select data-inventory-override=${rarity} .value=${live(value)} @change=${(e: Event) => {
              const selected = selectValue(e);
              update((s) => { s.settings.inventoryOverrides[rarity] = selected === '' ? null : Number(selected); });
            }}>${options(choices, value)}</select>
          </label></div>`;
      })}
    </div>`;
  }
  const value = settingText(store.settings[f.key]), fallback = settingText(DEFAULT_SETTINGS[f.key]);
  const modified = value !== fallback;
  const error = view.settingErrors[f.key];
  const draft = error?.value ?? value;
  const input = f.kind === 'list'
    ? html`<input type="text" .value=${live(draft)} data-setting-list="${f.key}" class="w-140" aria-invalid=${error ? 'true' : nothing} @change=${(e: Event) => setSetting(f.key, inputValue(e))} />`
    : html`<input type="number" step="${f.step ?? 0.01}" .value=${live(draft)} data-setting="${f.key}" class="w-90" placeholder="${placeholder(f.key)}" aria-invalid=${error ? 'true' : nothing} @change=${(e: Event) => setSetting(f.key, inputValue(e))} />`;
  return html`<div class="setting ${modified ? 'modified' : ''}" data-setting-field=${f.key}>
    <label class="row"><span class="row-k">${f.label}${tip(help(f.key))}<span class="setting-default">default ${fallback || placeholder(f.key) || 'blank'}</span></span>${input}</label>
    ${error ? html`<p class="field-error small" role="alert" data-setting-error=${f.key}>${error.message}</p>` : nothing}
  </div>`;
}

async function onImport(e: Event) {
  const [file] = chosenFiles(e);
  clearFiles(e);
  if (!file) return;
  try { const inv = await importInventory(file); update((s) => { s.inventory = inv; }); }
  catch (err) { await notice(`Import failed: ${errorMessage(err)}`); }
}
async function resetInventory() {
  if (await confirmDialog('Forget the imported inventory and every individual card adjustment? Your advanced rarity overrides will still apply.', 'Reset')) update((s) => { s.inventory = {}; });
}
function resetAdvanced() {
  view.settingErrors = {};
  update((s) => { const keep = Object.fromEntries(MAIN_PAGE_SETTINGS.map((k) => [k, s.settings[k]])); s.settings = { ...structuredClone(DEFAULT_SETTINGS), ...keep }; });
}

// An exported file dropped in as the repo's inventory.json becomes the default for a fresh browser.
export function renderInventory() {
  return panel({ title: TITLE.inventory, tip: `Import screenshots or an inventory file, then adjust individual cards in the ranking. R cards are assumed MLB by default; rarity overrides live in ${TITLE.advanced}. Export saves your inventory values.` }, html`
    <button class="primary inventory-scan" data-action="open-scanner" ?disabled=${view.scannerLoading} @click=${() => void openScanner()}>${view.scannerLoading ? 'Loading…' : TITLE.scanner}</button>
    <div class="kv kv-center">
      <button class="small" data-action="export" @click=${() => exportInventory(store.inventory, data.cards)}>Export to file</button>
      <button class="small" data-action="import-click" @click=${() => document.getElementById('import-file')?.click()}>${LABEL.importFile}</button><input type="file" id="import-file" accept="application/json" class="hidden" aria-label="Import inventory file" @change=${onImport} />
      ${Object.keys(store.inventory).length ? html`<button class="small" data-action="reset-inventory" @click=${resetInventory}>Reset</button>` : nothing}
    </div>`);
}

export function renderSettings() {
  return panel({ title: 'Settings' }, html`
    <details ?open=${view.showAdvanced} data-details="advanced" @toggle=${(e: Event) => { view.showAdvanced = isOpen(e); }}>
      <summary>${TITLE.advanced}${tip('Inventory overrides, model rates and scales. Each field shows its default; changed values are marked.')}</summary>
      <button class="small gap-top" data-action="export-settings" @click=${() => downloadText('settings.json', JSON.stringify(store.settings, null, 2) + '\n', 'application/json')}>Export settings</button>
      ${ADVANCED_SETTING_GROUPS.map((g) => html`<h3>${g.title}</h3><div class="settings-grid">${g.fields.map(field)}</div>`)}
      <button class="small gap-top" data-action="reset-settings" @click=${resetAdvanced}>Reset advanced settings</button>
    </details>`);
}
