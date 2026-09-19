// Summarize the focus experiment without changing application data.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chooseGoal } from '../../src/model/goal-objective.ts';
import { DEFAULT_SETTINGS } from '../../src/settings.ts';
import { data, validationCase } from './sweep.mjs';

const dir = process.argv[2];
if (!dir) throw new Error('Pass the results directory to summarize. See README.md.');
const raw = readFileSync(`${dir}/results.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
if (existsSync(`${dir}/paired-completions.jsonl`)) raw.push(...readFileSync(`${dir}/paired-completions.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
const cases = [...new Map(raw.map(c => [c.spec.id, c])).values()].sort((a, b) => a.spec.id - b.spec.id);
const tolerance = DEFAULT_SETTINGS.goalTieTolerance, focuses = ['balanced', 'stamina', 'sprint'];
const pick = rows => chooseGoal(rows.slice(), tolerance);
const ordered = rows => {
  const remaining = rows.slice(), out = [];
  while (remaining.length) { const best = pick(remaining); out.push(best); remaining.splice(remaining.indexOf(best), 1); }
  return out;
};
const quantile = (values, p) => values.length ? values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] : null;
const groupBy = (items, key) => Object.groupBy(items, key);
const sum = rows => rows.reduce((s, r) => s + r.cpuMs, 0);
const within = (row, candidates) => {
  const count = Math.max(...candidates.map(r => r.score.count));
  const best = Math.max(...candidates.filter(r => r.score.count === count).map(r => r.score.comparison));
  return row.score.count === count && row.score.comparison >= best * (1 - tolerance);
};
function distribution(items, fidelity) {
  const rows = items.filter(c => c[fidelity].length);
  return { n: rows.length,
    winner: Object.fromEntries(focuses.map(f => [f, rows.filter(c => pick(c[fidelity]).focus === f).length])),
    withinTwoPercent: Object.fromEntries(focuses.map(f => [f, rows.filter(c => within(c[fidelity].find(r => r.focus === f), c[fidelity])).length])),
    zeroCompleteGoal: rows.filter(c => c[fidelity].every(r => !r.upperProbability)).length };
}

const validation = cases.filter(c => c.full.length && validationCase(c.spec));
const allFull = cases.filter(c => c.full.length);
const byFocus = (c, focus) => c.full.find(r => r.focus === focus);
const rescore = (c, focus) => [byFocus(c, focus), ...c.cross.filter(r => r.base === focus)];
function adaptive(c, start, initialCost = 0) {
  const visited = new Set(), candidates = [];
  let next = start, cost = initialCost;
  while (!visited.has(next)) {
    visited.add(next);
    const rows = rescore(c, next);
    candidates.push(...rows); cost += sum(rows);
    next = pick(candidates).focus;
  }
  return { candidates, cost };
}
const policies = {
  'Always Balanced': c => ({ candidates: [byFocus(c, 'balanced')], cost: byFocus(c, 'balanced').cpuMs }),
  'Always Stamina': c => ({ candidates: [byFocus(c, 'stamina')], cost: byFocus(c, 'stamina').cpuMs }),
  'Always Sprint': c => ({ candidates: [byFocus(c, 'sprint')], cost: byFocus(c, 'sprint').cpuMs }),
  'Search Stamina and Sprint': c => ({ candidates: c.full.filter(r => r.focus !== 'balanced'), cost: sum(c.full.filter(r => r.focus !== 'balanced')) }),
  'Greedy screen, search one': c => { const best = byFocus(c, pick(c.initial).focus); return { candidates: [best], cost: sum(c.initial) + best.cpuMs }; },
  'Greedy screen, search two': c => { const top = ordered(c.initial).slice(0, 2).map(r => byFocus(c, r.focus)); return { candidates: top, cost: sum(c.initial) + sum(top) }; },
  'Budget-24 screen, search one': c => { const best = byFocus(c, pick(c.quick).focus); return { candidates: [best], cost: sum(c.quick) + best.cpuMs }; },
  'Budget-24 screen, search two': c => { const top = ordered(c.quick).slice(0, 2).map(r => byFocus(c, r.focus)); return { candidates: top, cost: sum(c.quick) + sum(top) }; },
  'Search Stamina, rescore its deck': c => { const rows = rescore(c, 'stamina'); return { candidates: rows, cost: sum(rows) }; },
  'Greedy screen, search one, rescore': c => { const rows = rescore(c, pick(c.initial).focus); return { candidates: rows, cost: sum(c.initial) + sum(rows) }; },
  'Budget-24 screen, search one, rescore': c => { const rows = rescore(c, pick(c.quick).focus); return { candidates: rows, cost: sum(c.quick) + sum(rows) }; },
  'Stamina first, follow focus changes': c => adaptive(c, 'stamina'),
  'Greedy first, follow focus changes': c => adaptive(c, pick(c.initial).focus, sum(c.initial)),
  'Search Stamina and Sprint, rescore both': c => { const rows = [...rescore(c, 'stamina'), ...rescore(c, 'sprint')]; return { candidates: rows, cost: sum(rows) }; },
  '95% stamina >=600, then Balanced': c => { const f = c.initial.find(r => r.focus === 'stamina').thresholds[1].mid > .95 ? 'balanced' : 'stamina'; return { candidates: [byFocus(c, f)], cost: sum(c.initial) + byFocus(c, f).cpuMs }; },
  '95% stamina >=1100, then Balanced': c => { const f = c.initial.find(r => r.focus === 'stamina').thresholds[1].high > .95 ? 'balanced' : 'stamina'; return { candidates: [byFocus(c, f)], cost: sum(c.initial) + byFocus(c, f).cpuMs }; },
  'No stamina blue, then Sprint': c => { const f = c.goal.blueStats.includes('stamina') ? 'stamina' : 'sprint'; return { candidates: [byFocus(c, f)], cost: byFocus(c, f).cpuMs }; },
  'Greedy Stamina SS 5-95%, then Sprint': c => { const p = c.initial.find(r => r.focus === 'stamina').pSS;
    const f = p >= .05 && p <= .95 ? 'sprint' : 'stamina'; return { candidates: [byFocus(c, f)], cost: sum(c.initial) + byFocus(c, f).cpuMs }; },
};
for (const margin of [0, .01, .02, .05, .10]) {
  policies[`Search Stamina and Sprint, expand Balanced within ${margin * 100}%`] = c => {
    const candidates = [...rescore(c, 'stamina'), ...rescore(c, 'sprint')];
    const count = Math.max(...candidates.map(r => r.score.count));
    const best = Math.max(...candidates.filter(r => r.score.count === count).map(r => r.score.comparison));
    if (candidates.some(r => r.focus === 'balanced' && r.score.count === count && r.score.comparison >= best * (1 - margin))) candidates.push(...rescore(c, 'balanced'));
    return { candidates, cost: sum(candidates) };
  };
}

