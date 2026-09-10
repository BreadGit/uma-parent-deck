import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS, whiteGenerationBands } from '../src/settings.ts';
import { DEFAULT_RUN, migrate, defaultState, STATE_VERSION } from '../src/state.ts';
import { DEFAULT_GOAL as BASE_GOAL, emptyPinkLineage, sanitizePinkLineage, goalFamily, goalWithTargets, type ResolvedGoal } from '../src/model/goal-input.ts';
import { attemptsFor, blueChance, pinkEstimate, starChance, statGoalMoments as integrateStats, evaluateParentGoal as evaluateGoal, type GoalStats } from '../src/model/goal.ts';
import { jointSkillForms, whiteGenerationMoments } from '../src/model/goal-skills.ts';
import { resolveTarget, pruneConflicts, type EventSource, type SkillSource } from '../src/model/sparks.ts';
import { BLUE_GENERATION_BANDS, PINK_GENERATION_RATES } from '../src/model/rules.ts';
import { statScore, thresholdFor } from '../src/model/rank.ts';
import { phi } from '../src/model/stats.ts';
import { planRun, predictRunDeck } from '../src/model/run.ts';
import { makeCtx, evaluate, traineeCoverage, type Ctx } from '../src/model/deck.ts';
import { APTITUDE_KEYS, type AptKey, type Grade } from '../src/types.ts';

