import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS, isValidSetting, sanitizeSettings } from '../src/settings.ts';
import { defaultState, migrate, STATE_VERSION } from '../src/state.ts';
import { goalFamily, goalWithTargets } from '../src/model/goal-input.ts';
import { evaluateParentGoal, pinkEstimate } from '../src/model/goal.ts';
import { makeCtx, evaluate, traineeCoverage } from '../src/model/deck.ts';
import { decodeEventRoll, resolveTarget, outcomeSkillShares, type EventSource } from '../src/model/sparks.ts';
import { jointSkillForms, whiteGenerationMoments } from '../src/model/goal-skills.ts';
import { planRun } from '../src/model/run.ts';

const data = loadData();
const goldNames = ['Runaway', 'Best in Japan', 'Risk-Maker', 'Unchanging', 'Blatant Fear', 'Dream Run', 'Cheers of a Fellow Dreamer', 'For the Team'];
const goldIds = goldNames.map((name) => data.skills.find((s) => s.name === name)!.id);
const lineage = { k1: 1, k2: 2, p1: 2, p2: 5 };
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('migration preserves both white identities and all eight gold-only targets with their lineage', () => {
  const ids = [200432, 200433, ...goldIds.map((id) => resolveTarget(id, data)!.id)];
  const saved = migrate({ current: { version: 6, run: { targets: ids, targetLineage: Object.fromEntries(ids.map((id) => [id, lineage])) } } }, data);
  assert.equal(saved.version, STATE_VERSION);
  assert.deepEqual(saved.run.targets.map((t) => t.id), ids);
  assert.deepEqual(saved.run.targetLineage, Object.fromEntries(ids.map((id) => [id, lineage])));
  assert.deepEqual(migrate({ current: saved }, data), saved);
  for (const id of ids) assert.equal(goalFamily(id, data), id);
});

test('migration normalizes lineage aliases and retains valid inactive targets', () => {
  const target = resolveTarget(200352, data)!;
  const raw = { targets: [target.gold!.id], targetLineage: { [target.gold!.id]: lineage, 999999: lineage, 201601: lineage } };
  const saved = migrate({ state: raw }, data);
  assert.deepEqual(saved.run.targetLineage, { [target.id]: lineage, 201601: lineage });
  const exact = { k1: 0, k2: 1, p1: 0, p2: 3 };
  assert.deepEqual(migrate({ state: { ...raw, targetLineage: { ...raw.targetLineage, [target.id]: exact } } }, data).run.targetLineage, { [target.id]: exact, 201601: lineage });
});

test('required roles and stars migrate into the sole target list without changing its order', () => {
  const saved = migrate({ current: { version: 13, run: { targets: [200433, 200432], goal: { required: [{ id: 200432, stars: 3 }], preferred: [201601] } } } }, data);
  assert.deepEqual(saved.run.targets, [{ id: 200433, role: 'preferred', stars: 2, priority: 0 }, { id: 200432, role: 'required', stars: 3, priority: 0 }, { id: 201601, role: 'preferred', stars: 2, priority: 0 }]);
  assert.equal('required' in saved.run.goal, false);
  assert.equal('preferred' in saved.run.goal, false);
  assert.deepEqual(migrate({ current: saved }, data), saved);
});

test('saved planning overrides preserve the agenda', () => {
  const trainee = data.characters.find((c) => c.name === 'Oguri Cap')!;
  const saved = migrate({ current: { version: 6, run: { traineeCardId: trainee.cardId, aptOverrides: { dirt: 'G' } } } }, data);
  assert.equal(saved.run.aptOverrides.dirt, 'G');
  const plan = planRun(saved.run, saved.settings, {}, data, { search: false });
  assert.equal(plan.apt.dirt, 'G');
  assert.equal(plan.schedule.filter((r) => r.selected && r.race.surface === 'dirt' && !r.goal).length, 0);
});

test('distinct whites sharing a gold upgrade do not supply each other', () => {
  const focus = resolveTarget(200432, data)!, gatekept = resolveTarget(200433, data)!;
  assert.equal(focus.familyIds.has(gatekept.id), false);
  assert.equal(gatekept.familyIds.has(focus.id), false);
  const source: EventSource = { kind: 'random', skillId: focus.id, pObtain: 1, gold: false, circle: false, isChoice: false, detail: 'Focus only', event: { key: 'focus', label: 'Focus', option: 'one', optionIndex: 0 }, roll: decodeEventRoll({ pFire: 1, outcomes: [[{ t: 'sk', d: focus.id }]] }, data, DEFAULT_SETTINGS) };
  const forms = jointSkillForms([focus, gatekept], new Map([[focus.id, [source]]]), data);
  assert.deepEqual(whiteGenerationMoments(forms, [], DEFAULT_SETTINGS).available, [1, 0]);
});

