import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { DEFAULT_SETTINGS, MAIN_PAGE_SETTINGS, SETTING_HELP, type Settings } from '../../settings.ts';
import { exportInventory, importInventory } from '../../inventory.ts';
import { data, store, update, view } from '../context.ts';
import { tip } from '../tooltip.ts';
import { setSetting } from './run.ts';

const help = (key: keyof Settings) => SETTING_HELP[key] ?? '';
const numField = (key: keyof Settings, label: string, step = 0.01, placeholder = '') => html`<label class="row"><span class="k">${label}${tip(help(key))}</span>
  <input type="number" step="${step}" .value=${live(String(store.settings[key] ?? ''))} data-setting="${key}" class="w-90" placeholder="${placeholder}" @change=${(e: Event) => setSetting(key, (e.target as HTMLInputElement).value)} /></label>`;
const listField = (key: keyof Settings, label: string) => html`<label class="row"><span class="k">${label}${tip(help(key))}</span>
  <input type="text" .value=${live((store.settings[key] as number[]).join(', '))} data-setting-list="${key}" class="w-140" @change=${(e: Event) => setSetting(key, (e.target as HTMLInputElement).value)} /></label>`;

async function onImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try { const inv = await importInventory(file); update((s) => { s.inventory = inv; }); }
  catch (err) { alert(`Import failed: ${err}`); }
}
function resetAdvanced() {
  update((s) => { const keep = Object.fromEntries(MAIN_PAGE_SETTINGS.map((k) => [k, s.settings[k]])); s.settings = { ...DEFAULT_SETTINGS, ...keep }; });
}

export function renderSettings() {
  return html`
    <section class="panel">
      <h2>Inventory &amp; settings</h2>
      <div class="kv">
        <button data-action="export" @click=${() => exportInventory(store.inventory, data.cards, store.settings.defaultLb)}>Export inventory.json</button>
        <label><button data-action="import-click" @click=${() => document.getElementById('import-file')?.click()}>Import inventory.json</button><input type="file" id="import-file" accept="application/json" class="hidden" @change=${onImport} /></label>
        ${Object.keys(store.inventory).length ? html`<button data-action="reset-inventory" @click=${() => { if (confirm('Clear every card adjustment and go back to the defaults?')) update((s) => { s.inventory = {}; }); }}>Reset all to defaults</button>` : nothing}
        <span class="small muted">Replace the repo's inventory.json with the export to make it the default.</span>
      </div>
      <details ?open=${view.showAdvanced} data-details="advanced" @toggle=${(e: Event) => { view.showAdvanced = (e.target as HTMLDetailsElement).open; }}><summary>Advanced settings</summary>
        <div class="small muted gap-v">These numbers override the tool's estimates. Each one is a rate or scale the model needs but the game does not tell us; the defaults come from community measurements where they exist and from guesses where they do not. Hover the ⓘ next to a field for what it does and why the default is what it is.</div>
        <h3>Rates</h3>
        <div class="grid2 settings-grid">
          ${numField('affinity', 'Legacy affinity (inspiration proc scaling)', 1)}
          ${numField('hintBase', 'Hint chance per card-turn (base)')}
          ${numField('hintScale', 'Hint model scale (independent training)')}
          ${numField('hintTurnsShare', 'Share of turns a card is on a facility')}
          ${listField('chainRatesSSR', 'SSR chain 1/2/3 completion')}
          ${listField('chainRatesSR', 'SR chain 1/2 completion')}
          ${numField('randomEventRate', 'Random event fires')}
          ${numField('palChainRate', 'Pal date chain completes')}
          ${numField('groupOutingRate', 'Group member outing happens')}
          ${numField('groupFinaleRate', 'Group finale happens (unverified)')}
          ${numField('specialEventRate', 'Pal/Group unlock and New Year events')}
          ${numField('scenarioPickRate', 'Scenario linked-skill event fires')}
          ${numField('charStoryEventRate', "Trainee's story and choice events play")}
          ${numField('charOutingRate', "Trainee's outing event happens")}
          ${numField('charConditionFallbackRate', 'Secret-event condition the tool cannot score')}
          ${numField('bigRewardRate', 'Big reward chance (split outcomes)')}
          ${numField('goldSparkRate', 'Spark chance with gold skill')}
          ${numField('whiteSparkRate', 'Spark chance with white skill')}
          ${listField('whiteSparkInheritRates', 'Lineage white spark hint rate (1/2/3★)')}
          ${numField('lineageSparkMultiplier', 'Spark chance multiplier per lineage occurrence')}
          ${listField('ssStarOdds', 'White star odds at SS (1/2/3★)')}
          ${listField('belowSsStarOdds', 'White star odds below SS')}
          ${numField('lossPenalty', 'Stat points lost per expected race loss', 1)}
          ${numField('skillScorePerSp', 'Rank points per SP (skills bought)')}
          ${numField('skillScoreSd', 'Rank score sd from skills', 10)}
          ${numField('innateSkillBuyShare', 'Share of innate skills counted in the rank score')}
          ${numField('totalTurnsOverride', 'Total turns (blank = fitted)', 1, data.model.races.totalTurns.toFixed(1))}
        </div>
        <button class="small" data-action="reset-settings" @click=${resetAdvanced}>Reset advanced settings</button>
        <div class="small muted gap-top">Model fit: ${data.model.fit.n} card-stat observations, RMSE ${data.model.fit.rmse.toFixed(1)}, R² ${data.model.fit.r2.toFixed(3)}. Floor ${data.model.floor} per stat, ${data.model.observed.length} observed card rows.</div>
      </details>
    </section>`;
}