const data = loadData(), settings = structuredClone(DEFAULT_SETTINGS);
const DEFAULT_GOAL = goalWithTargets(BASE_GOAL, []);
const WHITE_GENERATION_BANDS = whiteGenerationBands(settings);
const statGoalMoments = (stats: GoalStats, goal: ResolvedGoal) => integrateStats(stats, goal, thresholdFor('SS', data.ranks));
const migrateGoal = (raw: unknown, data: Parameters<typeof migrate>[1]) => {
  const { run } = migrate({ current: { version: 13, run: { goal: raw } } }, data);
  return goalWithTargets(run.goal, run.targets);
};
function evaluateTraineeGoal(goal: ResolvedGoal, lineage: Parameters<typeof evaluateGoal>[1], apt: Parameters<typeof evaluateGoal>[2], ctx: Ctx, stats: GoalStats, issues: string[]) {
  const targets = [...goal.required.map((r) => r.id), ...goal.preferred].map((id) => resolveTarget(id, ctx.data)!);
  const result = evaluate(traineeCoverage(targets, ctx), targets, ctx);
  return evaluateGoal(goal, lineage, apt, { coverage: result.map, conflicts: result.conflicts }, ctx, stats, issues);
}
const target = (name: string) => resolveTarget(data.skills.find((s) => s.name === name)!.id, data)!;
const a = target('Groundwork'), b = target('Corner Recovery ○');
const close = (actual: number, expected: number, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const apt = (): Record<AptKey, Grade> => Object.fromEntries(APTITUDE_KEYS.map((k) => [k, k === 'turf' ? 'A' : 'G'])) as Record<AptKey, Grade>;
const lineage = () => Array.from({ length: 6 }, () => ({ aptitude: 'turf' as const, stars: 3 }));
const plain = (skillId: number, pObtain = 1): SkillSource => ({ kind: 'hint', skillId, pObtain, gold: false, circle: false, isChoice: false, detail: 'Test hint' });
const event = (skillId: number, overrides: Partial<EventSource> = {}): EventSource => ({ kind: 'random', skillId, pObtain: 0.5, gold: false, circle: false, isChoice: false, detail: 'Test event', event: { key: 'event', label: 'Event', option: 'one', optionIndex: 0 }, ...overrides });

test('generation defaults use audited star tables and inclusive blue boundaries', () => {
  assert.deepEqual(BLUE_GENERATION_BANDS.map((b) => b.rates), [[.9, .1, 0], [.5, .45, .05], [.2, .7, .1]]);
  close(starChance(PINK_GENERATION_RATES, 2), .8);
  close(starChance(PINK_GENERATION_RATES, 2, true), .7);
  close(starChance(WHITE_GENERATION_BANDS[1]!.rates, 2), .5);
  close(starChance(WHITE_GENERATION_BANDS[2]!.rates, 2), .8);
  for (const [stat, expected] of [[599, .02], [600, .1], [1099, .1], [1100, .16]]) close(blueChance([stat!, 0, 0, 0, 0], ['speed'], 2), expected!);
  close(blueChance([1100, 1100, 1100, 1100, 1100], ['speed', 'power'], 2), .32);
  close(blueChance([1100, 1100, 1100, 1100, 1100], ['speed', 'stamina', 'power', 'guts', 'wit'], 2), .8);
  close(blueChance([1100, 1100, 1100, 1100, 1100], [], 2), 0);
});

test('attempt counts handle boundaries and use the selected confidence', () => {
  assert.deepEqual([.5, .75, .95].map((q) => attemptsFor(.005, q)), [139, 277, 598]);
  assert.equal(attemptsFor(0, .95), Infinity);
  assert.equal(attemptsFor(1, .95), 1);
  assert.ok(Number.isFinite(attemptsFor(1e-15, .95)));
});

test('pink eligibility includes B-to-A and dilution from competing aptitudes', () => {
  const grades = { ...apt(), end: 'B' as const };
  const sparks = lineage();
  const end = [{ aptitude: 'end' as const, stars: 3 }, ...sparks.slice(1)];
  const result = pinkEstimate(grades, 'end', 2, end, 150);
  close(result.probability!, (1 - .875 ** 2) * .8 / 2);
  const competitor = pinkEstimate(grades, 'turf', 2, end, 150);
  close(competitor.probability!, .8 * (.875 ** 2 + (1 - .875 ** 2) / 2));
  const six = pinkEstimate(grades, 'end', 2, Array.from({ length: 6 }, () => end[0]!), 150);
  close(six.probability!, (1 - .875 ** 12) * .8 / 2);
  close(pinkEstimate(grades, 'end', 2, sparks, 150).probability!, 0);
  close(pinkEstimate({ ...grades, end: 'A' }, 'end', 2, sparks, 150).probability!, .4);
});

test('Any pink counts all eligible types and needs no ancestry when one is already eligible', () => {
  const allA = Object.fromEntries(APTITUDE_KEYS.map((k) => [k, 'A'])) as Record<AptKey, Grade>;
  for (const grades of [apt(), allA, { ...apt(), end: 'B' as const }]) {
    for (const sparks of [emptyPinkLineage(), lineage(), [{ aptitude: 'end' as const, stars: 3 }, ...lineage().slice(1)]]) {
      for (const [stars, expected] of [[1, 1], [2, .8], [3, .1]]) {
        const result = pinkEstimate(grades, 'any', stars!, sparks, 150);
        close(result.probability!, expected!);
      }
    }
  }
  const noA = { ...apt(), turf: 'B' as const };
  close(pinkEstimate(noA, 'any', 2, lineage(), 150).probability!, (1 - .875 ** 12) * .8);
  assert.equal(pinkEstimate(noA, 'any', 2, emptyPinkLineage(), 150).probability, 0);
});

test('Any pink contributes its star chance to the complete goal', () => {
  const ctx = makeCtx({ data, settings, races: 0, totalTurns: 72, trainee: data.characters[0]! });
  const stats = { rawMean: Array(5).fill(1100), sd: Array(5).fill(0), skillPoints: 3000, skillSd: 0 };
  for (const [pinkStars, expected] of [[2, .64], [3, .08]]) {
    const result = evaluateTraineeGoal({ ...DEFAULT_GOAL, enabled: true, pinkStars: pinkStars! }, emptyPinkLineage(), apt(), ctx, stats, []);
    assert.deepEqual(result.issues, []);
    close(result.probability!, expected!);
  }
});

test('pink goals default to Any at two stars and migrate unchosen goals without losing a star preference', () => {
  assert.equal(defaultState(data).run.goal.pink, 'any');
  assert.equal(defaultState(data).run.goal.pinkStars, 2);
  for (const pink of [undefined, null, '', 'invalid', 'any']) {
    const saved = migrate({ current: { version: 12, run: { goal: { enabled: true, pink, pinkStars: 3 } } } }, data);
    assert.equal(saved.run.goal.pink, 'any');
    assert.equal(saved.run.goal.pinkStars, 3);
    assert.equal(saved.run.goal.enabled, true);
    assert.deepEqual(migrate({ current: saved }, data), saved);
  }
  assert.equal(migrateGoal({ pink: 'end' }, data).pink, 'end');
});

test('empty pink slots count as zero sparks and partial lineage gives an estimate without a warning', () => {
  const grades = { ...apt(), end: 'B' as const };
  const empty = pinkEstimate(grades, 'turf', 2, emptyPinkLineage(), 150);
  close(empty.probability!, .8);
  assert.equal(empty.probability, empty.upperProbability);
  assert.deepEqual(empty.warnings, []);
  close(pinkEstimate(grades, 'end', 2, emptyPinkLineage(), 150).probability!, 0);
  const partial = [{ aptitude: 'end' as const, stars: 3 }, ...emptyPinkLineage().slice(1)];
  const proc = 1 - .875 ** 2;
  close(pinkEstimate(grades, 'end', 2, partial, 150).probability!, proc * .8 / 2);
  close(pinkEstimate(grades, 'turf', 2, partial, 150).probability!, .8 * (1 - proc / 2));
  assert.deepEqual(pinkEstimate(grades, 'end', 2, partial, 150).warnings, []);
  assert.deepEqual(pinkEstimate(grades, 'end', 2, lineage(), 150).warnings, []);
  assert.deepEqual(pinkEstimate(grades, 'any', 2, partial, 150).warnings, []);
  const ctx = makeCtx({ data, settings, races: 0, totalTurns: 72, trainee: data.characters[0]! });
  const stats = { rawMean: Array(5).fill(1100), sd: Array(5).fill(0), skillPoints: 3000, skillSd: 0 };
  const goal = { ...DEFAULT_GOAL, enabled: true, pink: 'turf' as const };
  const result = evaluateTraineeGoal(goal, emptyPinkLineage(), grades, ctx, stats, []);
  close(result.probability!, .64);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.pink.warnings, []);
  assert.ok(result.notes.some((note) => note.includes('Empty pink slots count as zero sparks')));
  assert.equal(evaluateTraineeGoal(goal, partial, grades, ctx, stats, ['Incomplete deck']).probability, null);
});