test('gold-only targets visibly contribute zero white spark chance in both estimators', () => {
  const target = resolveTarget(goldIds[0]!, data)!;
  const trainee = { ...data.characters[0]!, innateSkills: [target.id], awakeningSkills: [], eventSkills: [], events: [] };
  const ctx = makeCtx({ data, settings: DEFAULT_SETTINGS, trainee, races: 0, totalTurns: 72 });
  const coverage = evaluate(traineeCoverage([target], ctx), [target], ctx);
  assert.equal(coverage.sparks.get(target.id), 0);
  const goal = goalWithTargets(defaultState(data).run.goal, [{ id: target.id, role: 'required', stars: 2, priority: 0 }]);
  const result = evaluateParentGoal(goal, [], trainee.aptitudes, { coverage: coverage.map, conflicts: coverage.conflicts }, ctx, { rawMean: Array(5).fill(1100), sd: Array(5).fill(0), skillPoints: 10000, skillSd: 0 }, []);
  assert.equal(result.probability, 0);
  assert.match(result.notes.join(' '), /no released white form/);
});

test('gold-roll decoding and duplicate rewards agree between joint and marginal models', () => {
  const target = resolveTarget(200352, data)!;
  const reward = { t: 'sr', d: [{ d: target.gold!.id, v: '1' }, { d: target.id, v: '1' }] };
  const shares = outcomeSkillShares([reward, reward], data, DEFAULT_SETTINGS);
  const source: EventSource = { kind: 'random', skillId: target.id, pObtain: 1, gold: false, circle: false, isChoice: false, detail: 'Roll', event: { key: 'roll', label: 'Roll', option: 'one', optionIndex: 0 }, roll: decodeEventRoll({ pFire: 1, outcomes: [[reward, reward]] }, data, DEFAULT_SETTINGS) };
  const result = whiteGenerationMoments(jointSkillForms([target], new Map([[target.id, [source, { ...source, skillId: target.gold!.id, gold: true }]]]), data), [], DEFAULT_SETTINGS);
  close(result.each[0]!, shares.get(target.gold!.id)!.share * DEFAULT_SETTINGS.goldSparkRate + shares.get(target.id)!.share * DEFAULT_SETTINGS.whiteSparkRate);
});

test('SS probability follows the ranking dataset threshold', () => {
  const state = defaultState(data);
  const trainee = data.characters[0]!;
  const goal = goalWithTargets(state.run.goal, []);
  const stats = { rawMean: Array(5).fill(0), sd: Array(5).fill(0), skillPoints: 18000, skillSd: 0 };
  const estimate = (ss: number) => {
    const changed = { ...data, ranks: data.ranks.map((r) => r.name === 'SS' ? { ...r, min: ss } : r) };
    const ctx = makeCtx({ data: changed, settings: DEFAULT_SETTINGS, trainee, races: 0, totalTurns: 72 });
    return evaluateParentGoal(goal, [], trainee.aptitudes, { coverage: new Map(), conflicts: [] }, ctx, stats, []).pSS;
  };
  assert.equal(estimate(17500), 1);
  assert.equal(estimate(19000), 0);
});

test('estimated rates accept valid distributions and affect pink activation', () => {
  assert.equal(isValidSetting('whiteStarsBelowB', [.5, .5, .5]), false);
  assert.equal(isValidSetting('whiteStarsUE', [.1, .7, .2]), true);
  assert.deepEqual(sanitizeSettings({ whiteStarsBelowB: [.5, .5, .5] }).whiteStarsBelowB, DEFAULT_SETTINGS.whiteStarsBelowB);
  const apt = { ...data.characters[0]!.aptitudes, end: 'B' as const };
  const sparks = [{ aptitude: 'end' as const, stars: 3 }];
  const noProc = pinkEstimate(apt, 'end', 2, sparks, 150, [0, 0, 0]);
  assert.equal(noProc.probability, 0);
  close(pinkEstimate(apt, 'end', 2, sparks, -10).probability, pinkEstimate(apt, 'end', 2, sparks, 0).probability);
});
