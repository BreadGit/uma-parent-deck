import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { loadData } from '../src/data.ts';
import { importInventory } from '../src/inventory.ts';
import { planRun } from '../src/model/run.ts';
import { DEFAULT_SETTINGS, SETTING_SPEC } from '../src/settings.ts';
import { decodeShare } from '../src/share.ts';

const usage = 'node scripts/hint-sensitivity.mjs --run <share URL or code> --inventory <inventory.json> [--multipliers 0.5,1,2]';

try {
  const { values } = parseArgs({ options: {
    run: { type: 'string' }, inventory: { type: 'string' }, multipliers: { type: 'string', default: '0.5,1,2' }, help: { type: 'boolean' },
  } });
  if (values.help) { console.log(usage); process.exit(0); }
  if (!values.run || !values.inventory) throw new Error(usage);
  const code = /^https?:\/\//.test(values.run) ? new URL(values.run).searchParams.get('run') : values.run;
  if (!code) throw new Error('The URL has no run code.');
  const shared = await decodeShare(code);
  const settings = { ...DEFAULT_SETTINGS, ...shared.settings };
  const multipliers = [...new Set(values.multipliers.split(',').map(Number))];
  if (!multipliers.length || multipliers.some((n) => !Number.isFinite(n) || n <= 0)) throw new Error('Multipliers must be positive finite numbers.');
  const scales = multipliers.map((n) => n * settings.hintScale);
  if (scales.some((n) => n > SETTING_SPEC.hintScale.max)) throw new Error(`A resulting hint scale exceeds ${SETTING_SPEC.hintScale.max}.`);
  const inventory = await importInventory(new File([await readFile(values.inventory)], 'inventory.json'));
  const data = loadData();
  const input = { ...shared.run, raceOverrides: shared.run.raceOverrides ?? {} };
  const selectionOf = (p) => p.deckResult.deck.map((e) => ({ id: e.card.id, lb: e.lb, borrowed: !!e.borrowed }));
  const key = (selection) => selection.map((e) => `${e.borrowed}:${e.id}:${e.lb}`).sort().join('|');
  const baseline = planRun(input, settings, inventory, data);
  if (!baseline.search) throw new Error('The shared run needs a trainee, blue goal and complete legal deck for a sensitivity search.');
  const baselineSelection = selectionOf(baseline);
  const summary = (p) => ({ earnedSp: p.pred.sp, rank: p.rank.score, displayedGoalChance: p.goalEstimate.probability,
    requiredAvailability: p.goalEstimate.required.map((r) => ({ skill: r.target.name, chance: r.available })) });
  const results = multipliers.map((multiplier, i) => {
    const scenario = { ...settings, hintScale: scales[i] };
    const selected = multiplier === 1 ? baseline : planRun(input, scenario, inventory, data);
    const fixed = multiplier === 1 ? baseline : planRun(input, scenario, inventory, data, { selection: baselineSelection, search: false });
    return { multiplier, hintScale: scales[i], sameDeck: key(selectionOf(selected)) === key(baselineSelection),
      fixedBaselineDeck: summary(fixed), recommendedDeck: { ...summary(selected), searchScore: selected.search.score,
        cards: selected.deckResult.deck.map((e) => ({ id: e.card.id, name: e.card.name, lb: e.lb, borrowed: !!e.borrowed })) } };
  });
  console.log(JSON.stringify({ note: 'Assumption stress test, not measured confidence bounds. Hint-level discounts are not modeled. Search uses derived priorities; displayed chances use saved extra-skill choices.',
    baselineHintScale: settings.hintScale, baselineDeck: baselineSelection, results }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