test('unsupported jumps bound target eligibility and competitor dilution', () => {
  const result = pinkEstimate(apt(), 'end', 2, [{ aptitude: 'end', stars: 3 }, ...lineage().slice(1)], 150);
  assert.equal(result.probability, 0);
  close(result.upperProbability, .4);
  assert.match(result.warnings.join(' '), /below B/);
  const turf = pinkEstimate(apt(), 'turf', 2, [{ aptitude: 'end', stars: 3 }, ...lineage().slice(1)], 150);
  close(turf.probability, .4);
  close(turf.upperProbability, .8);
  const allA = Object.fromEntries(APTITUDE_KEYS.map((k) => [k, 'A'])) as Record<AptKey, Grade>;
  close(pinkEstimate(allA, 'end', 2, emptyPinkLineage(), 150).probability!, .08, 1e-10);
});

test('restored pink ancestry migration preserves old inputs and defaults missing ancestry to zero sparks', () => {
  const run = { aptOverrides: { end: 'B', mile: 'A' }, pinkLineage: lineage() };
  const old = migrate({ current: { version: 8, run } }, data);
  assert.equal(old.version, STATE_VERSION);
  assert.deepEqual(old.run.pinkLineage, lineage());
  assert.deepEqual(old.run.aptOverrides, run.aptOverrides);
  const v9 = migrate({ current: { version: 9, run: { aptOverrides: run.aptOverrides } } }, data);
  assert.deepEqual(v9.run.pinkLineage, emptyPinkLineage());
  assert.deepEqual(v9.run.aptOverrides, run.aptOverrides);
  assert.deepEqual(migrate({ current: old }, data), old);
});

