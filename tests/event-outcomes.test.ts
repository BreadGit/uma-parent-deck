import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from './helpers.ts';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { SCENARIO_COMPLETION_SKILLS } from '../src/model/rules.ts';
import { evaluate, makeCtx } from '../src/model/deck.ts';
import { decodeEventRoll, cardSourcesForTarget, combineSources, pruneConflicts, scenarioCompletionSources, resolveTarget, type EventSource, type SkillSource, type Target } from '../src/model/sparks.ts';
import { jointSkillForms, whiteGenerationMoments } from '../src/model/goal-skills.ts';

const data = loadData();
const settings = { ...DEFAULT_SETTINGS, hintScale: 0, randomEventRate: 0 };
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
const source = (skillId: number, roll: Parameters<typeof decodeEventRoll>[0], stage = 1): EventSource => ({
  kind: 'chain', skillId, gold: data.skillById.get(skillId)?.rarity === 2, circle: false,
  pObtain: roll.pFire / 2, isChoice: true, detail: 'Shared choice', roll: decodeEventRoll(roll, data, settings),
  event: { key: `test:chain:${stage}`, label: 'Shared choice', option: 'one', optionIndex: 0 },
  chain: { key: 'test:chain', stage, pReach: roll.pFire },
});
/** `priority` lists the target ids the prioritized list holds; empty lists every target. */
function check(targets: Target[], sources: Map<number, SkillSource[]>, priority: number[]) {
  const ctx = makeCtx({ data, settings, trainee: null, races: 20, totalTurns: 72, priority });
  const coverage = evaluate({ cards: [], chars: new Set(), sources }, targets, ctx);
  const joint = whiteGenerationMoments(jointSkillForms(targets, coverage.map, data), [], settings);
  targets.forEach((target, i) => {
    close(joint.available[i]!, combineSources(coverage.map.get(target.id)!).pAny);
    close(joint.each[i]!, coverage.sparks.get(target.id)!);
  });
  return joint;
}

test("Twin Turbo's chain reward counts only while the target is listed", () => {
  const card = must(data.cardById.get(30026), `data.cardById.get(30026)`), target = resolveTarget(200532, data)!;
  const sources = cardSourcesForTarget(card, 4, target, 20, 72, data, settings);
  const listed = check([target], new Map([[target.id, sources]]), [target.id]);
  // Chain 3 fires in 12% of runs; half its outcomes give gold (40%), half white (20%).
  close(listed.available[0]!, .12);
  close(listed.each[0]!, .12 * .5 * .4 + .12 * .5 * .2);
  const unlisted = check([target], new Map([[target.id, sources]]), [200352]);
  close(unlisted.available[0]!, 0);
  close(unlisted.each[0]!, 0);
});

test('a shared reward gives both families, and a later chain stage guarantees the earlier ones', () => {
  const a = resolveTarget(200352, data)!, b = resolveTarget(201601, data)!, c = resolveTarget(201581, data)!;
  const roll = { pFire: .6, outcomes: [[{ t: 'sk', d: a.gold!.id }, { t: 'sk', d: b.id }], [{ t: 'sk', d: a.id }, { t: 'sk', d: b.id }]] };
  const later = source(c.id, { pFire: .2, outcomes: [[{ t: 'sk', d: c.id }]] }, 3);
  const bSource = { ...source(b.id, roll), pObtain: .6 };
  later.pObtain = .2;
  const joint = check([a, b, c], new Map([
    [a.id, [source(a.id, roll), source(a.gold!.id, roll)]], [b.id, [bSource]], [c.id, [later]],
  ]), []);
  close(joint.available[0]!, .6);
  close(joint.available[1]!, .6);
  close(joint.available[2]!, .2);
  // Reaching stage 3 guarantees stage 1, which always gives a (gold or white, half each) and b.
  close(joint.allAvailable, .2);
  close(joint.all, .2 * (.5 * .4 + .5 * .2) * .2 * .2);
});

test('simultaneous forms in one outcome count once at the best form', () => {
  const target = resolveTarget(200352, data)!;
  const roll = { pFire: .6, outcomes: [[{ t: 'sk', d: target.id }, { t: 'sk', d: target.gold!.id }]] };
  const sources = [target.id, target.gold!.id].map((id) => ({ ...source(id, roll), pObtain: .6 }));
  const joint = check([target], new Map([[target.id, sources]]), []);
  close(joint.available[0]!, .6);
  close(joint.each[0]!, .6 * .4);
});

test('unlisted automatic event rewards survive while unlisted choice rewards do not', () => {
  const target = resolveTarget(200352, data)!;
  const automatic = { ...source(target.id, { pFire: .6, outcomes: [[{ t: 'sk', d: target.id }]] }), pObtain: .6, isChoice: false };
  const result = check([target], new Map([[target.id, [automatic]]]), [201601]);
  close(result.available[0]!, .6);
  close(result.each[0]!, .6 * settings.whiteSparkRate);
});

test('unsteered common rewards keep one option and do not credit its choice-gated sibling', () => {
  const a = resolveTarget(201601, data)!, b = resolveTarget(200352, data)!;
  const both = { pFire: .6, outcomes: [[{ t: 'sk', d: a.id }, { t: 'sk', d: b.id }]] };
  const onlyA = { pFire: .6, outcomes: [[{ t: 'sk', d: a.id }]] };
  const first = { ...source(a.id, both), pObtain: .6, isChoice: false };
  const second = { ...source(a.id, onlyA), pObtain: .6, isChoice: false, event: { ...first.event, optionIndex: 1 } };
  const choice = { ...source(b.id, both), pObtain: .6 };
  const coverage = pruneConflicts(new Map([[a.id, [first, second]], [b.id, [choice]]]), [999], [], settings, [a, b]).map;
  assert.equal(coverage.get(a.id)!.length, 1);
  assert.equal(coverage.get(b.id)!.length, 0);
  const joint = whiteGenerationMoments(jointSkillForms([a, b], coverage, data), [], settings);
  close(joint.available[0]!, .6);
  close(joint.available[1]!, 0);
});

test('the unlisted scenario completion reward retains its exclusive gold and white outcomes', () => {
  const target = resolveTarget(SCENARIO_COMPLETION_SKILLS[settings.scenarioId]!.white, data)!;
  assert.equal(target.gold!.name, 'I Wanna Win with You');
  const sources = scenarioCompletionSources(target, data, { ...settings, scenarioSongsRate: .8 });
  const coverage = pruneConflicts(new Map([[target.id, sources]]), [201601], [], settings, [target]).map;
  const own = combineSources(coverage.get(target.id)!);
  close(own.pAny, 1);
  close(own.pGold, .8);
  close(own.pWhite, .2);
});
