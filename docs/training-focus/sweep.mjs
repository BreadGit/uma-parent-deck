// Archived training-focus experiment. No application state is read or written.
// node docs/training-focus/sweep.mjs /tmp/uma-focus-study 6 [case limit]
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../src/data.ts';
import { defaultState } from '../../src/state.ts';
import { GOAL_TEMPLATES } from '../../src/model/goal-templates.ts';
import { goalWithTargets } from '../../src/model/goal-input.ts';
import { planRun, isLegalRunSelection } from '../../src/model/run.ts';
import { goalRankBands } from '../../src/model/goal.ts';
import { goalSources, scoreGoal, chooseGoal } from '../../src/model/goal-objective.ts';
import { projectForms } from '../../src/model/goal-skills.ts';
import { deckStatPower } from '../../src/model/deck.ts';
import { goalDeckKey } from '../../src/model/goal-deck.ts';
import { STATS } from '../../src/types.ts';

const data = loadData();
const focuses = ['balanced', 'stamina', 'sprint'];
const inventories = ['starter', 'budget', 'mixed', 'upgraded', 'complete'];
const legacies = ['empty', 'template', 'mixed', 'stamina'];
// Retain the exploratory full searches and five matched changes to blue legacy stats.
const extraValidationIds = [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 22, 23, 74, 169, 264, 364, 459];
const trainees = [[100401, 102001], [100601, 100101], [101101, 103701], [100701, 105001]];
const hash = id => Math.imul(id, 2654435761) >>> 0;
const selected = data.cards.filter(c => c.rarity !== 'SSR').sort((a, b) => hash(a.id) - hash(b.id)).slice(0, 30);
const mixedSSR = data.cards.filter(c => c.rarity === 'SSR').sort((a, b) => hash(a.id) - hash(b.id)).slice(0, 32);
const lightHello = data.cards.find(c => c.charName === 'Light Hello' && c.rarity === 'SSR');
assert.ok(lightHello);

function inventory(name) {
  return Object.fromEntries(data.cards.map(card => {
    let lb = null;
    if (name === 'complete') lb = 4;
    else if (name === 'starter') lb = selected.includes(card) ? (card.rarity === 'R' ? 4 : 0) : null;
    else if (card.rarity !== 'SSR') lb = 4;
    else if (name !== 'budget' && mixedSSR.includes(card)) lb = name === 'upgraded' ? 4 : hash(card.id) % 3;
    if (card.id === lightHello.id) lb = ['upgraded', 'complete'].includes(name) ? 4 : 0;
    return [card.id, lb];
  }));
}

function fixtures() {
  const cases = [];
  for (const inv of inventories) for (const legacy of legacies) for (const [t, template] of GOAL_TEMPLATES.entries()) for (let variant = 0; variant < 2; variant++) {
    cases.push({ cohort: 'templates', inv, legacy, template: template.id, trainee: trainees[Math.floor(t / 3)][variant] });
  }
  for (const inv of inventories) for (const legacy of legacies) for (const stat of STATS) {
    cases.push({ cohort: 'single-blue', inv, legacy, template: 'pace-chaser-parent-decent', trainee: 100101, blue: stat });
  }
  for (const inv of inventories) for (const legacy of legacies) {
    cases.push({ cohort: 'white-three-star', inv, legacy, template: 'pace-chaser-parent-decent', trainee: 100101, whiteStars: 3 });
  }
  return cases.map((c, id) => ({ ...c, id }));
}

function inputs(spec) {
  const state = defaultState(data), template = GOAL_TEMPLATES.find(t => t.id === spec.template);
  state.inventory = inventory(spec.inv);
  Object.assign(state.run, { traineeCardId: spec.trainee, goal: structuredClone(template.goal), targets: structuredClone(template.targets) });
  if (spec.legacy === 'template') {
    state.run.targetLineage = structuredClone(template.targetLineage ?? {});
    state.run.parentSparks = [['speed', 'stamina', 'power'], ['speed', 'guts', 'wit']].map(side => side.map(stat => ({ stat, stars: 2 })));
  }
  if (spec.legacy === 'mixed' || spec.legacy === 'stamina') {
    const stats = spec.legacy === 'stamina' ? Array(6).fill('stamina') : ['speed', 'stamina', 'power', 'speed', 'guts', 'wit'];
    state.run.parentSparks = [stats.slice(0, 3), stats.slice(3)].map(side => side.map(stat => ({ stat, stars: 3 })));
    state.run.targetLineage = Object.fromEntries(state.run.targets.map(t => [t.id, { k1: 3, p1: 7, k2: 3, p2: 7 }]));
    state.run.pinkLineage = ['medium', 'medium', 'mile', 'mile', 'long', 'long'].map(aptitude => ({ aptitude, stars: 3 }));
  }
  if (spec.blue) { state.run.goal.blueStats = [spec.blue]; state.run.goal.blueStars = 3; }
  if (spec.whiteStars) state.run.targets.filter(t => t.role === 'required').forEach(t => { t.stars = spec.whiteStars; });
  return state;
}

function fixedScore(plan, run) {
  const goal = goalWithTargets(run.goal, run.targets);
  const settings = plan.ctx.settings;
  const basis = goalRankBands({ rawMean: plan.rawFinalMean, sd: plan.rawFinalSd, caps: plan.statCaps?.cap, rawUnits: true,
    skillPoints: plan.rank.skillPts,
    skillSd: Math.sqrt(settings.skillScoreSd ** 2 + plan.purchases.variance) }, goal, plan.rank.ssMin, settings);
  const forms = projectForms(plan.purchases.forms, [...goal.required, ...goal.preferred].map(t => plan.purchases.targets.findIndex(p => p.id === t.id)));
  return scoreGoal(goal, goalSources(goal, forms, plan.ctx), basis, plan.goalEstimate.pink, settings);
}