test('inspiration prediction does not mutate or reapply inheritance to entered grades', () => {
  const grades = { ...apt(), mile: 'A' as const, medium: 'S' as const, end: 'B' as const };
  const before = structuredClone(grades);
  const sparks = [{ aptitude: 'end' as const, stars: 3 }, ...lineage().slice(1)];
  close(pinkEstimate(grades, 'end', 2, sparks, 150).probability!, (1 - .875 ** 2) * .8 / 4);
  close(pinkEstimate({ ...grades, end: 'A' }, 'end', 2, sparks, 150).probability!, .8 / 4);
  assert.deepEqual(grades, before);
});

test('joint skill model preserves simultaneous and mutually exclusive event outcomes', () => {
  const check = (outcomes: EventSource['roll']) => {
    const sources = new Map([[a.id, [event(a.id, { roll: outcomes })]], [b.id, [event(b.id, { roll: outcomes })]]]);
    return whiteGenerationMoments(jointSkillForms([a, b], sources, data, settings), [0, 0], settings);
  };
  const exclusive = check({ pFire: 1, outcomes: [[{ t: 'sk', d: a.id }], [{ t: 'sk', d: b.id }]] });
  close(exclusive.all, 0);
  close(exclusive.each[0]!, .1);
  const together = check({ pFire: .5, outcomes: [[{ t: 'sk', d: a.id }, { t: 'sk', d: b.id }]] });
  close(together.allAvailable, .5);
  close(together.all, .5 * .2 * .2);
  const random = check({ pFire: 1, outcomes: [[{ t: 'sr', d: [{ d: a.id, v: '1' }, { d: b.id, v: '1' }] }]] });
  close(random.all, 0);
});

test('independent hint pickups combine without double-counting repeated sources', () => {
  const forms = jointSkillForms([a, b], new Map([[a.id, [plain(a.id, .5), plain(a.id, .5)]], [b.id, [plain(b.id, .4)]]]), data, settings);
  const result = whiteGenerationMoments(forms, [0, 0], settings);
  close(result.available[0]!, .75);
  close(result.available[1]!, .4);
  close(result.allAvailable, .75 * .4);
  close(result.all, .75 * .4 * .2 ** 2);
});

test('one event choice cannot supply two conflicting required targets', () => {
  const sources = new Map<number, SkillSource[]>([[a.id, [event(a.id, { isChoice: true, pObtain: 1 })]], [b.id, [event(b.id, { isChoice: true, pObtain: 1, event: { key: 'event', label: 'Event', option: 'two', optionIndex: 1 } })]]]);
  const { map } = pruneConflicts(sources, [a.id, b.id], [], settings, [a, b]);
  close(whiteGenerationMoments(jointSkillForms([a, b], map, data, settings), [], settings).all, 0);
});

test('later chain stage implies earlier stages without independent reach rolls', () => {
  const stage = (skillId: number, index: number, pReach: number) => event(skillId, { kind: 'chain', event: { key: `chain:${index}`, label: 'Chain', option: '', optionIndex: 0 }, chain: { key: 'card', stage: index, pReach }, roll: { pFire: pReach, outcomes: [[{ t: 'sk', d: skillId }]] } });
  const forms = jointSkillForms([a, b], new Map([[a.id, [stage(a.id, 1, .7)]], [b.id, [stage(b.id, 3, .2)]]]), data, settings);
  close([...forms.components[0]!.distribution.states.values()].reduce((x, p) => x + p, 0), 1);
  const result = whiteGenerationMoments(forms, [0, 0], settings);
  close(result.allAvailable, .2);
  close(result.available[0]!, .7);
  close(result.available[1]!, .2);
});

test('gold-or-white outcome and duplicate prerequisite rewards yield one family roll', () => {
  const roll = { pFire: 1, outcomes: [[{ t: 'sr', d: [{ d: b.gold!.id, v: '1' }, { d: b.id, v: '1' }] }]] };
  const goldSource = event(b.gold!.id, { gold: true, roll });
  const whiteSource = event(b.id, { roll });
  const forms = jointSkillForms([b], new Map([[b.id, [goldSource, whiteSource]]]), data, settings);
  close(whiteGenerationMoments(forms, [2], settings).each[0]!, (.75 * .4 + .25 * .2) * 1.1 ** 2);
  const doubled = jointSkillForms([b], new Map([[b.id, [event(b.id, { roll: { pFire: 1, outcomes: [[{ t: 'sk', d: b.id }, { t: 'sk', d: b.id }]] } })]]]), data, settings);
  close(whiteGenerationMoments(doubled, [0], settings).each[0]!, .2);
});

