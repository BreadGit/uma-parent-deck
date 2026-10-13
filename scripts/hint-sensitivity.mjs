import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { loadData } from '../src/data.ts';
import { importInventory } from '../src/inventory.ts';
import { planRun } from '../src/model/run.ts';
import { DEFAULT_SETTINGS, SETTING_SPEC, isValidSetting } from '../src/settings.ts';
import { decodeShare, shareCode } from '../src/share.ts';
import { errorMessage, isPlainObject } from '../src/types.ts';
import { readJson } from './json-file.ts';
/** @typedef {import('../src/settings.ts').Settings} Settings */
/** @typedef {import('../src/model/run.ts').RunPlan} RunPlan */
/** @typedef {import('../src/model/run.ts').DeckSelection} DeckSelection */

const usage = 'node scripts/hint-sensitivity.mjs --run <share URL or code> --inventory <inventory.json> (--settings <settings.json> | --default-settings) [--multipliers 0.5,1,2]';

try {
  const { values } = parseArgs({ options: {
    run: { type: 'string' }, inventory: { type: 'string' }, settings: { type: 'string' }, 'default-settings': { type: 'boolean' },
    multipliers: { type: 'string', default: '0.5,1,2' }, help: { type: 'boolean' },
  } });
  if (values.help) { console.log(usage); process.exit(0); }
  if (!values.run || !values.inventory) throw new Error(usage);
  if (!!values.settings === !!values['default-settings']) throw new Error('Choose --settings <settings.json> or --default-settings. Share codes do not include advanced settings.');
  const snapshot = values.settings ? await readJson(values.settings) : DEFAULT_SETTINGS;
  if (!isPlainObject(snapshot)) throw new Error('Expected a settings object exported from Advanced settings.');
  // Unlike saved-state migration, a reproducibility check must reject missing or invalid values, not replace them.
  for (const key of /** @type {(keyof Settings)[]} */ (Object.keys(DEFAULT_SETTINGS))) {
    if (!Object.hasOwn(snapshot, key) || !isValidSetting(key, snapshot[key])) throw new Error(`Missing or invalid setting: ${key}. Export settings again from the app.`);
  }
  const unknown = Object.keys(snapshot).filter((key) => !Object.hasOwn(DEFAULT_SETTINGS, key));
  if (unknown.length) throw new Error(`Unknown settings: ${unknown.join(', ')}. Export settings again from the app.`);
  const code = /^https?:\/\//.test(values.run) ? shareCode(values.run) : values.run;
  if (!code) throw new Error('The URL has no run code.');
  const shared = await decodeShare(code);
  // Match importing a shared run into the app: its focus and win threshold override the device's settings.
  const settings = /** @type {Settings} */ ({ ...snapshot, ...shared.settings });
  const multipliers = [...new Set(values.multipliers.split(',').map(Number))];
  if (!multipliers.length || multipliers.some((n) => !Number.isFinite(n) || n <= 0)) throw new Error('Multipliers must be positive finite numbers.');
  const spec = SETTING_SPEC.hintScale, maxScale = spec.kind === 'number' ? spec.max : Infinity;
  if (multipliers.some((n) => n * settings.hintScale > maxScale)) throw new Error(`A resulting hint scale exceeds ${maxScale}.`);
  const inventory = await importInventory(new File([await readFile(values.inventory)], 'inventory.json'));
  const data = loadData();
  const input = { ...shared.run, raceOverrides: shared.run.raceOverrides ?? {} };
  /** @param {RunPlan} p */
  const selectionOf = (p) => p.deckResult.deck.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: !!e.borrowed }));
  /** @param {DeckSelection} selection */
  const key = (selection) => selection.map((e) => `${e.borrowed}:${e.id}:${e.lb}`).sort().join('|');
  const baseline = planRun(input, settings, inventory, data);
  if (!baseline.search) throw new Error('The shared run needs a trainee, blue goal and complete legal deck for a sensitivity search.');
  const baselineSelection = selectionOf(baseline);
  /** @param {RunPlan} p */
  const summary = (p) => ({ earnedSp: p.pred.sp, rank: p.rank.score, displayedGoalChance: p.goalEstimate.probability,
    requiredAvailability: p.goalEstimate.required.map((r) => ({ skill: r.target.name, chance: r.available })) });
  const results = multipliers.map((multiplier) => {
    const hintScale = multiplier * settings.hintScale;
    const scenario = { ...settings, hintScale };
    const selected = multiplier === 1 ? baseline : planRun(input, scenario, inventory, data);
    const fixed = multiplier === 1 ? baseline : planRun(input, scenario, inventory, data, { selection: baselineSelection, search: false });
    return { multiplier, hintScale, sameDeck: key(selectionOf(selected)) === key(baselineSelection),
      fixedBaselineDeck: summary(fixed), recommendedDeck: { ...summary(selected), searchScore: selected.search?.score ?? null,
        cards: selected.deckResult.deck.map((e) => ({ id: e.card.id, name: e.card.name, lb: e.lb, borrowed: !!e.borrowed })) } };
  });
  console.log(JSON.stringify({ note: 'Assumption stress test, not measured confidence bounds. Hint-level discounts are not modeled. Search uses derived priorities; displayed chances use saved extra-skill choices.',
    settingsSource: values.settings ? 'file' : 'defaults', baselineSettings: settings,
    baselineHintScale: settings.hintScale, baselineDeck: baselineSelection, results }, null, 2));
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