function policySummary(fn, items = allFull) {
  const outcomes = items.map(c => {
    const { candidates, cost } = fn(c), chosen = pick(candidates), reference = pick(c.full);
    const maxCount = Math.max(...c.full.map(r => r.score.count));
    const bestChance = Math.max(...c.full.filter(r => r.score.count === maxCount).map(r => r.score.comparison));
    const retained = within(chosen, c.full), objective = pick([...c.full, ...candidates]);
    return { id: c.spec.id, spec: c.spec, focus: chosen.focus, reference: reference.focus,
      exactObjective: objective.key === chosen.key, retained, fewerRequirements: chosen.score.count < maxCount,
      loss: chosen.score.count < maxCount ? 1 : bestChance ? Math.max(0, 1 - chosen.score.comparison / bestChance) : 0,
      preferredLoss: retained && reference.score.preferred ? Math.max(0, 1 - chosen.score.preferred / reference.score.preferred) : null,
      ratio: cost / sum(c.full), cost, referenceCost: sum(c.full),
      probability: chosen.probability, bestProbability: reference.probability,
      improvement: objective.key === chosen.key && !c.full.some(r => r.key === chosen.key) };
  });
  return { n: outcomes.length, exactObjective: outcomes.filter(o => o.exactObjective).length, withinTwoPercent: outcomes.filter(o => o.retained).length,
    fewerRequirements: outcomes.filter(o => o.fewerRequirements).length,
    medianRequiredLoss: quantile(outcomes.map(o => o.loss), .5), p95RequiredLoss: quantile(outcomes.map(o => o.loss), .95), maxRequiredLoss: Math.max(...outcomes.map(o => o.loss)),
    p95PreferredLossWithinWindow: quantile(outcomes.flatMap(o => o.preferredLoss === null ? [] : [o.preferredLoss]), .95),
    medianCostFractionOfAllThree: quantile(outcomes.map(o => o.ratio), .5),
    totalCostFractionOfAllThree: outcomes.reduce((s, o) => s + o.cost, 0) / outcomes.reduce((s, o) => s + o.referenceCost, 0),
    improvedOnIndependentSearch: outcomes.filter(o => o.improvement).length,
    worst: outcomes.slice().sort((a, b) => b.loss - a.loss).slice(0, 5) };
}