test('rank bands share a stat outcome with blue and both required white stars', () => {
  const goal = { ...structuredClone(DEFAULT_GOAL), required: [{ id: a.id, stars: 2 }, { id: b.id, stars: 2 }] };
  const means = [1090, 1000, 1000, 1000, 1000];
  goal.blueStats = ['speed'];
  const points = 17500 - means.reduce((p, v) => p + statScore(v), 0);
  const shared = statGoalMoments({ rawMean: means, sd: [120, 0, 0, 0, 0], skillPoints: points, skillSd: 0 }, goal);
  assert.ok(shared.blueAllWhiteStars > shared.blue * shared.whiteStars[0]! * shared.whiteStars[1]!, 'strong stat outcomes improve both blue and white star odds');
  const fixed = (score: number) => statGoalMoments({ rawMean: [1100, 0, 0, 0, 0], sd: [0, 0, 0, 0, 0], skillPoints: score - statScore(1100), skillSd: 0 }, goal);
  close(fixed(17499).blueAllWhiteStars, .16 * .5 ** 2);
  close(fixed(17500).blueAllWhiteStars, .16 * .8 ** 2);
  close(fixed(6500).whiteStars[0]!, .5);
  close(fixed(6499).whiteStars[0]!, .1);
  close(fixed(28800).whiteStars[0]!, .825);
  const capped = statGoalMoments({ rawMean: [2000, 0, 0, 0, 0], caps: [1099, 1200, 1200, 1200, 1200], sd: [0, 0, 0, 0, 0], skillPoints: 0, skillSd: 0 }, goal);
  close(capped.blue, .1);
});

test('rare blue thresholds retain finite attempts and their shared white-rank outcome', () => {
  const goal = { ...structuredClone(DEFAULT_GOAL), enabled: true, blueStats: ['stamina' as const], blueStars: 3 };
  const trainee = { ...data.characters[0]!, innateSkills: [a.id, b.id], awakeningSkills: [], eventSkills: [], events: [] };
  const ctx = makeCtx({ data, settings, races: 0, totalTurns: 72, trainee });
  const stats = { rawMean: [1100, 490, 1100, 1100, 1100], sd: [0, 32, 0, 0, 0], skillPoints: 17500 - 4 * statScore(1100) - statScore(600), skillSd: 0 };
  const expectedBlue = .01 * (phi((490 - 599.5) / 32) + phi((490 - 1099.5) / 32));
  const estimate = (required = goal.required, caps?: number[]) => evaluateTraineeGoal({ ...goal, required }, emptyPinkLineage(), apt(), ctx, { ...stats, caps }, []);
  const blueOnly = estimate();
  close(blueOnly.blue / expectedBlue, 1);
  close(blueOnly.probability! / (expectedBlue * .8), 1);
  assert.ok(Number.isFinite(attemptsFor(blueOnly.probability!, .95)));
  const required = [{ id: a.id, stars: 2 }, { id: b.id, stars: 2 }];
  const withWhites = estimate(required);
  // Every outcome that generates this blue spark also reaches SS, even though the mean rank is below SS.
  close(withWhites.probability! / (expectedBlue * .8 * (.2 * .8) ** 2), 1);
  assert.deepEqual(estimate(required), withWhites);
  assert.equal(estimate(required, [1200, 599, 1200, 1200, 1200]).probability, 0);
  assert.equal(attemptsFor(estimate([], [1200, 599, 1200, 1200, 1200]).probability!, .95), Infinity);
});