function measure(state, focus, options) {
  const settings = { ...state.settings, focus }, start = performance.now(), cpu = process.cpuUsage();
  const plan = planRun(state.run, settings, state.inventory, data, options);
  const scored = fixedScore(plan, state.run);
  if (plan.search) {
    assert.equal(scored.count, plan.search.score.count);
    assert.ok(Math.abs(scored.comparison - plan.search.score.comparison) <= Math.max(1e-300, scored.comparison) * 1e-10);
    assert.ok(Math.abs(scored.preferred - plan.search.score.preferred) < 1e-9);
  }
  const selection = plan.deckResult.deck.map(e => ({ id: e.card.id, lb: e.lb, borrowed: e.borrowed }));
  const legal = isLegalRunSelection(selection, state.run, settings, state.inventory, data);
  // The existing greedy preview can borrow an owned pin. Full searches must restore the pin constraint.
  assert.ok(legal || (options.search === false && !options.selection));
  const usage = process.cpuUsage(cpu);
  return { focus, legal, key: `${goalDeckKey(plan.deckResult.deck)}:${focus}`, score: scored,
    probability: plan.goalEstimate.probability, upperProbability: plan.goalEstimate.upperProbability,
    statPower: deckStatPower(plan.deckResult.deck, plan.ctx), selection,
    stats: plan.finalMean, thresholds: plan.statChances, pSS: plan.rank.pSS, rank: plan.rank.score,
    blue: plan.goalEstimate.blue, pink: plan.goalEstimate.pink.probability, pinkUpper: plan.goalEstimate.pink.upperProbability,
    sp: plan.pred.sp, races: plan.sum.count, evaluated: plan.search?.evaluated ?? 0, screened: plan.search?.screened ?? 0,
    cpuMs: (usage.user + usage.system) / 1000, wallMs: performance.now() - start };
}

function validationCase(spec) {
  return spec.cohort === 'templates' ? spec.id % 5 === 0
    : spec.cohort === 'single-blue' ? STATS.indexOf(spec.blue) === (inventories.indexOf(spec.inv) + legacies.indexOf(spec.legacy)) % 5
      : (inventories.indexOf(spec.inv) + legacies.indexOf(spec.legacy)) % 5 === 0;
}

function runCase(spec) {
  const state = inputs(spec), ordered = focuses.slice(spec.id % 3).concat(focuses.slice(0, spec.id % 3));
  const initial = ordered.map(focus => measure(state, focus, { search: false }));
  const quick = ordered.map(focus => measure(state, focus, { budget: 24 }));
  const full = validationCase(spec) || extraValidationIds.includes(spec.id) ? ordered.map(focus => measure(state, focus, {})) : [];
  const cross = full.flatMap(base => focuses.filter(focus => focus !== base.focus).map(focus =>
    ({ base: base.focus, ...measure(state, focus, { selection: base.selection, search: false }) })));
  const best = chooseGoal(full.length ? full : quick, state.settings.goalTieTolerance);
  return { spec, goal: state.run.goal, targets: state.run.targets, initial, quick, full, cross, winner: best.focus };
}

export { fixtures, inputs, measure, focuses, data, validationCase };

const cases = fixtures();
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--profile') {
  console.log(JSON.stringify(measure(inputs(cases[Number(process.argv[3])]), 'stamina', {})));
} else if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--worker') {
  const shard = Number(process.argv[3]), count = Number(process.argv[4]), limit = Number(process.argv[5]);
  const done = new Set(JSON.parse(process.argv[6] ?? '[]'));
  for (const spec of cases.slice(0, limit).filter(c => c.id % count === shard && !done.has(c.id))) process.send(runCase(spec));
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? '/tmp/uma-focus-study', workers = Number(process.argv[3] ?? 6), limit = Number(process.argv[4] ?? cases.length);
  mkdirSync(dir, { recursive: true });
  const output = `${dir}/results.jsonl`;
  const previous = existsSync(output) ? readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const completed = previous.filter(r => r.full.length || !(validationCase(r.spec) || extraValidationIds.includes(r.spec.id))).map(r => r.spec.id);
  writeFileSync(`${dir}/design.json`, JSON.stringify({ cases: cases.slice(0, limit), focuses,
    inventories: Object.fromEntries(inventories.map(name => [name, inventory(name)])),
    legacyExamples: Object.fromEntries(legacies.map(legacy => [legacy, inputs({ ...cases[0], legacy }).run])),
    multipliers: data.model.focus, quickBudget: 24, workers, generatedAt: new Date().toISOString(),
    validation: '120 stratified full-budget cases, 14 exploratory cases and five matched blue-legacy changes', extraValidationIds }, null, 2));
  let done = completed.length;
  for (let shard = 0; shard < workers; shard++) {
    const worker = fork(fileURLToPath(import.meta.url), ['--worker', String(shard), String(workers), String(limit), JSON.stringify(completed)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    worker.on('message', result => {
      appendFileSync(output, JSON.stringify(result) + '\n');
      console.log(`${++done}/${Math.min(limit, cases.length)} case ${result.spec.id} ${result.spec.inv}/${result.spec.legacy}/${result.spec.template}: ${result.winner}; full CPU ${(result.full.reduce((s, r) => s + r.cpuMs, 0) / 1000).toFixed(1)}s`);
    });
    worker.on('exit', code => { if (code) process.exitCode = code; });
  }
}