const summary = {
  completed: cases.length, availableFull: cases.filter(c => c.full.length).length, quick: distribution(cases, 'quick'), full: distribution(validation, 'full'),
  fullIncludingExtraChecks: distribution(allFull, 'full'),
  quickWithPossibleCompleteGoal: distribution(cases.filter(c => c.quick.some(r => r.upperProbability > 0)), 'quick'),
  fullWithPossibleCompleteGoal: distribution(validation.filter(c => c.full.some(r => r.upperProbability > 0)), 'full'),
  fullWithPositiveGoalIncludingExtraChecks: distribution(allFull.filter(c => c.full.some(r => r.upperProbability > 0)), 'full'),
  quickByInventory: Object.fromEntries(Object.entries(groupBy(cases, c => c.spec.inv)).map(([k, v]) => [k, distribution(v, 'quick')])),
  fullByInventory: Object.fromEntries(Object.entries(groupBy(validation, c => c.spec.inv)).map(([k, v]) => [k, distribution(v, 'full')])),
  quickByLegacy: Object.fromEntries(Object.entries(groupBy(cases, c => c.spec.legacy)).map(([k, v]) => [k, distribution(v, 'quick')])),
  fullByLegacy: Object.fromEntries(Object.entries(groupBy(validation, c => c.spec.legacy)).map(([k, v]) => [k, distribution(v, 'full')])),
  quickByTier: Object.fromEntries(Object.entries(groupBy(cases.filter(c => c.spec.cohort === 'templates'), c => c.spec.template.split('-').at(-1))).map(([k, v]) => [k, distribution(v, 'quick')])),
  fullByTier: Object.fromEntries(Object.entries(groupBy(validation.filter(c => c.spec.cohort === 'templates'), c => c.spec.template.split('-').at(-1))).map(([k, v]) => [k, distribution(v, 'full')])),
  quickByBlue: Object.fromEntries(Object.entries(groupBy(cases.filter(c => c.spec.cohort === 'single-blue'), c => c.spec.blue)).map(([k, v]) => [k, distribution(v, 'quick')])),
  fullByBlue: Object.fromEntries(Object.entries(groupBy(validation.filter(c => c.spec.cohort === 'single-blue'), c => c.spec.blue)).map(([k, v]) => [k, distribution(v, 'full')])),
  fullByStaminaThreshold: Object.fromEntries(Object.entries(groupBy(validation, c => byFocus(c, 'stamina').thresholds[1].high >= .95 ? 'At least 95% above 1100' : 'Below 95% above 1100')).map(([k, v]) => [k, distribution(v, 'full')])),
  fullBySS: Object.fromEntries(Object.entries(groupBy(validation, c => {
    const p = byFocus(c, 'stamina').pSS;
    return p < .05 ? 'Below 5% SS' : p > .95 ? 'Above 95% SS' : '5% to 95% SS';
  })).map(([k, v]) => [k, distribution(v, 'full')])),
  policies: Object.fromEntries(Object.entries(policies).map(([name, fn]) => [name, policySummary(fn)])),
  policiesWithPositiveGoal: Object.fromEntries(Object.entries(policies).map(([name, fn]) => [name, policySummary(fn, allFull.filter(c => c.full.some(r => r.upperProbability > 0)))])),
  fullSearchCpuSeconds: validation.reduce((s, c) => s + sum(c.full), 0) / 1000,
  quickSearchCpuSeconds: cases.reduce((s, c) => s + sum(c.quick), 0) / 1000,
};
writeFileSync(`${dir}/summary.json`, JSON.stringify(summary, null, 2));
const csvRows = cases.flatMap(c => ['quick', 'full'].flatMap(mode => c[mode].map(r => ({
  case: c.spec.id, cohort: c.spec.cohort, inventory: c.spec.inv, legacy: c.spec.legacy,
  template: c.spec.template, trainee: data.charByCardId.get(c.spec.trainee).name,
  blueStats: c.goal.blueStats.join(' / '), blueStars: c.goal.blueStars,
  pinkGoals: c.goal.pink.map(g => `${g.aptitude} ${g.stars}`).join(' / '),
  mode, focus: r.focus, selected: pick(c[mode]).focus === r.focus,
  completeGoalPercent: r.probability === null ? '' : r.probability * 100,
  requiredGoalsKept: r.score.count, requiredGoalsTotal: r.score.total,
  requiredComparison: r.score.comparison, preferredScore: r.score.preferred,
  ssPercent: r.pSS * 100, bluePercent: r.blue * 100,
  speed: r.stats[0], stamina: r.stats[1], power: r.stats[2], guts: r.stats[3], wit: r.stats[4],
  stamina600Percent: r.thresholds[1].mid * 100, stamina1100Percent: r.thresholds[1].high * 100,
  cpuMs: r.cpuMs, evaluated: r.evaluated, screened: r.screened,
  deck: r.selection.map(e => `${data.cardById.get(e.id).name} LB${e.lb}${e.borrowed ? ' borrowed' : ''}`).join(' / '),
}))));
const columns = Object.keys(csvRows[0] ?? {}), csvCell = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
writeFileSync(`${dir}/comparisons.csv`, [columns, ...csvRows.map(row => columns.map(column => row[column]))].map(row => row.map(csvCell).join(',')).join('\n') + '\n');
console.log(JSON.stringify({ completed: summary.completed, quick: summary.quick, full: summary.full,
  policies: Object.fromEntries(Object.entries(summary.policies).map(([name, p]) => [name, { n: p.n, within: p.withinTwoPercent, exact: p.exactObjective, p95Loss: p.p95RequiredLoss,
    maxLoss: p.maxRequiredLoss, time: p.medianCostFractionOfAllThree }])) }, null, 2));