test('blue marginals integrate rounding, capped tails, and multiple acceptable stats', () => {
  const stats = { rawMean: [590, 1090, 500, 590, 1090], sd: [32, 32, 0, 32, 32], caps: [599, 1099, 1200, 600, 1100], skillPoints: 3000, skillSd: 400 };
  const goal = structuredClone(DEFAULT_GOAL);
  const middleTail = phi((590 - 599.5) / 32), highTail = phi((1090 - 1099.5) / 32);
  close(statGoalMoments(stats, { ...goal, blueStars: 1 }).blue, 1);
  close(statGoalMoments({ ...stats, rawMean: Array(5).fill(599.5), sd: Array(5).fill(32) }, { ...goal, blueStars: 1 }).blue, 1);
  close(statGoalMoments(stats, goal).blue, (.1 + .5 + .1 + (.1 + .4 * middleTail) + (.5 + .3 * highTail)) / 5);
  close(statGoalMoments(stats, { ...goal, blueStars: 3 }).blue, (.05 + .05 * middleTail + .05 + .05 * highTail) / 5);
  const extreme = { ...stats, rawMean: [0, 0, 0, 0, 0], sd: [70, 0, 0, 0, 0], caps: [1200, 1200, 1200, 1200, 1200] };
  const rare = statGoalMoments(extreme, { ...goal, blueStats: ['speed'], blueStars: 3 });
  close(rare.blue / (.01 * (phi(-599.5 / 70) + phi(-1099.5 / 70))), 1);
  assert.ok(rare.blueAllWhiteStars > 0, 'upper tails smaller than machine epsilon remain reachable');
});

test('goal migration keeps old targets as preferred and normalizes family identities', () => {
  const saved = migrate({ current: { version: 6, run: { targets: [b.gold!.id, b.id, a.id] } } }, data);
  assert.equal(saved.run.goal.enabled, false);
  assert.deepEqual(goalWithTargets(saved.run.goal, saved.run.targets).preferred, [b.id, a.id]);
  assert.deepEqual(goalWithTargets(saved.run.goal, saved.run.targets).required.map((r) => r.id), []);
  const goal = migrateGoal({ enabled: true, required: [{ id: b.gold!.id, stars: 3 }, { id: b.id, stars: 99 }], preferred: [b.id, a.id, -1], blueStats: ['power', 'nope', 'power'], pink: 'end' }, data);
  assert.deepEqual(goal.required, [{ id: b.id, stars: 3 }]);
  assert.deepEqual(goal.preferred, [a.id]);
  assert.deepEqual(goal.blueStats, ['power']);
  assert.deepEqual(sanitizePinkLineage([{ aptitude: 'end', stars: 3 }, { aptitude: 'end', stars: 4 }]), [{ aptitude: 'end', stars: 3 }, null, null, null, null, null]);
  const current = migrate({ current: { version: 13, run: { goal } } }, data);
  assert.deepEqual(migrate({ current }, data), current);
});

test('goal editing leaves selected cards and current prioritized list unchanged', () => {
  const input = structuredClone(DEFAULT_RUN);
  input.traineeCardId = data.characters.find((c) => c.name === 'Special Week')!.cardId;
  input.targets = [a.id, b.id].map((id) => ({ id, role: 'preferred', stars: 2 }));
  const before = planRun(input, settings, {}, data);
  input.goal = { ...structuredClone(BASE_GOAL), enabled: true, pink: 'turf' };
  input.targets.forEach((t) => { t.role = 'required'; });
  input.pinkLineage = lineage();
  const after = planRun(input, settings, {}, data);
  assert.deepEqual(after.deckResult.deck.map((d) => [d.card.id, d.lb, d.borrowed]), before.deckResult.deck.map((d) => [d.card.id, d.lb, d.borrowed]));
  assert.deepEqual(after.wl, before.wl);
  assert.ok(after.goalEstimate);
  assert.deepEqual(predictRunDeck(after.deckResult.deck, input, after.ctx, after.apt, after.sum.expectedLosses).finalMean, after.finalMean);
});

