import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { evaluate, makeCtx } from '../src/model/deck.ts';
import { decodeEventRoll, cardSourcesForTarget, combineSources, resolveTarget, type EventSource, type SkillSource, type Target } from '../src/model/sparks.ts';
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
function check(targets: Target[], sources: Map<number, SkillSource[]>, excluded: number[]) {
  const ctx = makeCtx({ data, settings, trainee: null, races: 20, totalTurns: 72, excluded });
  const coverage = evaluate({ cards: [], chars: new Set(), sources }, targets, ctx);
  const joint = whiteGenerationMoments(jointSkillForms(targets, coverage.map, data), [], settings);
  targets.forEach((target, i) => {
    close(joint.available[i]!, combineSources(coverage.map.get(target.id)!).pAny);
    close(joint.each[i]!, coverage.sparks.get(target.id)!);
  });
  return joint;
}

test("excluding Twin Turbo's gold reward retains only the 1.2% white spark chance", () => {
  const card = data.cardById.get(30026)!, target = resolveTarget(200532, data)!;
  const sources = cardSourcesForTarget(card, 4, target, 20, 72, data, settings);
  const joint = check([target], new Map([[target.id, sources]]), [200531]);
  // Chain 3 fires in 12% of runs; half its outcomes give white; white generates at 20%.
  close(joint.available[0]!, .12 * .5);
  close(joint.each[0]!, .12 * .5 * .2);
});

test('excluding one shared reward preserves the other family and nested chain reach', () => {
  const a = resolveTarget(200352, data)!, b = resolveTarget(201601, data)!, c = resolveTarget(201581, data)!;
  const roll = { pFire: .6, outcomes: [[{ t: 'sk', d: a.gold!.id }, { t: 'sk', d: b.id }], [{ t: 'sk', d: a.id }, { t: 'sk', d: b.id }]] };
  const later = source(c.id, { pFire: .2, outcomes: [[{ t: 'sk', d: c.id }]] }, 3);
  const bSource = { ...source(b.id, roll), pObtain: .6 };
  later.pObtain = .2;
  const joint = check([a, b, c], new Map([
    [a.id, [source(a.id, roll), source(a.gold!.id, roll)]], [b.id, [bSource]], [c.id, [later]],
  ]), [a.gold!.id]);
  close(joint.available[0]!, .3);
  close(joint.available[1]!, .6);
  close(joint.available[2]!, .2);
  // Reaching stage 3 guarantees stage 1, whose white outcome still has probability one half.
  close(joint.allAvailable, .2 * .5);
  close(joint.all, .2 * .5 * .2 ** 3);
});

test('excluding the gold branch of a random reward does not redistribute its probability', () => {
  const target = resolveTarget(200352, data)!;
  const roll = { pFire: .4, outcomes: [[{ t: 'sr', d: [{ d: target.gold!.id, v: '1' }, { d: target.id, v: '1' }] }]] };
  const white = { ...source(target.id, roll), pObtain: .1 }, gold = { ...source(target.gold!.id, roll), pObtain: .3 };
  const joint = check([target], new Map([[target.id, [white, gold]]]), [target.gold!.id]);
  // At the default gold-roll stat, the original white branch retains its 25% share.
  close(joint.available[0]!, .4 * .25);
  close(joint.each[0]!, .4 * .25 * .2);
});

test('simultaneous forms in one outcome count once at the best form', () => {
  const target = resolveTarget(200352, data)!;
  const roll = { pFire: .6, outcomes: [[{ t: 'sk', d: target.id }, { t: 'sk', d: target.gold!.id }]] };
  const sources = [target.id, target.gold!.id].map((id) => ({ ...source(id, roll), pObtain: .6 }));
  const joint = check([target], new Map([[target.id, sources]]), []);
  close(joint.available[0]!, .6);
  close(joint.each[0]!, .6 * .4);
});