test('complete goal uses both required sparks while preferred extras do not constrain success', () => {
  const goal = { ...structuredClone(DEFAULT_GOAL), enabled: true, pink: 'turf' as const, required: [{ id: a.id, stars: 2 }, { id: b.id, stars: 2 }] as ParentGoalRequired };
  const trainee = { ...data.characters[0]!, innateSkills: [a.id, b.id], awakeningSkills: [], eventSkills: [], events: [] };
  const ctx = makeCtx({ data, settings, races: 0, totalTurns: 72, trainee });
  const grades = Object.fromEntries(APTITUDE_KEYS.map((k) => [k, 'A'])) as Record<AptKey, Grade>;
  const stats = { rawMean: [1100, 1100, 1100, 1100, 1100], sd: [0, 0, 0, 0, 0], skillPoints: 17500 - 5 * statScore(1100), skillSd: 0 };
  const result = evaluateTraineeGoal(goal, emptyPinkLineage(), grades, ctx, stats, []);
  close(result.probability!, .2 ** 2 * .8 * .8 ** 2 * .08);
  close(result.allAvailable, 1);
  result.required.forEach((r) => close(r.probability, .2 * .8));
  const partial = evaluateTraineeGoal({ ...goal, required: [{ id: b.id, stars: 3 }] }, emptyPinkLineage(), grades, ctx, stats, []);
  close(partial.probability!, .8 * .08 * .2 * .1);
  close(partial.required[0]!.probability, .2 * .1);
  const preferred = evaluateTraineeGoal({ ...goal, preferred: [target('Lucky Seven').id] }, emptyPinkLineage(), grades, ctx, stats, []);
  close(preferred.probability!, result.probability!);
  close(preferred.preferred[0]!.probability, 0);
  assert.equal(evaluateTraineeGoal(goal, emptyPinkLineage(), grades, ctx, stats, ['Incomplete deck']).probability, null);
});

test('unavailable required skills give zero; incomplete inputs give no complete estimate', () => {
  const goal = { ...structuredClone(DEFAULT_GOAL), enabled: true, pink: 'turf' as const, required: [{ id: a.id, stars: 2 }, { id: b.id, stars: 2 }] as ParentGoalRequired };
  const trainee = { ...data.characters[0]!, innateSkills: [], awakeningSkills: [], eventSkills: [], events: [] };
  const ctx = makeCtx({ data, settings: { ...settings, scenarioPickRate: 0 }, races: 0, totalTurns: 72, trainee });
  const stats = { rawMean: [1000, 1000, 1000, 1000, 1000], sd: [0, 0, 0, 0, 0], skillPoints: 3000, skillSd: 0 };
  const result = evaluateTraineeGoal(goal, lineage(), apt(), ctx, stats, []);
  assert.equal(result.probability, 0);
  assert.equal(evaluateTraineeGoal({ ...goal, blueStats: [] }, lineage(), apt(), ctx, stats, []).probability, null);
});
type ParentGoalRequired = typeof DEFAULT_GOAL.required;

test('zero, one, and many required whites use a product within each shared rank outcome', () => {
  const c = target('Right-Handed ○');
  const trainee = { ...data.characters[0]!, innateSkills: [a.id, b.id, c.id], awakeningSkills: [], eventSkills: [], events: [] };
  const ctx = makeCtx({ data, settings, races: 0, totalTurns: 72, trainee });
  const grades = Object.fromEntries(APTITUDE_KEYS.map((k) => [k, 'A'])) as Record<AptKey, Grade>;
  const stats = { rawMean: [1100, 1100, 1100, 1100, 1100], sd: [0, 0, 0, 0, 0], skillPoints: 17500 - 5 * statScore(1100), skillSd: 0 };
  const requirements = [{ id: a.id, stars: 2 }, { id: b.id, stars: 3 }, { id: c.id, stars: 1 }];
  for (const n of [0, 1, 2, 3]) {
    const result = evaluateTraineeGoal({ ...structuredClone(DEFAULT_GOAL), enabled: true, pink: 'turf', required: requirements.slice(0, n), preferred: [] }, emptyPinkLineage(), grades, ctx, stats, []);
    close(result.probability!, .8 * .08 * [.2 * .8, .2 * .1, .25].slice(0, n).reduce((all, p) => all * p, 1));
    close(result.allAvailable, 1);
    assert.equal(result.required.length, n);
  }
});

test('three families connected through overlapping events keep their joint availability', () => {
  const c = target('Lucky Seven');
  const ab = { pFire: .5, outcomes: [[{ t: 'sk', d: a.id }, { t: 'sk', d: b.id }]] };
  const bc = { pFire: .4, outcomes: [[{ t: 'sk', d: b.id }, { t: 'sk', d: c.id }]] };
  const source = (id: number, key: string, roll: EventSource['roll']) => event(id, { event: { key, label: key, option: '', optionIndex: 0 }, roll });
  const forms = jointSkillForms([a, b, c], new Map([[a.id, [source(a.id, 'ab', ab)]], [b.id, [source(b.id, 'ab', ab), source(b.id, 'bc', bc)]], [c.id, [source(c.id, 'bc', bc)]]]), data, settings);
  const result = whiteGenerationMoments(forms, [0, 0, 0], settings);
  close(result.allAvailable, .5 * .4);
  close(result.available[1]!, .7);
  close(result.all, .5 * .4 * .2 ** 3);
  assert.equal(result.approximate, false);
});

const manyFamilies = [...new Map(data.skills.map((s) => resolveTarget(s.id, data)).filter((t) => t?.white && !t.white.unreleasedEn && !t.circle && !t.white.name.includes('×') && goalFamily(t.id, data) === t.id).map((t) => [t!.id, t!])).values()];
test('many independent required families retain tiny probabilities without exponential expansion', () => {
  const targets = manyFamilies.slice(0, 50);
  assert.equal(targets.length, 50);
  const forms = jointSkillForms(targets, new Map(targets.map((t) => [t.id, [plain(t.id, .5)]])), data, settings);
  assert.equal(forms.components.length, 50);
  const result = whiteGenerationMoments(forms, [], settings);
  close(result.all / (.5 * .2) ** 50, 1);
  close(result.allAvailable / .5 ** 50, 1);
  assert.equal(result.approximate, false);
  assert.equal(result.each.length, 50);
});

test('large linked outcome groups are bounded, deterministic, and marked approximate', () => {
  const targets = [...new Map(manyFamilies.filter((t) => t.gold && !t.gold.unreleasedEn).map((t) => [t.gold!.id, t])).values()].slice(0, 16);
  assert.equal(targets.length, 16);
  const rewards = targets.map((t) => ({ t: 'sr', d: [{ d: t.gold!.id, v: '1' }, { d: t.id, v: '1' }] }));
  const coverage = new Map(targets.map((t) => [t.id, [event(t.id, { roll: { pFire: 1, outcomes: [rewards] } })]]));
  const evaluate = () => whiteGenerationMoments(jointSkillForms(targets, coverage, data, settings), [], settings);
  const first = evaluate();
  assert.equal(first.approximate, true);
  close(first.allAvailable, 1);
  assert.deepEqual(evaluate(), first);
  close(first.all / (.75 * .4 + .25 * .2) ** targets.length, 1, .1);
});

test('v7 required slots become a variable list and old goal-only skills join the target chips', () => {
  const raw = { version: 7, run: { targets: [a.id], goal: { enabled: true, required: [{ id: null, stars: 2 }, { id: b.id, stars: 3 }], preferred: [200012] } } };
  const saved = migrate({ current: raw }, data);
  assert.deepEqual(goalWithTargets(saved.run.goal, saved.run.targets).required, [{ id: b.id, stars: 3 }]);
  assert.deepEqual(goalWithTargets(saved.run.goal, saved.run.targets).preferred, [a.id, 200012]);
  assert.deepEqual(new Set(saved.run.targets.map((t) => t.id)), new Set([a.id, b.id, 200012]));
  const targets = manyFamilies.slice(0, 25);
  const goal = migrateGoal({ required: [{ id: null }, ...targets.map((t) => ({ id: t.id, stars: 3 })), { id: targets[0]!.id, stars: 1 }], preferred: targets.map((t) => t.id) }, data);
  assert.equal(goal.required.length, 25);
  assert.deepEqual(goal.preferred, []);
  assert.deepEqual(migrateGoal({ required: [] }, data).required, []);
  assert.deepEqual(migrateGoal({ required: [{ id: 200432, stars: 2 }, { id: 200433, stars: 2 }] }, data).required, [{ id: 200432, stars: 2 }, { id: 200433, stars: 2 }], 'distinct white skills sharing a gold upgrade remain separate targets');
});
